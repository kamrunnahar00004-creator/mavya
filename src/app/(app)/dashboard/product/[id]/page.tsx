import { redirect } from "next/navigation";
import {
  ProductWorkspace,
  type InitialJob,
  type InitialPhoto,
} from "@/components/dashboard/product-workspace";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import type { GenerationJobStatus } from "@/lib/generation-types";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { batchSignUrls } from "@/lib/batch-sign-urls";
import { unwrapOrThrow } from "@/lib/unwrap";
import { timed } from "@/lib/perf";

export const dynamic = "force-dynamic";

type AuditRow = { id: string; rubric: RubricJson; created_at: string };
type PhotoRow = {
  id: string;
  role: "main" | "supporting";
  storage_path: string;
  position: number;
  created_at: string;
  audits: AuditRow[] | null;
  selected_generation_job_id: string | null;
  selection_source: "auto" | "user" | null;
  alternate_generation_job_id: string | null;
  has_alternate_generation: boolean;
  selection_is_reverted: boolean;
};
type JobRow = {
  id: string;
  photo_id: string;
  status: GenerationJobStatus;
  stage: string | null;
  outcome: "publish_ready" | "useful_free_preview" | null;
  error_code: string | null;
  result_storage_path: string | null;
  candidate_rubric: RubricJson | null;
  fidelity: FidelityReport | null;
  attempt_number: number | null;
  workflow_id: string | null;
  created_at: string;
};

/**
 * Per-product workspace. Loads photos + latest audits + latest generation job
 * per photo (refresh recovery: a completed preview re-appears, an active job
 * resumes polling), all under RLS.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await timed("product.auth", () => getProtectedPageIdentity());
  if (!user) redirect("/?auth=login");

  const supabase = await createSupabaseServerClient();

  // These reads are independent and RLS-scoped. They may execute together,
  // but no result is rendered until entitlement and ownership both pass.
  const [entitlement, productResult, photoResult] = await Promise.all([
    timed("product.entitlement", () => getEntitlement(user.id)),
    timed("product.lookup", () =>
      supabase.from("products").select("id, name").eq("id", id).maybeSingle()
    ),
    timed("product.photos", () =>
      supabase
        .from("photos")
        .select("id, role, storage_path, position, created_at, selected_generation_job_id, selection_source, alternate_generation_job_id, has_alternate_generation, selection_is_reverted, audits(id, rubric, created_at)")
        .eq("product_id", id)
        .order("role", { ascending: true })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        // Exactly ONE latest audit per photo crosses the wire (full rubric,
        // including the persisted supporting checklist), ordered created_at
        // DESC, id DESC — never the whole audit history.
        .order("created_at", { ascending: false, referencedTable: "audits" })
        .order("id", { ascending: false, referencedTable: "audits" })
        .limit(1, { referencedTable: "audits" })
    ),
  ]);
  if (!entitlement.active && entitlement.reason !== "past_due") {
    redirect("/subscribe");
  }

  // A returned query error must fail visibly (error boundary), never look like
  // an empty/missing product. Genuine not-found (null data, no error) redirects.
  const product = unwrapOrThrow(productResult, "product_hydration_failed");
  if (!product) redirect("/dashboard");
  const photoData = unwrapOrThrow(photoResult, "product_hydration_failed");

  const rows = (photoData as PhotoRow[] | null) ?? [];
  const photoIds = rows.map((r) => r.id);

  // Latest rating job per photo: a photo without an audit yet must still
  // render (analyzing while its durable rating runs, or a visible failed
  // state the seller can delete) — uploaded photos NEVER silently vanish.
  const ratingByPhoto = new Map<
    string,
    { id: string; status: string; error_message: string | null }
  >();
  if (photoIds.length > 0) {
    const ratingRows = unwrapOrThrow(
      await timed("product.ratings", () =>
        supabase
          .from("rating_jobs")
          .select("id, photo_id, status, error_message, created_at")
          .in("photo_id", photoIds)
          .order("created_at", { ascending: false })
          .limit(photoIds.length * 3)
      ),
      "product_hydration_failed"
    );
    for (const r of (ratingRows as
      | { id: string; photo_id: string; status: string; error_message: string | null }[]
      | null) ?? []) {
      if (!ratingByPhoto.has(r.photo_id)) ratingByPhoto.set(r.photo_id, r);
    }
  }

  // Recent generation jobs per photo (RLS scopes to the owner). BOUNDED: the
  // UI needs the latest job, the selected/alternate versions, and the last
  // five completed results — twelve newest rows per photo covers that with
  // margin, and keeps the page fast for heavy generators. Per-photo queries
  // run concurrently (a product has at most one main + a few supporting).
  const JOB_SELECT =
    "id, photo_id, status, stage, outcome, error_code, result_storage_path, candidate_rubric, fidelity, attempt_number, workflow_id, created_at";
  const jobsByPhoto = new Map<string, JobRow>();
  const jobsByPhotoId = new Map<string, JobRow[]>();
  const jobsById = new Map<string, JobRow>();
  const registerJob = (j: JobRow) => {
    if (jobsById.has(j.id)) return;
    jobsById.set(j.id, j);
    const list = jobsByPhotoId.get(j.photo_id) ?? [];
    list.push(j);
    jobsByPhotoId.set(j.photo_id, list);
  };
  if (photoIds.length > 0) {
    await timed("product.generations", async () => {
      const perPhoto = await Promise.all(
        photoIds.map((photoId) =>
          supabase
            .from("generation_jobs")
            .select(JOB_SELECT)
            .eq("photo_id", photoId)
            .order("created_at", { ascending: false })
            .limit(12)
        )
      );
      for (const result of perPhoto) {
        const jobs = unwrapOrThrow(result, "product_hydration_failed");
        for (const j of (jobs as JobRow[] | null) ?? []) {
          registerJob(j);
          if (!jobsByPhoto.has(j.photo_id)) jobsByPhoto.set(j.photo_id, j);
        }
      }
      // A selected/alternate version older than the recent window must still
      // hydrate: fetch any referenced ids the bounded query missed.
      const missingIds = rows
        .flatMap((r) => [r.selected_generation_job_id, r.alternate_generation_job_id])
        .filter((id): id is string => Boolean(id) && !jobsById.has(id as string));
      if (missingIds.length > 0) {
        const extra = unwrapOrThrow(
          await supabase.from("generation_jobs").select(JOB_SELECT).in("id", missingIds),
          "product_hydration_failed"
        );
        for (const j of (extra as JobRow[] | null) ?? []) registerJob(j);
      }
    });
  }

  // Pre-calculate selected and completed rows for each photo to avoid duplication.
  // Only process photos with valid latest rubric.
  type PhotoMetadata = {
    selectedRow: JobRow | null;
    alternateRow: JobRow | null;
    completedRows: JobRow[];
  };
  const photoMetadata = new Map<string, PhotoMetadata>();
  const validPhotoIds = new Set<string>();

  for (const row of rows) {
    // Determine if this photo is usable (has a valid latest rubric)
    const latest = [...(row.audits ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    )[0];
    if (!latest?.rubric) continue; // Skip unusable photos

    validPhotoIds.add(row.id);

    const selectedRow = row.selected_generation_job_id
      ? jobsById.get(row.selected_generation_job_id) ?? null
      : null;
    const alternateRow = row.alternate_generation_job_id
      ? jobsById.get(row.alternate_generation_job_id) ?? null
      : null;

    const allCompletedRows = (jobsByPhotoId.get(row.id) ?? [])
      .filter((j) => j.status === "completed" && j.result_storage_path)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    // Version picker shows the last FIVE versions; the selected one is always
    // included even when older than that window.
    let completedRows = allCompletedRows.slice(-5);
    if (
      selectedRow?.status === "completed" &&
      selectedRow.result_storage_path &&
      !completedRows.some((job) => job.id === selectedRow.id)
    ) {
      completedRows = [
        selectedRow,
        ...allCompletedRows.filter((job) => job.id !== selectedRow.id).slice(-4),
      ].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    photoMetadata.set(row.id, { selectedRow, alternateRow, completedRows });
  }

  // Collect all unique storage paths and sign them in batch. EVERY photo's
  // original is signed — rubric-less photos still render (analyzing/failed).
  const pathsToSign: (string | null)[] = [];
  for (const row of rows) {
    pathsToSign.push(row.storage_path); // Original photo
    if (!validPhotoIds.has(row.id)) continue;

    const metadata = photoMetadata.get(row.id);
    if (metadata) {
      // Add all result paths from completed versions
      for (const v of metadata.completedRows) {
        pathsToSign.push(v.result_storage_path);
      }

      // Add result path from latest job if completed
      const jobRow = jobsByPhoto.get(row.id) ?? null;
      if (jobRow?.status === "completed" && jobRow.result_storage_path) {
        pathsToSign.push(jobRow.result_storage_path);
      }

      // Add result path from selected job if completed
      if (metadata.selectedRow?.status === "completed" && metadata.selectedRow.result_storage_path) {
        pathsToSign.push(metadata.selectedRow.result_storage_path);
      }
      if (metadata.alternateRow?.status === "completed" && metadata.alternateRow.result_storage_path) {
        pathsToSign.push(metadata.alternateRow.result_storage_path);
      }
    }
  }

  // Sign all unique paths in one batch
  const signedUrls = await timed("product.sign", () =>
    batchSignUrls(supabase, pathsToSign)
  );

  // Build InitialPhotos using the signed URLs
  const signed = rows.map((row) => {
    // A photo without a valid rubric still ships: analyzing while its rating
    // job runs, or a visible failed state the seller can delete.
    if (!validPhotoIds.has(row.id)) {
      const imageSrc = signedUrls.get(row.storage_path);
      if (!imageSrc) return null;
      const rating = ratingByPhoto.get(row.id) ?? null;
      return {
        id: row.id,
        role: row.role,
        imageSrc,
        storagePath: row.storage_path,
        rubric: null,
        ratingJob: rating
          ? { id: rating.id, status: rating.status, errorMessage: rating.error_message }
          : null,
        lastJob: null,
        selectedJob: null,
        selectedJobId: null,
        selectionSource: "auto",
        alternateJob: null,
        hasAlternateGeneration: false,
        selectionIsReverted: false,
        versions: [],
      } satisfies InitialPhoto as InitialPhoto;
    }

    const metadata = photoMetadata.get(row.id);
    if (!metadata) return null;

    const { selectedRow, alternateRow, completedRows } = metadata;

    // Get the latest rubric (we know it exists because validPhotoIds includes this photo)
    const latest = [...(row.audits ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    )[0];

    const imageSrc = signedUrls.get(row.storage_path);
    if (!imageSrc) return null;
    const jobRow = jobsByPhoto.get(row.id) ?? null;
    let lastJob: InitialJob | null = null;
    let selectedJob: InitialJob | null = null;
    let alternateJob: InitialJob | null = null;

    const versions: InitialJob[] = [];
    for (const v of completedRows) {
      const resultUrl = signedUrls.get(v.result_storage_path!) ?? null;
      if (!resultUrl) continue;
      versions.push({
        id: v.id,
        status: v.status,
        stage: v.stage,
        outcome: v.outcome,
        errorCode: v.error_code,
        resultUrl,
        candidateRubric: v.candidate_rubric,
        fidelity: v.fidelity,
        attemptNumber: v.attempt_number ?? 1,
        workflowId: v.workflow_id,
        createdAt: v.created_at,
      });
    }

    if (jobRow) {
      let resultUrl: string | null = null;
      if (jobRow.status === "completed" && jobRow.result_storage_path) {
        resultUrl = signedUrls.get(jobRow.result_storage_path) ?? null;
      }
      lastJob = {
        id: jobRow.id,
        status: jobRow.status,
        stage: jobRow.stage,
        outcome: jobRow.outcome,
        errorCode: jobRow.error_code,
        resultUrl,
        candidateRubric: jobRow.candidate_rubric,
        fidelity: jobRow.fidelity,
        attemptNumber: jobRow.attempt_number ?? 1,
        workflowId: jobRow.workflow_id,
        createdAt: jobRow.created_at,
      };
    }

    if (selectedRow && selectedRow.status === "completed" && selectedRow.result_storage_path) {
      const resultUrl = signedUrls.get(selectedRow.result_storage_path) ?? null;
      if (resultUrl) {
        selectedJob = {
          id: selectedRow.id,
          status: selectedRow.status,
          stage: selectedRow.stage,
          outcome: selectedRow.outcome,
          errorCode: selectedRow.error_code,
          resultUrl,
          candidateRubric: selectedRow.candidate_rubric,
          fidelity: selectedRow.fidelity,
        };
      }
    }

    if (alternateRow && alternateRow.status === "completed" && alternateRow.result_storage_path) {
      const resultUrl = signedUrls.get(alternateRow.result_storage_path) ?? null;
      if (resultUrl) {
        alternateJob = {
          id: alternateRow.id,
          status: alternateRow.status,
          stage: alternateRow.stage,
          outcome: alternateRow.outcome,
          errorCode: alternateRow.error_code,
          resultUrl,
          candidateRubric: alternateRow.candidate_rubric,
          fidelity: alternateRow.fidelity,
          attemptNumber: alternateRow.attempt_number ?? 1,
        };
      }
    }

    return {
      id: row.id,
      role: row.role,
      imageSrc,
      storagePath: row.storage_path,
      rubric: latest.rubric,
      lastJob,
      selectedJob,
      selectedJobId: row.selected_generation_job_id,
      selectionSource: row.selection_source ?? "auto",
      alternateJob,
      hasAlternateGeneration: row.has_alternate_generation,
      selectionIsReverted: row.selection_is_reverted,
      versions,
    } satisfies InitialPhoto as InitialPhoto;
  });

  const initialPhotos: InitialPhoto[] = signed.filter(
    (p): p is InitialPhoto => p !== null
  );

  if (!initialPhotos.some((p) => p.role === "main" && p.rubric)) {
    // The main photo may exist without an audit while its durable rating job
    // is still running: render the workspace in its analyzing state instead
    // of bouncing to the dashboard. The workspace polls the job and refreshes
    // this page when the rating lands.
    const mainRow = rows.find((r) => r.role === "main");
    if (mainRow) {
      const pendingJob = unwrapOrThrow(
        await supabase
          .from("rating_jobs")
          .select("id, status")
          .eq("photo_id", mainRow.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "product_hydration_failed"
      );
      if (
        pendingJob &&
        (pendingJob.status === "queued" || pendingJob.status === "scoring")
      ) {
        const pendingSigned = await batchSignUrls(supabase, [mainRow.storage_path]);
        return (
          <ProductWorkspace
            productId={product.id}
            productName={product.name}
            initialPhotos={[]}
            pendingMain={{
              photoId: mainRow.id,
              jobId: pendingJob.id,
              imageSrc: pendingSigned.get(mainRow.storage_path) ?? null,
            }}
          />
        );
      }
    }
    redirect("/dashboard");
  }

  return (
    <ProductWorkspace
      productId={product.id}
      productName={product.name}
      initialPhotos={initialPhotos}
    />
  );
}
