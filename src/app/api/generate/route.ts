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
import { apiError, logEvent, type ApiErrorCode } from "@/lib/errors";
import { generationDisabled } from "@/lib/usage";
import { getEntitlement } from "@/lib/entitlements";
import { runQueuedGenerationOnce, runQueuedRefinementChain } from "@/lib/refinement";
import {
  consumeGenerationDailyBudget,
  queueGeneration,
  recoverIfStale,
  type JobRow,
} from "@/lib/generation-queue";
import {
  ACTIVE_JOB_STATUSES,
  type GenerationJobPayload,
  type GenerationJobStatus,
} from "@/lib/generation-types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

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
  if (!perMin.ok || !perMinIp.ok) {
    const reason = [perMin, perMinIp].find((r) => !r.ok)?.reason;
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
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!photoId || !idempotencyKey) {
    return apiError("bad_request", "Missing photoId or idempotencyKey.");
  }
  if (idempotencyKey.length > 80) {
    return apiError("bad_request", "Idempotency key too long.");
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
  const operation: "improve" | "edit" | "retry" = editInstruction
    ? "edit"
    : isRetry
    ? "retry"
    : "improve";

  // Charge the shared manual/bulk daily budget only after the request is
  // syntactically valid. Malformed edits must remain safe to correct and retry.
  const daily = await consumeGenerationDailyBudget(user.id, 1, idempotencyKey);
  if (!daily.ok) {
    if (daily.reason === "missing_durable_store") {
      return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
    }
    return apiError("rate_limited", "Generation rate limit hit. Try again tomorrow.");
  }

  const supabase = await createSupabaseServerClient();

  const outcome = await queueGeneration({
    supabase,
    userId: user.id,
    photoId,
    idempotencyKey,
    operation,
    editInstruction,
    previousJobId,
    unresolvedIssues,
  });

  if (!outcome.ok) {
    return apiError(outcome.code, outcome.message);
  }
  // Action-start latency span (no ids/paths; time from request entry to queue).
  console.log(
    JSON.stringify({ event: "perf", span: "generate.start", ms: Date.now() - requestStartedAt })
  );
  const status =
    outcome.origin === "new"
      ? 202
      : ACTIVE_JOB_STATUSES.has(outcome.job.status)
      ? 202
      : 200;
  return NextResponse.json(await jobPayload(supabase, outcome.job), { status });
}
