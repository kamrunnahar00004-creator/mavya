import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  improvePhoto,
  sanitizeRetryConstraints,
  unresolvedIssuesForRetry,
  type ImproveMode,
} from "@/lib/improve-photo";
import { rawOverall, CALIBRATION_RULE, calibrateScore } from "@/lib/calibration";
import {
  MAX_ATTEMPTS_PER_WORKFLOW,
  candidateIsSafe,
  shouldQueueRefinement,
} from "@/lib/workflow-rules";
import { generationDisabled, isRefundable, withinGlobalBudget } from "@/lib/usage";
import { consumeAllowance, refundAllowance } from "@/lib/allowances";
import { logEvent } from "@/lib/errors";
import { getImageModel } from "@/lib/openai";
import { GENERATION_PROMPT_VERSION } from "@/lib/versions";
import { getEntitlement } from "@/lib/entitlements";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import type { GenerationJobStatus } from "@/lib/generation-types";

/**
 * Bounded background refinement (attempt 2, the single automatic follow-up of
 * an improvement workflow; MAX_ATTEMPTS_PER_WORKFLOW = 2).
 *
 * Durability model (no external queue dependency): a refinement attempt is a
 * `generation_jobs` ROW in status 'queued'. Executors CLAIM it with an atomic
 * compare-and-set (queued -> generating), so duplicate executors cannot run
 * the same attempt twice. Triggers, in order of reliability:
 *   1. `after()` in the generate route (best effort, same serverless invocation).
 *   2. The /api/generate/worker route, callable by Vercel Cron / any scheduler
 *      with the WORKER_SECRET (durable backstop; also recovers stale jobs).
 * The app enforces the ceiling in maybeQueueRefinement (attempt 2 never queues
 * attempt 3). The DB additionally guards with one active refinement per
 * workflow (partial unique index) and a legacy attempt_number CHECK (1..3).
 */

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type WorkflowJobRow = {
  id: string;
  user_id: string;
  product_id: string | null;
  photo_id: string | null;
  source_audit_id: string | null;
  idempotency_key: string;
  status: GenerationJobStatus;
  operation: "improve" | "edit" | "retry" | "refine";
  edit_instruction: string | null;
  result_storage_path: string | null;
  candidate_rubric: RubricJson | null;
  fidelity: FidelityReport | null;
  outcome: string | null;
  error_code: string | null;
  credit_key: string | null;
  allowance_key: string | null;
  refunded: boolean;
  workflow_id: string | null;
  attempt_number: number;
  parent_job_id: string | null;
  unresolved_issues: string[] | null;
  updated_at: string;
};

/**
 * Auto-select a completed SAFE candidate as the photo's visible version,
 * respecting the manual-selection rule and never replacing a strictly better
 * version. Optimistic compare-and-set on the previous pointer prevents a
 * concurrent weaker result from racing into selection.
 */
export async function applySelectionForCompletedJob(args: {
  admin: AdminClient;
  userId: string;
  photoId: string;
  productId: string | null;
  jobId: string;
  operation: "improve" | "edit" | "retry" | "refine";
  candidateRubric: RubricJson;
  candidateSafe: boolean;
}): Promise<boolean> {
  const { data: updated, error } = await args.admin.rpc(
    "select_generation_if_stronger",
    {
      p_user: args.userId,
      p_photo: args.photoId,
      p_job: args.jobId,
      p_operation: args.operation,
      p_candidate_safe: args.candidateSafe,
    }
  );
  if (error) {
    logEvent("selection.update_failed", { jobId: args.jobId, error: error.message });
    return false;
  }
  return Boolean(updated);
}

/**
 * Queue the next bounded background attempt when policy says so.
 * Returns the queued job id, or null when no attempt was queued.
 * Charged 0: attempt 2 is internal quality work inside the already-charged
 * workflow. Duplicate queueing is prevented by the unique idempotency key and
 * the one-active-refinement partial index.
 */
export async function maybeQueueRefinement(args: {
  admin: AdminClient;
  completedJob: Pick<
    WorkflowJobRow,
    | "id"
    | "user_id"
    | "product_id"
    | "photo_id"
    | "source_audit_id"
    | "operation"
    | "edit_instruction"
    | "workflow_id"
    | "attempt_number"
    | "allowance_key"
  >;
  /** Raw score of the ACCEPTED (safe) result; null when the attempt was unsafe/rejected. */
  acceptedRawScore: number | null;
}): Promise<string | null> {
  const job = args.completedJob;
  if (generationDisabled()) return null;
  const workflowId = job.workflow_id ?? job.id;
  const attemptNumber = job.attempt_number ?? 1;
  if (
    !shouldQueueRefinement({
      attemptNumber,
      acceptedRawScore: args.acceptedRawScore,
    })
  ) {
    return null;
  }
  const nextAttempt = attemptNumber + 1;
  if (nextAttempt > MAX_ATTEMPTS_PER_WORKFLOW) return null;

  const { data: queued, error } = await args.admin
    .from("generation_jobs")
    .insert({
      user_id: job.user_id,
      product_id: job.product_id,
      photo_id: job.photo_id,
      source_audit_id: job.source_audit_id,
      idempotency_key: `${workflowId}:a${nextAttempt}`,
      status: "queued",
      stage: "queued",
      operation: "refine",
      // Edit workflows carry the seller's instruction into attempt 2 so a
      // fresh-from-original retry can re-apply exactly what was asked.
      edit_instruction: job.edit_instruction ?? null,
      provider_model: getImageModel(),
      prompt_version: GENERATION_PROMPT_VERSION,
      workflow_id: workflowId,
      attempt_number: nextAttempt,
      parent_job_id: job.id,
      allowance_key: job.allowance_key,
      charged: 0,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // 23505 = attempt already queued (idempotency key or one-active index).
    if (error.code !== "23505") {
      logEvent("refine.queue_failed", { workflowId, error: error.message });
    }
    return null;
  }
  logEvent("refine.queued", { workflowId, attempt: nextAttempt, jobId: queued?.id });
  return queued?.id ?? null;
}

/**
 * The ONLY generation states eligible for provider-timeout recovery. A `queued`
 * job is waiting for an executor to claim it, not stuck inside a provider call,
 * so it is never classified as a timeout here (both polling and the worker
 * kick queued rows into execution instead).
 */
export const RECOVERABLE_ACTIVE_STATUSES = [
  "generating",
  "fidelity_check",
  "rescoring",
] as const;

/** Active generating attempts idle longer than this are treated as a provider timeout. */
export const STALE_GENERATION_MS = 10 * 60 * 1000;

/**
 * True only for an ACTIVE generating attempt overdue past the stale window.
 * Shared by polling (generate route GET) and the worker so both classify
 * staleness identically; a queued job always returns false.
 */
export function isStaleActiveGenerationJob(job: {
  status: string;
  updated_at: string;
}): boolean {
  return (
    (RECOVERABLE_ACTIVE_STATUSES as readonly string[]).includes(job.status) &&
    Date.now() - new Date(job.updated_at).getTime() > STALE_GENERATION_MS
  );
}

/**
 * Authoritative recovery for ONE overdue active attempt, shared by polling and
 * the worker so they produce equivalent persisted outcomes. Atomically flips a
 * still-active row to failed(provider_timeout); ONLY the compare-and-set winner
 * then refunds an attempt-1 allowance and queues the next bounded attempt. A
 * second concurrent caller matches zero rows and does nothing (no double refund,
 * no double successor). The `MAX_ATTEMPTS_PER_WORKFLOW` ceiling inside
 * maybeQueueRefinement guarantees the final attempt queues no successor.
 * Returns the recovered job id when THIS caller won, else null.
 */
export async function recoverStaleGenerationJob(
  admin: AdminClient,
  jobId: string
): Promise<string | null> {
  // Staleness is verified ATOMICALLY inside the CAS (updated_at < cutoff), not
  // just by a prior read: a live executor that refreshed updated_at between any
  // read and this UPDATE bumps the row out of the cutoff, so it loses the CAS
  // and keeps running. `refunded` is NOT set here — it is written truthfully
  // below, only when an attempt-1 allowance is actually refunded.
  const cutoff = new Date(Date.now() - STALE_GENERATION_MS).toISOString();
  const { data: won } = await admin
    .from("generation_jobs")
    .update({
      status: "failed",
      error_code: "provider_timeout",
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", RECOVERABLE_ACTIVE_STATUSES)
    .lt("updated_at", cutoff)
    .select(
      "id, user_id, product_id, photo_id, source_audit_id, operation, edit_instruction, workflow_id, attempt_number, allowance_key"
    )
    .maybeSingle();
  if (!won) return null;
  const job = won as Pick<
    WorkflowJobRow,
    | "id"
    | "user_id"
    | "product_id"
    | "photo_id"
    | "source_audit_id"
    | "operation"
    | "edit_instruction"
    | "workflow_id"
    | "attempt_number"
    | "allowance_key"
  >;
  // Only the charged attempt (attempt 1) consumed a workflow allowance. Set
  // refunded=true ONLY when a refund actually happened; attempt 2 stays false.
  if ((job.attempt_number ?? 1) === 1 && job.allowance_key) {
    await refundAllowance(job.allowance_key);
    await admin
      .from("generation_jobs")
      .update({ refunded: true, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  }
  // A timeout is still a failed bounded attempt: queue the next one immediately
  // (bounded by MAX_ATTEMPTS_PER_WORKFLOW) rather than waiting for a scheduler.
  await maybeQueueRefinement({ admin, completedJob: job, acceptedRawScore: null });
  logEvent("refine.stale_failed", { jobId });
  return job.id;
}

type CommitUploadResult =
  | { ok: true }
  | { ok: false; reason: "deleted" | "upload_failed" };

/**
 * Remove a just-uploaded orphan file, and if the removal itself fails, DURABLY
 * enqueue the exact path into the deletion outbox. A late upload can land after
 * the original deletion tasks already drained, so logging alone would leak the
 * file forever — the outbox row guarantees a later drain removes it. The path is
 * re-validated to be inside the owner's own folder before any action.
 */
async function selfCleanOrEnqueue(
  admin: AdminClient,
  userId: string,
  path: string
): Promise<void> {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) {
    logEvent("generate.self_clean_bad_path", {});
    return;
  }
  const { error: rmErr } = await admin.storage
    .from("product-photos")
    .remove([path]);
  if (!rmErr) return;
  const { error: enqErr } = await admin.from("storage_cleanup_queue").insert({
    user_id: userId,
    kind: "object",
    storage_path: path,
  });
  logEvent(
    enqErr ? "generate.self_clean_enqueue_failed" : "generate.self_clean_enqueued",
    {}
  );
}

/**
 * Upload a generated result and mark the job completed in a way that is safe
 * against concurrent product/photo deletion (see the deletion outbox).
 *
 * Failure modes are distinguished:
 *   - A returned DATABASE error (pre-check or completion query) is a persistence
 *     failure ("upload_failed"), NOT a deletion — the caller fails the job.
 *   - A missing row / lost CAS (no error, zero rows) means the job was
 *     cascade-deleted or recovered mid-flight ("deleted").
 *
 * Defenses at the single upload site:
 *   1. Pre-upload: the job must still exist in an active generating state.
 *      Deletion can still commit between this check and the upload, so this is
 *      NOT sufficient on its own.
 *   2. Post-upload: the completion update is conditional (id + still-active
 *      status) and must affect exactly one row. On zero rows OR a completion
 *      query error the just-uploaded file is cleaned via selfCleanOrEnqueue,
 *      which durably enqueues cleanup if the direct removal fails.
 */
export async function commitCompletedUpload(args: {
  admin: AdminClient;
  jobId: string;
  userId: string;
  resultPath: string;
  imageBase64: string;
  completionFields: Record<string, unknown>;
}): Promise<CommitUploadResult> {
  const { admin, jobId, userId, resultPath, imageBase64, completionFields } = args;

  const { data: pre, error: preErr } = await admin
    .from("generation_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  if (preErr) return { ok: false, reason: "upload_failed" }; // DB error, not deletion
  if (
    !pre ||
    !(RECOVERABLE_ACTIVE_STATUSES as readonly string[]).includes(pre.status)
  ) {
    return { ok: false, reason: "deleted" };
  }

  const { error: upErr } = await admin.storage
    .from("product-photos")
    .upload(resultPath, Buffer.from(imageBase64, "base64"), {
      contentType: "image/png",
      upsert: true,
    });
  if (upErr) return { ok: false, reason: "upload_failed" };

  const { data: done, error: doneErr } = await admin
    .from("generation_jobs")
    .update({
      ...completionFields,
      status: "completed",
      stage: null,
      result_storage_path: resultPath,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", RECOVERABLE_ACTIVE_STATUSES)
    .select("id")
    .maybeSingle();
  if (doneErr) {
    // Completion query failed: persistence failure, and nothing references the
    // uploaded file (result_storage_path was never recorded), so clean it up.
    await selfCleanOrEnqueue(admin, userId, resultPath);
    return { ok: false, reason: "upload_failed" };
  }
  if (!done) {
    // Zero rows: cascade-deleted or recovered mid-flight → clean the orphan.
    await selfCleanOrEnqueue(admin, userId, resultPath);
    return { ok: false, reason: "deleted" };
  }
  return { ok: true };
}

/** Fail active jobs stuck longer than the stale window; refund attempt-1 allowances. */
export async function recoverStaleJobs(admin: AdminClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_GENERATION_MS).toISOString();
  const { data: stale } = await admin
    .from("generation_jobs")
    .select("id")
    .in("status", RECOVERABLE_ACTIVE_STATUSES)
    .lt("updated_at", cutoff)
    .limit(20);
  let failed = 0;
  for (const row of stale ?? []) {
    if (await recoverStaleGenerationJob(admin, row.id)) failed++;
  }
  return failed;
}

/**
 * Claim and execute ONE queued refinement attempt. Safe to call from multiple
 * triggers concurrently: the queued->generating compare-and-set means exactly
 * one executor runs a given attempt. Returns the processed job id or null.
 */
export async function runQueuedRefinementOnce(jobId?: string): Promise<string | null> {
  if (generationDisabled()) return null;
  const admin = createSupabaseAdminClient();

  // Pick a queued refinement row (specific id when given).
  let query = admin
    .from("generation_jobs")
    .select("id")
    .eq("status", "queued")
    .eq("operation", "refine")
    .order("created_at", { ascending: true })
    .limit(1);
  if (jobId) query = query.eq("id", jobId);
  const { data: candidates } = await query;
  const target = candidates?.[0];
  if (!target) return null;

  // Atomic claim.
  const { data: claimed } = await admin
    .from("generation_jobs")
    .update({
      status: "generating",
      stage: "preparing_source",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", target.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return null;
  const job = claimed as WorkflowJobRow;

  const patch = async (fields: Record<string, unknown>) => {
    await admin
      .from("generation_jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  };
  const fail = async (code: string, kind: "failed" | "rejected") => {
    await patch({
      status: kind,
      stage: null,
      error_code: code,
      // Attempt 2 never consumed an allowance; nothing to refund. isRefundable
      // is still recorded for reconciliation visibility.
      refunded: false,
      completed_at: new Date().toISOString(),
    });
    logEvent("refine.finished", { jobId: job.id, status: kind, code });
  };

  const startedAt = Date.now();
  try {
    const entitlement = await getEntitlement(job.user_id);
    if (!entitlement.active) {
      await patch({
        status: "cancelled",
        stage: null,
        error_code: "subscription_required",
        completed_at: new Date().toISOString(),
      });
      return job.id;
    }
    if (!(await withinGlobalBudget("generate"))) {
      await fail("generation_disabled", "failed");
      return job.id;
    }

    // Load the owned photo and verify ownership via the product owner. The
    // worker has no user session, so ownership is enforced explicitly.
    const { data: photo } = await admin
      .from("photos")
      .select("id, role, storage_path, mime, product_id, products(user_id)")
      .eq("id", job.photo_id)
      .maybeSingle();
    const ownerId = (photo?.products as { user_id?: string } | null)?.user_id;
    if (!photo || ownerId !== job.user_id) {
      await fail("source_unavailable", "failed");
      return job.id;
    }

    // Baseline audit: the exact persisted audit the workflow started from.
    const { data: auditRow } = await admin
      .from("audits")
      .select("id, rubric, score_cache_id")
      .eq("id", job.source_audit_id)
      .eq("photo_id", photo.id)
      .maybeSingle();
    const originalAudit = auditRow?.rubric as RubricJson | null;
    if (!originalAudit || !auditRow?.score_cache_id) {
      await fail("stale_audit", "failed");
      return job.id;
    }
    const mode: ImproveMode = photo.role === "main" ? "main" : "extra";

    // Parent attempt decides the refinement targeting.
    const { data: parent } = await admin
      .from("generation_jobs")
      .select(
        "id, status, result_storage_path, candidate_rubric, fidelity, unresolved_issues"
      )
      .eq("id", job.parent_job_id)
      .eq("user_id", job.user_id)
      .maybeSingle();

    const { data: originalBlob } = await admin.storage
      .from("product-photos")
      .download(photo.storage_path);
    if (!originalBlob) {
      await fail("source_unavailable", "failed");
      return job.id;
    }
    const originalBuffer = Buffer.from(await originalBlob.arrayBuffer());
    const originalMimeType =
      photo.mime === "image/png" ? ("image/png" as const) : ("image/jpeg" as const);

    let baseBuffer: Buffer | undefined;
    let promptAudit: RubricJson | undefined;
    let extraConstraints: string[] = [];
    if (parent?.status === "completed" && parent.result_storage_path) {
      // Build FROM the parent's safe result, targeting its audit's problems.
      const { data: baseBlob } = await admin.storage
        .from("product-photos")
        .download(parent.result_storage_path);
      if (baseBlob) {
        baseBuffer = Buffer.from(await baseBlob.arrayBuffer());
        promptAudit = (parent.candidate_rubric as RubricJson) ?? undefined;
      }
      if (parent.fidelity && parent.candidate_rubric) {
        extraConstraints = unresolvedIssuesForRetry(
          parent.fidelity as FidelityReport,
          parent.candidate_rubric as RubricJson,
          mode
        );
      }
    } else if (parent) {
      // Parent was unsafe/rejected: fresh attempt from the ORIGINAL, carrying
      // the parent's server-defined failure constraints.
      extraConstraints = sanitizeRetryConstraints(
        Array.isArray(parent.unresolved_issues) ? parent.unresolved_issues : []
      );
    }

    // Supporting photos need the listing context from the main photo's audit.
    let mainProductContext: string | undefined;
    if (mode === "extra" && photo.product_id) {
      const { data: mainPhoto } = await admin
        .from("photos")
        .select("id, audits(rubric, created_at)")
        .eq("product_id", photo.product_id)
        .eq("role", "main")
        .limit(1)
        .maybeSingle();
      const audits = (mainPhoto?.audits ?? []) as {
        rubric: RubricJson;
        created_at: string;
      }[];
      const latest = [...audits].sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      )[0];
      mainProductContext = latest?.rubric?.product_summary?.trim() || undefined;
    }

    await patch({ status: "generating", stage: "generating" });
    const result = await improvePhoto({
      originalBuffer,
      originalMimeType,
      originalAudit,
      baseBuffer,
      baseMimeType: baseBuffer ? "image/png" : undefined,
      promptAudit,
      extraConstraints,
      mainProductContext,
      mode,
      // Edit workflow: when polishing FROM the parent's result the edit is
      // already baked into the base image (re-applying could double-apply,
      // e.g. "make the background darker"). Only a fresh attempt from the
      // ORIGINAL must re-apply the seller's instruction.
      editInstruction: baseBuffer ? undefined : job.edit_instruction ?? undefined,
      onStage: async (stage) => {
        await patch({ status: stage, stage });
      },
    });

    if (!result.ok) {
      const kind =
        result.code === "image_failed" || result.code === "vision_failed"
          ? "failed"
          : "rejected";
      await patch({ unresolved_issues: result.unresolvedIssues });
      await fail(result.code, kind);
      // An unsafe or failed refinement still justifies the final bounded
      // attempt when one remains (never beyond MAX_ATTEMPTS_PER_WORKFLOW = 2).
      await maybeQueueRefinement({
        admin,
        completedJob: job,
        acceptedRawScore: null,
      });
      return job.id;
    }

    const resultPath = `${job.user_id}/${photo.product_id}/generated/${job.id}.png`;
    const safe = candidateIsSafe(result.fidelity, mode);
    const raw = rawOverall(result.candidateAudit);
    const commit = await commitCompletedUpload({
      admin,
      jobId: job.id,
      userId: job.user_id,
      resultPath,
      imageBase64: result.imageBase64,
      completionFields: {
        candidate_rubric: result.candidateAudit,
        fidelity: result.fidelity,
        outcome: result.outcome,
        raw_score: raw,
        calibrated_score: calibrateScore(raw),
        calibration_rule: CALIBRATION_RULE,
        latency_ms: Date.now() - startedAt,
      },
    });
    if (!commit.ok) {
      if (commit.reason === "upload_failed") await fail("persistence_failed", "failed");
      // reason "deleted": the product/photo was deleted mid-generation, the job
      // row is gone, and the uploaded file was cleaned. Nothing to fail or queue.
      return job.id;
    }

    const selected = await applySelectionForCompletedJob({
      admin,
      userId: job.user_id,
      photoId: photo.id,
      productId: photo.product_id,
      jobId: job.id,
      operation: "refine",
      candidateRubric: result.candidateAudit,
      candidateSafe: safe,
    });

    await maybeQueueRefinement({
      admin,
      completedJob: job,
      acceptedRawScore: safe ? raw : null,
    });

    logEvent("refine.finished", {
      jobId: job.id,
      status: "completed",
      attempt: job.attempt_number,
      rawScore: raw,
      selected,
      latencyMs: Date.now() - startedAt,
    });
    return job.id;
  } catch (err) {
    logEvent("refine.unhandled", {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await fail("internal_error", "failed");
    return job.id;
  }
}

/**
 * Claim and execute ONE queued attempt-1 generation job (improve/edit/retry).
 * DURABLE model: POST /api/generate only queues the row and returns; this
 * executor owns all provider work, so a closed tab, an aborted request, or a
 * dead invocation never loses the seller's attempt. Triggers: after() in the
 * POST route, the status-poll GET (self-heal), and the worker route. The
 * atomic queued->generating claim makes concurrent triggers safe.
 * Chains the workflow's background refinements before returning.
 */
export async function runQueuedGenerationOnce(jobId?: string): Promise<string | null> {
  if (generationDisabled()) return null;
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("generation_jobs")
    .select("id")
    .eq("status", "queued")
    .in("operation", ["improve", "edit", "retry"])
    .order("created_at", { ascending: true })
    .limit(1);
  if (jobId) query = query.eq("id", jobId);
  const { data: candidates } = await query;
  const target = candidates?.[0];
  if (!target) return null;

  const { data: claimed } = await admin
    .from("generation_jobs")
    .update({
      status: "generating",
      stage: "preparing_source",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", target.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return null;
  const job = claimed as WorkflowJobRow;

  const patch = async (fields: Record<string, unknown>) => {
    await admin
      .from("generation_jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  };
  const fail = async (
    code: string,
    kind: "failed" | "rejected" | "cancelled",
    unresolvedIssues?: string[]
  ) => {
    const refund = kind !== "cancelled" && isRefundable(code);
    if (refund && job.allowance_key) await refundAllowance(job.allowance_key);
    await patch({
      status: kind,
      stage: null,
      error_code: code,
      refunded: refund,
      unresolved_issues: unresolvedIssues ?? [],
      completed_at: new Date().toISOString(),
    });
    logEvent("generate.finished", { jobId: job.id, status: kind, code });
    // A rejected/failed (non-refunded) attempt 1 still gets its bounded
    // background attempts — weak sources are helped, never abandoned.
    if (kind !== "cancelled" && !refund) {
      const queuedId = await maybeQueueRefinement({
        admin,
        completedJob: job,
        acceptedRawScore: null,
      });
      if (queuedId) await runQueuedRefinementChain(queuedId);
    }
  };

  const startedAt = Date.now();
  try {
    const entitlement = await getEntitlement(job.user_id);
    if (!entitlement.active || !entitlement.periodKey) {
      await fail(
        entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required",
        "cancelled"
      );
      return job.id;
    }
    if (!(await withinGlobalBudget("generate"))) {
      await fail("generation_disabled", "failed");
      return job.id;
    }

    // Atomic workflow charge (idempotent by allowance key: a re-run of the
    // same job can never double-charge).
    const charge = await consumeAllowance({
      userId: job.user_id,
      kind: "workflow",
      periodKey: entitlement.periodKey,
      idempotencyKey: job.allowance_key ?? `${job.user_id}:workflow:${job.idempotency_key}`,
      refId: job.id,
    });
    if (!charge.ok) {
      await fail(
        charge.code === "insufficient_credits" ? "insufficient_credits" : "internal_error",
        "cancelled"
      );
      return job.id;
    }
    await patch({ charged: 1 });

    // Owned photo (worker has no session; ownership enforced explicitly).
    const { data: photo } = await admin
      .from("photos")
      .select("id, role, storage_path, mime, product_id, products(user_id)")
      .eq("id", job.photo_id)
      .maybeSingle();
    const ownerId = (photo?.products as { user_id?: string } | null)?.user_id;
    if (!photo || ownerId !== job.user_id) {
      await fail("source_unavailable", "failed");
      return job.id;
    }

    // Baseline audit captured at queue time.
    const { data: auditRow } = await admin
      .from("audits")
      .select("id, rubric, score_cache_id")
      .eq("id", job.source_audit_id)
      .eq("photo_id", photo.id)
      .maybeSingle();
    const originalAudit = auditRow?.rubric as RubricJson | null;
    if (!originalAudit || !auditRow?.score_cache_id) {
      await fail("stale_audit", "failed");
      return job.id;
    }
    const mode: ImproveMode = photo.role === "main" ? "main" : "extra";

    const { data: originalBlob } = await admin.storage
      .from("product-photos")
      .download(photo.storage_path);
    if (!originalBlob) {
      await fail("source_unavailable", "failed");
      return job.id;
    }
    const originalBuffer = Buffer.from(await originalBlob.arrayBuffer());
    const originalMimeType =
      photo.mime === "image/png" ? ("image/png" as const) : ("image/jpeg" as const);

    // Optional base: parent_job_id on an attempt-1 row points at the previous
    // completed result the seller asked to build from (edit-from-preview,
    // retry-from-preview).
    let baseBuffer: Buffer | undefined;
    let promptAudit: RubricJson | undefined;
    if (job.parent_job_id) {
      const { data: prev } = await admin
        .from("generation_jobs")
        .select("id, status, photo_id, result_storage_path, candidate_rubric")
        .eq("id", job.parent_job_id)
        .eq("user_id", job.user_id)
        .maybeSingle();
      if (
        prev &&
        prev.status === "completed" &&
        prev.photo_id === photo.id &&
        prev.result_storage_path
      ) {
        const { data: baseBlob } = await admin.storage
          .from("product-photos")
          .download(prev.result_storage_path);
        if (baseBlob) {
          baseBuffer = Buffer.from(await baseBlob.arrayBuffer());
          promptAudit = (prev.candidate_rubric as RubricJson) ?? undefined;
        }
      }
    }

    // Retry constraints were stored on the row at queue time.
    const extraConstraints = sanitizeRetryConstraints(
      Array.isArray(job.unresolved_issues) ? job.unresolved_issues : []
    );

    // Supporting photos carry the listing context from the main photo's audit.
    let mainProductContext: string | undefined;
    if (mode === "extra" && photo.product_id) {
      const { data: mainPhoto } = await admin
        .from("photos")
        .select("id, audits(rubric, created_at)")
        .eq("product_id", photo.product_id)
        .eq("role", "main")
        .limit(1)
        .maybeSingle();
      const audits = (mainPhoto?.audits ?? []) as {
        rubric: RubricJson;
        created_at: string;
      }[];
      const latest = [...audits].sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      )[0];
      mainProductContext = latest?.rubric?.product_summary?.trim() || undefined;
    }

    await patch({ status: "generating", stage: "generating" });
    const result = await improvePhoto({
      originalBuffer,
      originalMimeType,
      originalAudit,
      baseBuffer,
      baseMimeType: baseBuffer ? "image/png" : undefined,
      promptAudit,
      extraConstraints,
      mainProductContext,
      mode,
      editInstruction: job.edit_instruction ?? undefined,
      onStage: async (stage) => {
        await patch({ status: stage, stage });
      },
    });

    if (!result.ok) {
      await fail(result.code, "failed", result.unresolvedIssues);
      return job.id;
    }

    const resultPath = `${job.user_id}/${photo.product_id}/generated/${job.id}.png`;
    const raw = rawOverall(result.candidateAudit);
    const safe = candidateIsSafe(result.fidelity, mode);
    const commit = await commitCompletedUpload({
      admin,
      jobId: job.id,
      userId: job.user_id,
      resultPath,
      imageBase64: result.imageBase64,
      completionFields: {
        candidate_rubric: result.candidateAudit,
        fidelity: result.fidelity,
        outcome: result.outcome,
        raw_score: raw,
        calibrated_score: calibrateScore(raw),
        calibration_rule: CALIBRATION_RULE,
        latency_ms: Date.now() - startedAt,
      },
    });
    if (!commit.ok) {
      if (commit.reason === "upload_failed") await fail("persistence_failed", "failed");
      // reason "deleted": the product/photo was deleted mid-generation, the job
      // row is gone, and the uploaded file was cleaned. Nothing to fail or queue.
      return job.id;
    }

    const selected = await applySelectionForCompletedJob({
      admin,
      userId: job.user_id,
      photoId: photo.id,
      productId: photo.product_id,
      jobId: job.id,
      operation: job.operation,
      candidateRubric: result.candidateAudit,
      candidateSafe: safe,
    });

    const refinementJobId = await maybeQueueRefinement({
      admin,
      completedJob: job,
      acceptedRawScore: safe ? raw : null,
    });

    logEvent("generate.finished", {
      jobId: job.id,
      status: "completed",
      outcome: result.outcome,
      rawScore: raw,
      selected,
      refinementQueued: Boolean(refinementJobId),
      latencyMs: Date.now() - startedAt,
    });

    if (refinementJobId) await runQueuedRefinementChain(refinementJobId);
    return job.id;
  } catch (err) {
    logEvent("generate.unhandled", {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await fail("internal_error", "failed");
    return job.id;
  }
}

/** Run the queued attempts for one workflow back-to-back (at most attempt 2). */
export async function runQueuedRefinementChain(firstJobId: string): Promise<void> {
  let jobId: string | null = firstJobId;
  for (let i = 0; i < MAX_ATTEMPTS_PER_WORKFLOW - 1 && jobId; i++) {
    const processed = await runQueuedRefinementOnce(jobId);
    if (!processed) return;
    const admin = createSupabaseAdminClient();
    const { data: current } = await admin
      .from("generation_jobs")
      .select("workflow_id, attempt_number")
      .eq("id", processed)
      .maybeSingle();
    if (!current?.workflow_id) return;
    const { data: next } = await admin
      .from("generation_jobs")
      .select("id")
      .eq("workflow_id", current.workflow_id)
      .eq("attempt_number", (current.attempt_number ?? 1) + 1)
      .eq("status", "queued")
      .maybeSingle();
    jobId = next?.id ?? null;
  }
}
