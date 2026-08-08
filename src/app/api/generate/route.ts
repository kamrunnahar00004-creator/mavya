import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  sanitizeRetryConstraints,
  sanitizeEditInstruction,
  MAX_EDIT_INSTRUCTION_LEN,
} from "@/lib/improve-photo";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent, type ApiErrorCode } from "@/lib/errors";
import { generationDisabled, withinGlobalBudget } from "@/lib/usage";
import { getEntitlement } from "@/lib/entitlements";
import {
  runQueuedGenerationOnce,
  runQueuedRefinementChain,
  isStaleActiveGenerationJob,
  recoverStaleGenerationJob,
} from "@/lib/refinement";
import { getImageModel } from "@/lib/openai";
import { GENERATION_PROMPT_VERSION } from "@/lib/versions";
import {
  ACTIVE_JOB_STATUSES,
  type GenerationJobPayload,
  type GenerationJobStatus,
} from "@/lib/generation-types";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

type JobRow = {
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

async function signResult(
  supabase: SupabaseClient,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("product-photos")
    .createSignedUrl(path, 24 * 60 * 60);
  return data?.signedUrl ?? null;
}

async function jobPayload(
  supabase: SupabaseClient,
  job: JobRow,
  extra?: Partial<GenerationJobPayload>
): Promise<GenerationJobPayload> {
  let selectedByServer: boolean | undefined;
  // Server-truth score of whatever the seller is CURRENTLY looking at when
  // this job was NOT selected (never the client's possibly-stale local
  // state), re-derived fresh from the exact same sources the keep-better
  // floor compares against (0024): the selected generation job's raw score,
  // or photos.current_audit_id's raw score when nothing is selected.
  let keptScore: number | null = null;
  let keptKind: "selected" | "original" | null = null;
  if (job.status === "completed" && job.photo_id) {
    const { data: photo, error: photoErr } = await supabase
      .from("photos")
      .select("selected_generation_job_id, current_audit_id")
      .eq("id", job.photo_id)
      .maybeSingle();
    if (photoErr) {
      // A transient query failure must NEVER masquerade as "not selected":
      // that would falsely claim keptPrevious and could hide a legitimately
      // selected winner. Leave selectedByServer undefined (unknown) — the
      // payload already renders keptPrevious as undefined in that case, not
      // a false claim either way.
      logEvent("generate.selection_lookup_failed", {
        jobId: job.id,
        photoId: job.photo_id,
        error: photoErr.message,
      });
    } else {
      selectedByServer = photo?.selected_generation_job_id === job.id;
    }
    if (photo && !photoErr && !selectedByServer) {
      if (photo.selected_generation_job_id) {
        keptKind = "selected";
        const { data: sel, error: selErr } = await supabase
          .from("generation_jobs")
          .select("raw_score, candidate_rubric")
          .eq("id", photo.selected_generation_job_id)
          .maybeSingle();
        if (selErr) {
          // Log and leave keptScore null: the client shows neutral copy
          // rather than a number it cannot verify against server truth.
          logEvent("generate.kept_score_lookup_failed", {
            jobId: job.id,
            photoId: job.photo_id,
            source: "selected_generation_job",
            error: selErr.message,
          });
        } else {
          const rubric = sel?.candidate_rubric as
            | { raw_overall_score?: number; overall_score?: number }
            | null;
          keptScore =
            sel?.raw_score ?? rubric?.raw_overall_score ?? rubric?.overall_score ?? null;
        }
      } else if (photo.current_audit_id) {
        keptKind = "original";
        const { data: aud, error: audErr } = await supabase
          .from("audits")
          .select("overall_score, rubric")
          .eq("id", photo.current_audit_id)
          .maybeSingle();
        if (audErr) {
          logEvent("generate.kept_score_lookup_failed", {
            jobId: job.id,
            photoId: job.photo_id,
            source: "current_audit",
            error: audErr.message,
          });
        } else {
          const rubric = aud?.rubric as { raw_overall_score?: number } | null;
          keptScore = rubric?.raw_overall_score ?? aud?.overall_score ?? null;
        }
      }
    }
  }
  // Surface the workflow's follow-up background attempt (if any) so the client
  // can keep polling for a quietly-improved version.
  let refinement: GenerationJobPayload["refinement"] = null;
  if (
    (job.status === "completed" || job.status === "rejected" || job.status === "failed") &&
    job.workflow_id
  ) {
    const { data: next } = await supabase
      .from("generation_jobs")
      .select("id, status, attempt_number")
      .eq("workflow_id", job.workflow_id)
      .gt("attempt_number", job.attempt_number ?? 1)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next) {
      refinement = {
        jobId: next.id,
        status: next.status as GenerationJobStatus,
        attemptNumber: next.attempt_number,
      };
    }
  }
  return {
    ok: job.status === "completed",
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    outcome: job.outcome,
    operation: job.operation,
    errorCode: (job.error_code as ApiErrorCode | null) ?? null,
    // The executor runs detached from any request, so billing failures are
    // surfaced through the polled payload instead of a synchronous response.
    message:
      job.error_code === "insufficient_credits"
        ? "Your product improvement credit ran out"
        : job.error_code === "subscription_required" ||
          job.error_code === "subscription_past_due"
        ? "An active plan is needed to improve photos. Check Settings to update billing."
        : job.error_code === "provider_refusal"
        ? "The AI provider's safety system blocked this result."
        : null,
    resultUrl:
      job.status === "completed"
        ? await signResult(supabase, job.result_storage_path)
        : null,
    candidateRubric: job.status === "completed" ? job.candidate_rubric : null,
    fidelity: job.status === "completed" ? job.fidelity : null,
    attemptNumber: job.attempt_number ?? 1,
    workflowId: job.workflow_id,
    keptPrevious:
      selectedByServer === undefined ? undefined : !selectedByServer,
    keptScore,
    keptKind,
    refinement,
    ...extra,
  };
}

/**
 * Recover an overdue ACTIVE generation attempt through the single shared
 * policy (never a queued job), then refetch so the payload reflects the failed
 * state and surfaces the queued successor. A queued job is left untouched for
 * the executor to claim.
 */
async function recoverIfStale(
  supabase: SupabaseClient,
  job: JobRow
): Promise<JobRow> {
  if (!isStaleActiveGenerationJob(job)) return job;
  const admin = createSupabaseAdminClient();
  const recovered = await recoverStaleGenerationJob(admin, job.id);
  if (!recovered) return job;
  const { data } = await supabase
    .from("generation_jobs")
    .select("*")
    .eq("id", job.id)
    .maybeSingle();
  return (data as JobRow) ?? job;
}

/**
 * GET: refresh-safe job status. ?id=<jobId> or ?key=<idempotencyKey>.
 * RLS scopes the select to the authenticated user's own jobs.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const id = req.nextUrl.searchParams.get("id");
  const key = req.nextUrl.searchParams.get("key");
  if (!id && !key) return apiError("bad_request", "Missing job id or key.");

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("generation_jobs").select("*").limit(1);
  query = id ? query.eq("id", id) : query.eq("idempotency_key", key!);
  const { data } = await query.maybeSingle();
  if (!data) return apiError("source_unavailable", "Job not found.");

  const job = await recoverIfStale(supabase, data as JobRow);
  // Self-healing execution: the daily worker cron is only a backstop, and the
  // in-invocation after() kick can be frozen by the platform. A poll that
  // finds ANY still-queued job (attempt 1 or a refinement) kicks its
  // execution; the atomic queued->generating claim makes duplicates harmless.
  if (job.status === "queued") {
    after(() =>
      job.operation === "refine"
        ? runQueuedRefinementChain(job.id)
        : runQueuedGenerationOnce(job.id).then(() => undefined)
    );
  }
  return NextResponse.json(await jobPayload(supabase, job), { status: 200 });
}

/**
 * POST: run a generation for a persisted photo.
 *
 * The baseline audit is LOADED FROM THE DATABASE (the exact audit the user saw),
 * never re-scored and never accepted from the browser. The source image is
 * downloaded from storage server-side, so expired browser URLs cannot break the
 * flow. Results are persisted to storage and the job row survives refresh.
 *
 * Body (JSON): { photoId, idempotencyKey, editInstruction?, editSource?,
 *                previousJobId?, retry?, unresolvedIssues? }
 */
export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now();
  if (generationDisabled()) {
    return apiError("generation_disabled", "AI generation is temporarily disabled.");
  }

  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in to improve photos.");

  // Paid-only beta: server-verified subscription entitlement before anything.
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active || !entitlement.periodKey) {
    if (entitlement.reason === "past_due") {
      return apiError(
        "subscription_past_due",
        "Your payment did not go through. Update it in billing to keep improving photos. Your saved results are safe."
      );
    }
    return apiError(
      "subscription_required",
      "AI photo improvement is part of the Mavya Founding Beta subscription."
    );
  }

  const ip = clientIp(req);
  const perMin = await rateLimit(`gen:u:${user.id}`, 2, 60_000);
  const perMinIp = await rateLimit(`gen:${ip}`, 4, 60_000);
  const perDay = await rateLimit(`gen-day:u:${user.id}`, 40, 24 * 60 * 60 * 1000);
  if (!perMin.ok || !perMinIp.ok || !perDay.ok) {
    const reason = [perMin, perMinIp, perDay].find((r) => !r.ok)?.reason;
    if (reason === "missing_durable_store") {
      return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
    }
    return apiError("rate_limited", "Generation rate limit hit. Wait a minute.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }

  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 80) : "";
  if (!photoId || !idempotencyKey) {
    return apiError("bad_request", "Missing photoId or idempotencyKey.");
  }
  const rawInstruction =
    typeof body.editInstruction === "string" ? body.editInstruction : undefined;
  if (rawInstruction && rawInstruction.length > MAX_EDIT_INSTRUCTION_LEN * 4) {
    return apiError("bad_request", "Edit instruction too long.");
  }
  const editInstruction = sanitizeEditInstruction(rawInstruction);
  const isRetry = body.retry === true;
  const previousJobId =
    typeof body.previousJobId === "string" ? body.previousJobId : undefined;
  const unresolvedIssues = Array.isArray(body.unresolvedIssues)
    ? sanitizeRetryConstraints(
        body.unresolvedIssues.filter((i): i is string => typeof i === "string")
      )
    : undefined;
  const operation: JobRow["operation"] = editInstruction
    ? "edit"
    : isRetry
    ? "retry"
    : "improve";

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  // Idempotency: an existing job for this key is returned, never re-run.
  {
    const { data: existing } = await supabase
      .from("generation_jobs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      const job = existing as JobRow;
      if (
        job.photo_id !== photoId ||
        job.operation !== operation ||
        (job.edit_instruction ?? null) !== (editInstruction ?? null)
      ) {
        return apiError(
          "idempotency_conflict",
          "This request key was already used with different parameters."
        );
      }
      const current = await recoverIfStale(supabase, job);
      return NextResponse.json(await jobPayload(supabase, current), {
        status: ACTIVE_JOB_STATUSES.has(current.status) ? 202 : 200,
      });
    }
  }

  // Ownership: RLS scopes photos to the owner; a foreign photoId returns null.
  // A genuine "no row" (photoErr absent, photo null) is a real not-found; a
  // QUERY FAILURE must not be reported the same way — that would misreport a
  // transient DB error as "Photo not found" instead of a retryable failure.
  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, role, storage_path, mime, product_id, selected_generation_job_id, current_audit_id")
    .eq("id", photoId)
    .maybeSingle();
  if (photoErr) {
    logEvent("generate.photo_lookup_failed", { userId: user.id, photoId, error: photoErr.message });
    return apiError("internal_error", "Could not start generation. Try again.");
  }
  if (!photo) return apiError("source_unavailable", "Photo not found.");

  // Baseline audit: the exact persisted audit the user saw. Never re-scored.
  // Read via current_audit_id (0024's single source of truth), not an
  // independent order-by — the same pointer the keep-better floor and the
  // product page both read, never a third place that could disagree.
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
      logEvent("generate.audit_lookup_failed", {
        userId: user.id,
        photoId,
        error: auditErr.message,
      });
      return apiError("internal_error", "Could not start generation. Try again.");
    }
    auditRow = data;
  }
  // A genuine missing/stale audit (no current_audit_id, or a legacy row
  // without rubric/score_cache_id) is distinct from the query failures above,
  // already returned. This is the seller's real "score it first" state.
  if (!auditRow?.rubric || !auditRow.score_cache_id) {
    return apiError("stale_audit", "Score this photo before improving it.");
  }
  const originalAudit = auditRow.rubric as RubricJson;
  const mode: "main" | "extra" = photo.role === "main" ? "main" : "extra";

  // Server-side generation gates (mirror the UI, never trust it). AUTO
  // generation (one-click improve / retry) cannot preserve the exact text and
  // layout of a digital listing asset or a composed listing graphic, so it is
  // refused for those regardless of what the browser sent. Seller-directed
  // EDITs are still allowed (explicit intent; the seller reviews the result).
  const auditIsDigital = originalAudit.upload_kind === "digital_product";
  const auditIsGraphic =
    originalAudit.is_marketing_graphic === true ||
    originalAudit.supporting_photo_role === "digital_preview";
  if (operation !== "edit" && auditIsDigital) {
    return apiError(
      "unsupported_digital_generation",
      "One-click improvement for digital product listings is not available yet because exact text and layout cannot be guaranteed. Your audit is still ready."
    );
  }
  if (operation !== "edit" && auditIsGraphic) {
    return apiError(
      "unsupported_graphic_generation",
      "One-click improvement is not available for a listing graphic because generation cannot preserve its exact text and layout. Your rating is ready."
    );
  }
  if (originalAudit.generation_risk === "unsupported") {
    return apiError(
      "unsupported_product",
      "AI improvement is not supported for this product yet because exact product details may change. Your audit is still ready."
    );
  }
  if (
    mode === "extra" &&
    originalAudit.supporting_photo_role === "unrelated_or_wrong_product"
  ) {
    return apiError(
      "wrong_product",
      "This photo shows a different product than your listing, so it cannot be improved."
    );
  }

  if (!(await withinGlobalBudget("generate"))) {
    return apiError("generation_disabled", "Daily capacity reached. Try again tomorrow.");
  }

  // Validate the optional base (previous completed result) BEFORE queueing so
  // the durable executor can trust parent_job_id.
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

  // DURABLE model: queue the job and return immediately. The executor
  // (after() below, the status-poll GET, or the worker route) owns the
  // provider work, so closing the tab or navigating away never kills the
  // attempt. One user request = one WORKFLOW (attempt 1 = workflow root).
  const chargeKey = `${user.id}:workflow:${idempotencyKey}`;
  const { data: created, error: createErr } = await admin
    .from("generation_jobs")
    .insert({
      user_id: user.id,
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
    // Unique violation => concurrent duplicate; tell the client to poll.
    if (createErr?.code === "23505") {
      return NextResponse.json(
        { ok: false, status: "queued", jobId: null, key: idempotencyKey },
        { status: 202 }
      );
    }
    logEvent("generate.job_create_failed", { userId: user.id, error: createErr?.message });
    return apiError("internal_error", "Could not start the generation. Try again.");
  }
  const job = created as JobRow;

  const patchJob = async (fields: Record<string, unknown>) => {
    await admin
      .from("generation_jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  };

  // The workflow root is this job itself.
  await patchJob({ workflow_id: job.id });
  job.workflow_id = job.id;
  job.attempt_number = 1;

  // Best-effort in-invocation execution. The status-poll GET and the worker
  // route are the durable backstops: the queued row is the source of truth,
  // so the attempt survives a closed tab, navigation, or a dead invocation.
  after(() => runQueuedGenerationOnce(job.id));

  logEvent("generate.queued", { jobId: job.id, operation });
  // Action-start latency span (no ids/paths; time from request entry to queue).
  console.log(
    JSON.stringify({ event: "perf", span: "generate.start", ms: Date.now() - requestStartedAt })
  );
  return NextResponse.json(await jobPayload(supabase, job), { status: 202 });
}
