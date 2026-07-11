import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  improvePhoto,
  sanitizeRetryConstraints,
  sanitizeEditInstruction,
  MAX_EDIT_INSTRUCTION_LEN,
} from "@/lib/improve-photo";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent, type ApiErrorCode } from "@/lib/errors";
import {
  consumeCredits,
  generationDisabled,
  isRefundable,
  refundCredits,
  withinGlobalBudget,
} from "@/lib/usage";
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

/** Jobs stuck in an active state longer than this are treated as failed. */
const STALE_JOB_MS = 10 * 60 * 1000;

type JobRow = {
  id: string;
  user_id: string;
  product_id: string | null;
  photo_id: string | null;
  idempotency_key: string;
  status: GenerationJobStatus;
  stage: string | null;
  operation: "improve" | "edit" | "retry";
  edit_instruction: string | null;
  result_storage_path: string | null;
  candidate_rubric: RubricJson | null;
  fidelity: FidelityReport | null;
  outcome: "publish_ready" | "useful_free_preview" | null;
  error_code: string | null;
  credit_key: string | null;
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
  return {
    ok: job.status === "completed",
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    outcome: job.outcome,
    errorCode: (job.error_code as ApiErrorCode | null) ?? null,
    message: null,
    resultUrl:
      job.status === "completed"
        ? await signResult(supabase, job.result_storage_path)
        : null,
    candidateRubric: job.status === "completed" ? job.candidate_rubric : null,
    fidelity: job.status === "completed" ? job.fidelity : null,
    ...extra,
  };
}

/** Mark an overdue active job failed and refund its charge. */
async function failStaleJob(job: JobRow): Promise<JobRow> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("generation_jobs")
    .update({
      status: "failed",
      error_code: "provider_timeout",
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      refunded: true,
    })
    .eq("id", job.id)
    .in("status", ["queued", "generating", "fidelity_check", "rescoring"])
    .select()
    .maybeSingle();
  if (data && job.credit_key) await refundCredits(job.credit_key);
  logEvent("generate.stale_job_failed", { jobId: job.id });
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

  let job = data as JobRow;
  if (
    ACTIVE_JOB_STATUSES.has(job.status) &&
    Date.now() - new Date(job.updated_at).getTime() > STALE_JOB_MS
  ) {
    job = await failStaleJob(job);
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
  if (generationDisabled()) {
    return apiError("generation_disabled", "AI generation is temporarily disabled.");
  }

  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in to improve photos.");

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
      let current = job;
      if (
        ACTIVE_JOB_STATUSES.has(current.status) &&
        Date.now() - new Date(current.updated_at).getTime() > STALE_JOB_MS
      ) {
        current = await failStaleJob(current);
      }
      return NextResponse.json(await jobPayload(supabase, current), {
        status: ACTIVE_JOB_STATUSES.has(current.status) ? 202 : 200,
      });
    }
  }

  // Ownership: RLS scopes photos to the owner; a foreign photoId returns null.
  const { data: photo } = await supabase
    .from("photos")
    .select("id, role, storage_path, mime, product_id")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) return apiError("source_unavailable", "Photo not found.");

  // Baseline audit: the exact persisted audit the user saw. Never re-scored.
  const { data: auditRow } = await supabase
    .from("audits")
    .select("id, rubric, created_at")
    .eq("photo_id", photo.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!auditRow?.rubric) {
    return apiError("stale_audit", "Score this photo before improving it.");
  }
  const originalAudit = auditRow.rubric as RubricJson;
  const mode: "main" | "extra" = photo.role === "main" ? "main" : "extra";

  // Server-side generation gates (mirror the UI, never trust it).
  if (mode === "main" && originalAudit.upload_kind === "digital_product") {
    return apiError(
      "unsupported_digital_generation",
      "AI improvement for digital product listings is not available yet because exact text and layout cannot be guaranteed. Your audit is still ready."
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

  // Create the job row first so refresh can always find it.
  const chargeKey = `${user.id}:generate:${idempotencyKey}`;
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
      provider_model: getImageModel(),
      prompt_version: GENERATION_PROMPT_VERSION,
      credit_key: chargeKey,
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

  const failJob = async (
    code: ApiErrorCode,
    message: string,
    kind: "failed" | "rejected",
    extra?: { unresolvedIssues?: string[] }
  ) => {
    const refund = isRefundable(code);
    if (refund) await refundCredits(chargeKey);
    await patchJob({
      status: kind,
      stage: null,
      error_code: code,
      refunded: refund,
      completed_at: new Date().toISOString(),
    });
    logEvent("generate.finished", { jobId: job.id, status: kind, code });
    return apiError(code, message, {
      jobId: job.id,
      unresolvedIssues: extra?.unresolvedIssues ?? [],
    });
  };

  // Atomic charge (duplicate keys never double-charge).
  const charge = await consumeCredits({
    userId: user.id,
    action: "generate",
    idempotencyKey: chargeKey,
    refId: job.id,
  });
  if (!charge.ok) {
    await patchJob({
      status: "cancelled",
      error_code: charge.code === "insufficient_credits" ? "insufficient_credits" : "internal_error",
      completed_at: new Date().toISOString(),
    });
    if (charge.code === "insufficient_credits") {
      return apiError("insufficient_credits", "You are out of credits.", {
        remaining: charge.remaining ?? 0,
      });
    }
    return apiError("internal_error", "Could not process the request. Try again.");
  }
  await patchJob({ charged: 5 });

  const startedAt = Date.now();
  try {
    // Source image comes from storage server-side (no browser URLs involved).
    await patchJob({ status: "generating", stage: "preparing_source", started_at: new Date().toISOString() });
    const { data: originalBlob, error: dlErr } = await supabase.storage
      .from("product-photos")
      .download(photo.storage_path);
    if (dlErr || !originalBlob) {
      return await failJob("source_unavailable", "The original photo could not be loaded.", "failed");
    }
    const originalBuffer = Buffer.from(await originalBlob.arrayBuffer());
    const originalMimeType =
      photo.mime === "image/png" ? ("image/png" as const) : ("image/jpeg" as const);

    // Optional base: the previous completed job's persisted result.
    let baseBuffer: Buffer | undefined;
    let promptAudit: RubricJson | undefined;
    if (previousJobId) {
      const { data: prev } = await supabase
        .from("generation_jobs")
        .select("id, status, photo_id, result_storage_path, candidate_rubric")
        .eq("id", previousJobId)
        .maybeSingle();
      if (
        prev &&
        prev.status === "completed" &&
        prev.photo_id === photo.id &&
        prev.result_storage_path
      ) {
        const { data: baseBlob } = await supabase.storage
          .from("product-photos")
          .download(prev.result_storage_path);
        if (baseBlob) {
          baseBuffer = Buffer.from(await baseBlob.arrayBuffer());
          promptAudit = (prev.candidate_rubric as RubricJson) ?? undefined;
        }
      }
    }

    // Supporting photos get the listing context from the MAIN photo's audit.
    let mainProductContext: string | undefined;
    if (mode === "extra" && photo.product_id) {
      const { data: mainPhoto } = await supabase
        .from("photos")
        .select("id, audits(rubric, created_at)")
        .eq("product_id", photo.product_id)
        .eq("role", "main")
        .limit(1)
        .maybeSingle();
      const audits = (mainPhoto?.audits ?? []) as { rubric: RubricJson; created_at: string }[];
      const latest = [...audits].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      mainProductContext = latest?.rubric?.product_summary?.trim() || undefined;
    }

    await patchJob({ status: "generating", stage: "generating" });
    const result = await improvePhoto({
      originalBuffer,
      originalMimeType,
      originalAudit,
      baseBuffer,
      baseMimeType: baseBuffer ? "image/png" : undefined,
      promptAudit,
      extraConstraints: unresolvedIssues,
      mainProductContext,
      mode,
      editInstruction,
      onStage: async (stage) => {
        await patchJob({ status: stage, stage });
      },
    });

    if (!result.ok) {
      const kind =
        result.code === "image_failed" || result.code === "vision_failed"
          ? "failed"
          : "rejected";
      return await failJob(result.code, result.message, kind, {
        unresolvedIssues: result.unresolvedIssues,
      });
    }

    // Persist the accepted output; the preview survives refresh.
    const resultPath = `${user.id}/${photo.product_id}/generated/${job.id}.png`;
    const { error: upErr } = await admin.storage
      .from("product-photos")
      .upload(resultPath, Buffer.from(result.imageBase64, "base64"), {
        contentType: "image/png",
        upsert: true,
      });
    if (upErr) {
      return await failJob("persistence_failed", "The result could not be saved. Try again.", "failed");
    }

    await patchJob({
      status: "completed",
      stage: null,
      result_storage_path: resultPath,
      candidate_rubric: result.candidateAudit,
      fidelity: result.fidelity,
      outcome: result.outcome,
      completed_at: new Date().toISOString(),
    });
    logEvent("generate.finished", {
      jobId: job.id,
      status: "completed",
      outcome: result.outcome,
      latencyMs: Date.now() - startedAt,
    });

    const payload = await jobPayload(
      supabase,
      {
        ...job,
        status: "completed",
        stage: null,
        result_storage_path: resultPath,
        candidate_rubric: result.candidateAudit,
        fidelity: result.fidelity,
        outcome: result.outcome,
        error_code: null,
      },
      { creditsRemaining: charge.remaining }
    );
    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    logEvent("generate.unhandled", {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return await failJob("internal_error", "Generation failed unexpectedly. Try again.", "failed");
  }
}
