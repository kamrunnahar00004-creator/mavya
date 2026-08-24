import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent, type ApiErrorCode } from "@/lib/errors";
import { withinGlobalBudget } from "@/lib/usage";
import { getImageModel } from "@/lib/openai";
import { GENERATION_PROMPT_VERSION } from "@/lib/versions";
import {
  runQueuedGenerationOnce,
  isStaleActiveGenerationJob,
  recoverStaleGenerationJob,
} from "@/lib/refinement";
import { ACTIVE_JOB_STATUSES, type GenerationJobStatus } from "@/lib/generation-types";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import { weightedRateLimitMany, type RateLimitResult } from "@/lib/rate-limit";
import type { PlanKey } from "@/lib/plans";
import { generationDailyMax } from "@/lib/generation-policy";

const GENERATION_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * One shared cost budget for manual and Fix-all generation, scaled by the
 * caller's already-resolved plan tier. The limits live in the client-safe
 * generation policy so enforcement and pricing copy share one source.
 */
export function consumeGenerationDailyBudget(
  userId: string,
  weight: number,
  idempotencyToken: string,
  planKey: PlanKey
): Promise<RateLimitResult> {
  return weightedRateLimitMany(
    [{ key: `gen-day:u:${userId}`, max: generationDailyMax(planKey) }],
    weight,
    GENERATION_DAILY_WINDOW_MS,
    `gen-day:${userId}:${idempotencyToken}`
  );
}

/**
 * The one generation_jobs row shape, shared by /api/generate and
 * /api/generate/bulk so neither can drift from the other's idea of what a
 * job looks like.
 */
export type JobRow = {
  id: string;
  user_id: string;
  product_id: string | null;
  photo_id: string | null;
  idempotency_key: string;
  status: GenerationJobStatus;
  stage: string | null;
  operation: "improve" | "edit" | "retry" | "refine";
  edit_instruction: string | null;
  result_storage_path: string | null;
  candidate_rubric: RubricJson | null;
  fidelity: FidelityReport | null;
  outcome: "publish_ready" | "useful_free_preview" | null;
  error_code: string | null;
  credit_key: string | null;
  allowance_key: string | null;
  workflow_id: string | null;
  attempt_number: number;
  refunded: boolean;
  updated_at: string;
};

export type QueueGenerationInput = {
  /** User-scoped (RLS) client -- ownership of photoId is enforced by RLS,
   *  never by an explicit user_id filter this function chooses itself. */
  supabase: SupabaseClient;
  userId: string;
  photoId: string;
  idempotencyKey: string;
  operation: "improve" | "edit" | "retry";
  editInstruction?: string | null;
  previousJobId?: string;
  unresolvedIssues?: string[];
};

export type QueueGenerationOutcome =
  | { ok: true; job: JobRow; origin: "new" | "same_key" | "active_root_conflict" }
  | { ok: false; code: ApiErrorCode; message: string };

/**
 * Recover an overdue ACTIVE generation attempt through the single shared
 * policy (never a queued job), then refetch so the caller sees the failed
 * state and its queued successor (if any). A queued job is left untouched
 * for the executor to claim.
 */
export async function recoverIfStale(supabase: SupabaseClient, job: JobRow): Promise<JobRow> {
  if (!isStaleActiveGenerationJob(job)) return job;
  const admin = createSupabaseAdminClient();
  const recovered = await recoverStaleGenerationJob(admin, job.id);
  if (!recovered) return job;
  const { data } = await supabase.from("generation_jobs").select("*").eq("id", job.id).maybeSingle();
  return (data as JobRow) ?? job;
}

/**
 * Queue ONE generation workflow for ONE photo. This is the exact core the
 * single-photo /api/generate POST handler used to run inline; extracted
 * (Codex architecture review, Slice 4b, 2026-08-23) so /api/generate/bulk
 * can queue N independent photos through the identical gates, idempotency
 * handling, and concurrency guard -- the two paths can never disagree about
 * what "queue a generation" means.
 *
 * Everything OUTSIDE a single photo's queueing -- auth, entitlement,
 * request-level rate limiting, body parsing -- stays the caller's job. Both
 * routes need different rate-limit strategies here (Codex finding 2): the
 * single-photo route's per-minute limiter must never run once per photo in
 * a bulk batch.
 */
export async function queueGeneration(
  input: QueueGenerationInput
): Promise<QueueGenerationOutcome> {
  const {
    supabase,
    userId,
    photoId,
    idempotencyKey,
    operation,
    editInstruction = null,
    previousJobId,
    unresolvedIssues,
  } = input;
  const admin = createSupabaseAdminClient();

  // 1. Idempotency: an existing job for this exact key is returned, never
  //    re-run. Same params required, otherwise the key was reused for a
  //    genuinely different request.
  {
    const { data: existing, error: existingErr } = await supabase
      .from("generation_jobs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingErr) {
      logEvent("generate.idempotency_lookup_failed", {
        userId,
        photoId,
        error: existingErr.message,
      });
      return { ok: false, code: "internal_error", message: "Could not start generation. Try again." };
    }
    if (existing) {
      const job = existing as JobRow;
      if (
        job.photo_id !== photoId ||
        job.operation !== operation ||
        (job.edit_instruction ?? null) !== (editInstruction ?? null)
      ) {
        return {
          ok: false,
          code: "idempotency_conflict",
          message: "This request key was already used with different parameters.",
        };
      }
      return { ok: true, job: await recoverIfStale(supabase, job), origin: "same_key" };
    }
  }

  // 2. Ownership: RLS scopes photos to the owner; a foreign photoId returns
  //    null. A genuine "no row" (photoErr absent, photo null) is a real
  //    not-found; a QUERY FAILURE must not be reported the same way.
  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select(
      "id, role, storage_path, mime, product_id, selected_generation_job_id, current_audit_id"
    )
    .eq("id", photoId)
    .maybeSingle();
  if (photoErr) {
    logEvent("generate.photo_lookup_failed", { userId, photoId, error: photoErr.message });
    return { ok: false, code: "internal_error", message: "Could not start generation. Try again." };
  }
  if (!photo) return { ok: false, code: "source_unavailable", message: "Photo not found." };

  // 3. Baseline audit: the exact persisted audit the user saw. Never
  //    re-scored. Read via current_audit_id (0024's single source of
  //    truth), the same pointer the keep-better floor and the product page
  //    both read.
  let auditRow:
    | { id: string; rubric: RubricJson; created_at: string; score_cache_id: string }
    | null = null;
  if (photo.current_audit_id) {
    const { data, error: auditErr } = await supabase
      .from("audits")
      .select("id, rubric, created_at, score_cache_id")
      .eq("id", photo.current_audit_id)
      .maybeSingle();
    if (auditErr) {
      logEvent("generate.audit_lookup_failed", { userId, photoId, error: auditErr.message });
      return { ok: false, code: "internal_error", message: "Could not start generation. Try again." };
    }
    auditRow = data;
  }
  if (!auditRow?.rubric || !auditRow.score_cache_id) {
    return { ok: false, code: "stale_audit", message: "Score this photo before improving it." };
  }
  const originalAudit = auditRow.rubric as RubricJson;
  const mode: "main" | "extra" = photo.role === "main" ? "main" : "extra";

  // 4. Server-side generation gates (mirror the UI, never trust it). AUTO
  //    generation (one-click improve / retry) cannot preserve the exact
  //    text and layout of a digital listing asset or a composed listing
  //    graphic, so it is refused for those regardless of what the browser
  //    sent. Seller-directed EDITs are still allowed (explicit intent; the
  //    seller reviews the result).
  const auditIsDigital = originalAudit.upload_kind === "digital_product";
  const auditIsGraphic =
    originalAudit.is_marketing_graphic === true ||
    originalAudit.supporting_photo_role === "digital_preview";
  if (operation !== "edit" && auditIsDigital) {
    return {
      ok: false,
      code: "unsupported_digital_generation",
      message:
        "One-click improvement for digital product listings is not available yet because exact text and layout cannot be guaranteed. Your audit is still ready.",
    };
  }
  if (operation !== "edit" && auditIsGraphic) {
    return {
      ok: false,
      code: "unsupported_graphic_generation",
      message:
        "One-click improvement is not available for a listing graphic because generation cannot preserve its exact text and layout. Your rating is ready.",
    };
  }
  if (originalAudit.generation_risk === "unsupported") {
    return {
      ok: false,
      code: "unsupported_product",
      message:
        "AI improvement is not supported for this product yet because exact product details may change. Your audit is still ready.",
    };
  }
  if (mode === "extra" && originalAudit.supporting_photo_role === "unrelated_or_wrong_product") {
    return {
      ok: false,
      code: "wrong_product",
      message: "This photo shows a different product than your listing, so it cannot be improved.",
    };
  }

  // 5. Fast-path concurrency check. Migration 0029's per-photo trigger is
  //    the atomic backstop and covers every active attempt, including a
  //    refinement whose root has already completed.
  {
    const { data: activeJobs, error: activeErr } = await supabase
      .from("generation_jobs")
      .select("*")
      .eq("photo_id", photoId)
      .in("status", Array.from(ACTIVE_JOB_STATUSES))
      .order("attempt_number", { ascending: false })
      .limit(1);
    if (activeErr) {
      logEvent("generate.active_workflow_lookup_failed", {
        userId,
        photoId,
        error: activeErr.message,
      });
      return { ok: false, code: "internal_error", message: "Could not start generation. Try again." };
    }
    const activeJob = activeJobs?.[0];
    if (activeJob) {
      return {
        ok: true,
        job: await recoverIfStale(supabase, activeJob as JobRow),
        origin: "active_root_conflict",
      };
    }
  }

  // 6. Global daily capacity backstop.
  if (!(await withinGlobalBudget("generate"))) {
    return {
      ok: false,
      code: "generation_disabled",
      message: "Daily capacity reached. Try again tomorrow.",
    };
  }

  // 7. Validate the optional base (previous completed result) BEFORE
  //    queueing so the durable executor can trust parent_job_id. Only ever
  //    supplied by the single-photo edit/retry flow.
  let baseJobId: string | null = null;
  if (previousJobId) {
    const { data: prev } = await supabase
      .from("generation_jobs")
      .select("id, status, photo_id, result_storage_path")
      .eq("id", previousJobId)
      .maybeSingle();
    if (
      prev &&
      prev.status === "completed" &&
      prev.photo_id === photo.id &&
      prev.result_storage_path
    ) {
      baseJobId = prev.id;
    }
  }

  // 8. DURABLE model: queue the job and return immediately. The executor
  //    (after() below, the status-poll GET, or the worker route) owns the
  //    provider work. One request = one WORKFLOW (attempt 1 = workflow
  //    root).
  const chargeKey = `${userId}:workflow:${idempotencyKey}`;
  const { data: created, error: createErr } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      product_id: photo.product_id,
      photo_id: photo.id,
      source_audit_id: auditRow.id,
      idempotency_key: idempotencyKey,
      status: "queued",
      stage: "queued",
      operation,
      edit_instruction: editInstruction ?? null,
      parent_job_id: baseJobId,
      unresolved_issues: unresolvedIssues ?? [],
      provider_model: getImageModel(),
      prompt_version: GENERATION_PROMPT_VERSION,
      allowance_key: chargeKey,
      attempt_number: 1,
    })
    .select()
    .single();

  if (createErr || !created) {
    // Do not depend on a database driver's constraint-name wording. Resolve
    // every uniqueness/trigger race from authoritative rows.
    if (createErr?.code === "23505" || createErr?.message?.includes("active_generation_workflow_exists")) {
      const { data: sameKey, error: sameKeyErr } = await admin
        .from("generation_jobs")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (!sameKeyErr && sameKey) {
        const job = sameKey as JobRow;
        if (
          job.user_id !== userId ||
          job.photo_id !== photoId ||
          job.operation !== operation ||
          (job.edit_instruction ?? null) !== (editInstruction ?? null)
        ) {
          return {
            ok: false,
            code: "idempotency_conflict",
            message: "This request key was already used with different parameters.",
          };
        }
        return { ok: true, job: await recoverIfStale(supabase, job), origin: "same_key" };
      }

      const { data: activeJobs, error: activeErr } = await admin
        .from("generation_jobs")
        .select("*")
        .eq("photo_id", photoId)
        .in("status", Array.from(ACTIVE_JOB_STATUSES))
        .order("attempt_number", { ascending: false })
        .limit(1);
      if (!activeErr && activeJobs?.[0]) {
        return {
          ok: true,
          job: await recoverIfStale(supabase, activeJobs[0] as JobRow),
          origin: "active_root_conflict",
        };
      }
    }
    logEvent("generate.job_create_failed", { userId, error: createErr?.message });
    return { ok: false, code: "internal_error", message: "Could not start the generation. Try again." };
  }
  const job = created as JobRow;

  // The workflow root is this job itself.
  await admin
    .from("generation_jobs")
    .update({ workflow_id: job.id, updated_at: new Date().toISOString() })
    .eq("id", job.id);
  job.workflow_id = job.id;

  // Best-effort in-invocation execution. The status-poll GET and the worker
  // route are the durable backstops.
  after(() => runQueuedGenerationOnce(job.id));

  logEvent("generate.queued", { jobId: job.id, operation });
  return { ok: true, job, origin: "new" };
}
