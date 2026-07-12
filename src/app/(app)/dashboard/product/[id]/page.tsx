import { redirect } from "next/navigation";
import {
  ProductWorkspace,
  type InitialJob,
  type InitialPhoto,
} from "@/components/dashboard/product-workspace";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import type { GenerationJobStatus } from "@/lib/generation-types";
import { createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 24 * 60 * 60; // 24h; /api/storage/sign refreshes on demand

type AuditRow = { rubric: RubricJson; created_at: string };
type PhotoRow = {
  id: string;
  role: "main" | "supporting";
  storage_path: string;
  position: number;
  created_at: string;
  audits: AuditRow[] | null;
  selected_generation_job_id: string | null;
  selection_source: "auto" | "user" | null;
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
  const user = await getSessionUser();
  if (!user) redirect("/?auth=login");

  // Paid-only gate: no/expired plan -> credits page. past_due may still VIEW
  // saved results (new AI usage is blocked server-side).
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active && entitlement.reason !== "past_due") {
    redirect("/subscribe");
  }

  const supabase = await createSupabaseServerClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!product) redirect("/dashboard");

  const { data: photoData } = await supabase
    .from("photos")
    .select("id, role, storage_path, position, created_at, selected_generation_job_id, selection_source, audits(rubric, created_at)")
    .eq("product_id", product.id)
    .order("role", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const rows = (photoData as PhotoRow[] | null) ?? [];
  const photoIds = rows.map((r) => r.id);

  // Latest generation job per photo (RLS scopes to the owner).
  const jobsByPhoto = new Map<string, JobRow>();
  const jobsById = new Map<string, JobRow>();
  if (photoIds.length > 0) {
    const { data: jobData } = await supabase
      .from("generation_jobs")
      .select(
        "id, photo_id, status, stage, outcome, error_code, result_storage_path, candidate_rubric, fidelity, attempt_number, created_at"
      )
      .in("photo_id", photoIds)
      .order("created_at", { ascending: false });
    for (const j of (jobData as JobRow[] | null) ?? []) {
      jobsById.set(j.id, j);
      if (!jobsByPhoto.has(j.photo_id)) jobsByPhoto.set(j.photo_id, j);
    }
  }

  const signed = await Promise.all(
    rows.map(async (row) => {
      const latest = [...(row.audits ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      )[0];
      if (!latest?.rubric) return null;
      const { data } = await supabase.storage
        .from("product-photos")
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL);
      if (!data?.signedUrl) return null;

      const jobRow = jobsByPhoto.get(row.id) ?? null;
      let lastJob: InitialJob | null = null;
      let selectedJob: InitialJob | null = null;

      const selectedRow = row.selected_generation_job_id
        ? jobsById.get(row.selected_generation_job_id) ?? null
        : null;

      // Completed versions for the picker (oldest first, max 3). Always retain
      // the seller's selected version even when it is older than the latest
      // three, otherwise refresh would show no selected card.
      const allCompletedRows = [...jobsById.values()]
        .filter((j) => j.photo_id === row.id && j.status === "completed" && j.result_storage_path)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      let completedRows = allCompletedRows.slice(-3);
      if (
        selectedRow?.status === "completed" &&
        selectedRow.result_storage_path &&
        !completedRows.some((job) => job.id === selectedRow.id)
      ) {
        completedRows = [
          selectedRow,
          ...allCompletedRows.filter((job) => job.id !== selectedRow.id).slice(-2),
        ].sort((a, b) => a.created_at.localeCompare(b.created_at));
      }
      const versions: InitialJob[] = [];
      for (const v of completedRows) {
        const { data: signedVersion } = await supabase.storage
          .from("product-photos")
          .createSignedUrl(v.result_storage_path!, SIGNED_URL_TTL);
        if (!signedVersion?.signedUrl) continue;
        versions.push({
          id: v.id,
          status: v.status,
          stage: v.stage,
          outcome: v.outcome,
          errorCode: v.error_code,
          resultUrl: signedVersion.signedUrl,
          candidateRubric: v.candidate_rubric,
          fidelity: v.fidelity,
          attemptNumber: v.attempt_number ?? 1,
        });
      }
      if (jobRow) {
        let resultUrl: string | null = null;
        if (jobRow.status === "completed" && jobRow.result_storage_path) {
          const { data: signedResult } = await supabase.storage
            .from("product-photos")
            .createSignedUrl(jobRow.result_storage_path, SIGNED_URL_TTL);
          resultUrl = signedResult?.signedUrl ?? null;
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
        };
      }

      if (selectedRow?.status === "completed" && selectedRow.result_storage_path) {
        const { data: signedSelected } = await supabase.storage
          .from("product-photos")
          .createSignedUrl(selectedRow.result_storage_path, SIGNED_URL_TTL);
        if (signedSelected?.signedUrl) {
          selectedJob = {
            id: selectedRow.id,
            status: selectedRow.status,
            stage: selectedRow.stage,
            outcome: selectedRow.outcome,
            errorCode: selectedRow.error_code,
            resultUrl: signedSelected.signedUrl,
            candidateRubric: selectedRow.candidate_rubric,
            fidelity: selectedRow.fidelity,
          };
        }
      }

      return {
        id: row.id,
        role: row.role,
        imageSrc: data.signedUrl,
        storagePath: row.storage_path,
        rubric: latest.rubric,
        lastJob,
        selectedJob,
        selectedJobId: row.selected_generation_job_id,
        selectionSource: row.selection_source ?? "auto",
        versions,
      } satisfies InitialPhoto as InitialPhoto;
    })
  );
  const initialPhotos: InitialPhoto[] = signed.filter(
    (p): p is InitialPhoto => p !== null
  );

  if (!initialPhotos.some((p) => p.role === "main")) redirect("/dashboard");

  return (
    <ProductWorkspace
      productId={product.id}
      userId={user.id}
      productName={product.name}
      initialPhotos={initialPhotos}
    />
  );
}
