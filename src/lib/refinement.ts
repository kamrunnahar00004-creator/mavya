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
import { generationDisabled, withinGlobalBudget } from "@/lib/usage";
import { refundAllowance } from "@/lib/allowances";
import { logEvent } from "@/lib/errors";
import { getImageModel } from "@/lib/openai";
import { GENERATION_PROMPT_VERSION } from "@/lib/versions";
import { getEntitlement } from "@/lib/entitlements";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import type { GenerationJobStatus } from "@/lib/generation-types";

/**
 * Bounded background refinement (attempts 2-3 of an improvement workflow).
 *
 * Durability model (no external queue dependency): a refinement attempt is a
 * `generation_jobs` ROW in status 'queued'. Executors CLAIM it with an atomic
 * compare-and-set (queued -> generating), so duplicate executors cannot run
 * the same attempt twice. Triggers, in order of reliability:
 *   1. `after()` in the generate route (best effort, same serverless invocation).
 *   2. The /api/generate/worker route, callable by Vercel Cron / any scheduler
 *      with the WORKER_SECRET (durable backstop; also recovers stale jobs).
 * The DB constraints are the real safety: attempt_number <= 3 (CHECK) and one
 * active refinement per workflow (partial unique index).
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
 * Charged 0: attempts 2-3 are internal quality work inside the already-charged
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
      // Edit workflows carry the seller's instruction into attempts 2-3 so a
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

/** Fail active jobs stuck longer than 10 minutes; refund attempt-1 allowances. */
export async function recoverStaleJobs(admin: AdminClient): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  // Queued rows are waiting for an executor, not stuck; the worker picks them
  // up in the same pass, so only actively-running states are recovered here.
  const { data: stale } = await admin
    .from("generation_jobs")
    .select(
      "id, user_id, product_id, photo_id, source_audit_id, operation, edit_instruction, workflow_id, attempt_number, allowance_key, credit_key"
    )
    .in("status", ["generating", "fidelity_check", "rescoring"])
    .lt("updated_at", cutoff)
    .limit(20);
  let failed = 0;
  for (const job of stale ?? []) {
    const { data: updated } = await admin
      .from("generation_jobs")
      .update({
        status: "failed",
        error_code: "provider_timeout",
        refunded: true,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["generating", "fidelity_check", "rescoring"])
      .select("id")
      .maybeSingle();
    if (updated) {
      failed++;
      // Only the charged attempt (attempt 1) consumed a workflow allowance.
      if ((job.attempt_number ?? 1) === 1 && job.allowance_key) {
        await refundAllowance(job.allowance_key);
      }
      // A timeout is still a failed bounded attempt. Queue the next attempt
      // immediately so recovery does not wait for the next scheduler tick.
      await maybeQueueRefinement({
        admin,
        completedJob: {
          id: job.id,
          user_id: job.user_id,
          product_id: job.product_id,
          photo_id: job.photo_id,
          source_audit_id: job.source_audit_id,
          operation: job.operation,
          edit_instruction: job.edit_instruction,
          workflow_id: job.workflow_id,
          attempt_number: job.attempt_number,
          allowance_key: job.allowance_key,
        },
        acceptedRawScore: null,
      });
      logEvent("refine.stale_failed", { jobId: job.id });
    }
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
      // Attempts 2-3 never consumed an allowance; nothing to refund. isRefundable
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
      // attempt when one remains (never beyond three total).
      await maybeQueueRefinement({
        admin,
        completedJob: job,
        acceptedRawScore: null,
      });
      return job.id;
    }

    const resultPath = `${job.user_id}/${photo.product_id}/generated/${job.id}.png`;
    const { error: upErr } = await admin.storage
      .from("product-photos")
      .upload(resultPath, Buffer.from(result.imageBase64, "base64"), {
        contentType: "image/png",
        upsert: true,
      });
    if (upErr) {
      await fail("persistence_failed", "failed");
      return job.id;
    }

    const safe = candidateIsSafe(result.fidelity, mode);
    const raw = rawOverall(result.candidateAudit);
    await patch({
      status: "completed",
      stage: null,
      result_storage_path: resultPath,
      candidate_rubric: result.candidateAudit,
      fidelity: result.fidelity,
      outcome: result.outcome,
      raw_score: raw,
      calibrated_score: calibrateScore(raw),
      calibration_rule: CALIBRATION_RULE,
      latency_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
    });

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

/** Run the queued attempts for one workflow back-to-back (at most attempts 2-3). */
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
