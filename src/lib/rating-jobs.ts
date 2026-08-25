import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scorePhoto, ScorePhotoError } from "@/lib/score-photo";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { hashImageBytes, hashText } from "@/lib/image-hash";
import { MAX_SUPPORTING_PHOTOS, rubricVersionFor } from "@/lib/versions";
import { getVisionModel } from "@/lib/openai";
import { getEntitlement } from "@/lib/entitlements";
import { consumeAllowance, refundAllowance } from "@/lib/allowances";
import { aiDisabled, withinGlobalBudget } from "@/lib/usage";
import { logEvent } from "@/lib/errors";
import type { RubricJson } from "@/lib/rubric";
import { resolveSupportingQuestionDependency } from "@/lib/buyer-question-dependency";

type RatingStatus =
  | "queued"
  | "waiting_dependency"
  | "scoring"
  | "completed"
  | "failed"
  | "cancelled";

type RatingJobRow = {
  id: string;
  user_id: string;
  product_id: string;
  photo_id: string;
  status: RatingStatus;
  attempt_count: number;
  allowance_key: string | null;
};

const STALE_RATING_MS = 3 * 60 * 1000;

async function failJob(
  job: RatingJobRow,
  code: string,
  message: string,
  refund: boolean
) {
  const admin = createSupabaseAdminClient();
  if (refund && job.allowance_key) await refundAllowance(job.allowance_key);
  await admin
    .from("rating_jobs")
    .update({
      status: "failed",
      error_code: code,
      error_message: message,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  logEvent("rating.finished", { jobId: job.id, status: "failed", code });
}

async function supportingDependency(productId: string) {
  const admin = createSupabaseAdminClient();
  const { data: mainPhoto, error: photoError } = await admin
    .from("photos")
    .select("id, current_audit_id")
    .eq("product_id", productId)
    .eq("role", "main")
    .limit(1)
    .maybeSingle();
  if (photoError) {
    logEvent("rating.dependency_lookup_failed", {});
    return { ready: false } as const;
  }
  if (!mainPhoto?.current_audit_id) return { ready: false } as const;
  const { data: audit, error: auditError } = await admin
    .from("audits")
    .select("rubric, rubric_version")
    .eq("id", mainPhoto.current_audit_id)
    .eq("photo_id", mainPhoto.id)
    .maybeSingle();
  if (auditError) {
    logEvent("rating.dependency_lookup_failed", {});
    return { ready: false } as const;
  }
  return resolveSupportingQuestionDependency({
    rubric: audit?.rubric,
    rubricVersion: audit?.rubric_version,
  });
}

async function waitForMainDependency(job: RatingJobRow): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("rating_jobs")
    .update({
      status: "waiting_dependency",
      attempt_count: Math.max(0, job.attempt_count - 1),
      started_at: null,
      error_code: "main_category_pending",
      error_message: "Waiting for the main photo check.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "scoring");
  if (error) throw new Error("rating_dependency_wait_failed");
}

/** Requeue waiting supporting ratings whose current main audit is now ready. */
export async function requeueReadyDependencyRatingJobIds(
  jobId?: string,
  productId?: string
): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("rating_jobs")
    .select("id, product_id")
    .eq("status", "waiting_dependency")
    .order("updated_at", { ascending: true })
    .limit(20);
  if (jobId) query = query.eq("id", jobId);
  if (productId) query = query.eq("product_id", productId);
  const { data: waiting, error: scanError } = await query;
  if (scanError) throw new Error("rating_dependency_scan_failed");
  const requeued: string[] = [];
  for (const row of waiting ?? []) {
    const dependency = await supportingDependency(row.product_id);
    if (!dependency.ready) continue;
    const { data: updated, error: updateError } = await admin
      .from("rating_jobs")
      .update({
        status: "queued",
        error_code: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "waiting_dependency")
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error("rating_dependency_requeue_failed");
    if (updated) requeued.push(updated.id);
  }
  return requeued;
}

export async function requeueReadyDependencyRatingJobs(
  jobId?: string,
  productId?: string
): Promise<number> {
  return (await requeueReadyDependencyRatingJobIds(jobId, productId)).length;
}

/** Claim and finish one persisted rating. Safe under concurrent worker calls. */
export async function runQueuedRatingOnce(
  jobId?: string
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("rating_jobs")
    .select("id, attempt_count")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);
  if (jobId) query = query.eq("id", jobId);
  const { data: candidates } = await query;
  const target = candidates?.[0];
  if (!target) return null;

  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("rating_jobs")
    .update({
      status: "scoring",
      attempt_count: (target.attempt_count ?? 0) + 1,
      started_at: now,
      updated_at: now,
      error_code: null,
      error_message: null,
    })
    .eq("id", target.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return null;
  const job = claimed as RatingJobRow;

  try {
    if (aiDisabled()) {
      await failJob(
        job,
        "ai_disabled",
        "AI scoring is temporarily disabled.",
        Boolean(job.allowance_key)
      );
      return job.id;
    }
    const entitlement = await getEntitlement(job.user_id);
    if (!entitlement.active || !entitlement.periodKey) {
      if (job.allowance_key) await refundAllowance(job.allowance_key);
      await admin
        .from("rating_jobs")
        .update({
          status: "cancelled",
          error_code: "subscription_required",
          error_message: "An active plan is needed to rate photos.",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return job.id;
    }

    const { data: photo } = await admin
      .from("photos")
      .select("id, role, storage_path, mime, product_id, products(user_id)")
      .eq("id", job.photo_id)
      .maybeSingle();
    const ownerId = (photo?.products as { user_id?: string } | null)?.user_id;
    if (!photo || ownerId !== job.user_id) {
      await failJob(job, "source_unavailable", "Saved photo not found.", false);
      return job.id;
    }

    const mode = photo.role === "main" ? "main" : "supporting";
    const dependency =
      mode === "supporting"
        ? await supportingDependency(photo.product_id)
        : null;
    if (dependency && !dependency.ready) {
      await waitForMainDependency(job);
      return job.id;
    }

    const { data: blob } = await admin.storage
      .from("product-photos")
      .download(photo.storage_path);
    if (!blob) {
      await failJob(job, "source_unavailable", "Saved photo not found.", false);
      return job.id;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const context = dependency?.ready
      ? dependency.mainProductContext
      : undefined;
    const imageHash = hashImageBytes(buffer);
    const rubricVersion = rubricVersionFor(mode);
    const contextHash = hashText(
      JSON.stringify({
        summary: context ?? "",
        buyerQuestions:
          dependency?.ready ? dependency.cacheContext : { category: "main" },
      })
    );

    let rubric: RubricJson | null = null;
    let scoreCacheId: string | null = null;
    const { data: cached } = await admin
      .from("score_cache")
      .select("id, rubric")
      .eq("user_id", job.user_id)
      .eq("image_hash", imageHash)
      .eq("mode", mode)
      .eq("rubric_version", rubricVersion)
      .eq("context_hash", contextHash)
      .maybeSingle();
    if (cached?.rubric) {
      rubric = cached.rubric as RubricJson;
      scoreCacheId = cached.id;
    } else {
      if (!(await withinGlobalBudget("score"))) {
        await failJob(
          job,
          "ai_disabled",
          "Daily capacity reached. Try again tomorrow.",
          Boolean(job.allowance_key)
        );
        return job.id;
      }
      const allowanceKey = `${job.user_id}:score:${entitlement.periodKey}:${imageHash}:${mode}:${rubricVersion}:${contextHash}`;
      const charge = await consumeAllowance({
        userId: job.user_id,
        kind: "assessment",
        periodKey: entitlement.periodKey,
        idempotencyKey: allowanceKey,
        refId: job.id,
      });
      if (!charge.ok) {
        await failJob(
          { ...job, allowance_key: null },
          charge.code,
          charge.code === "insufficient_credits"
            ? "Your rating credit ran out"
            : "Could not process the rating.",
          false
        );
        return job.id;
      }
      job.allowance_key = allowanceKey;
      await admin
        .from("rating_jobs")
        .update({ allowance_key: allowanceKey, updated_at: new Date().toISOString() })
        .eq("id", job.id);

      try {
        rubric = await scorePhoto({
          imageBuffer: buffer,
          imageMimeType: photo.mime || "image/jpeg",
          systemPrompt: mode === "supporting" ? GENERAL_RUBRIC_PROMPT : undefined,
          mainProductContext: context,
          buyerQuestions:
            mode === "main"
              ? { kind: "all" }
              : dependency?.ready
              ? dependency.buyerQuestions
              : { kind: "none" },
        });
      } catch (err) {
        const scoreError =
          err instanceof ScorePhotoError
            ? err
            : new ScorePhotoError("AI scoring failed. Try again.", "vision_failed");
        await failJob(job, scoreError.code, scoreError.message, true);
        return job.id;
      }

      const { data: inserted, error: insertError } = await admin
        .from("score_cache")
        .insert({
          user_id: job.user_id,
          image_hash: imageHash,
          mode,
          rubric_version: rubricVersion,
          model: getVisionModel(),
          context_hash: contextHash,
          rubric,
        })
        .select("id")
        .maybeSingle();
      if (insertError && insertError.code !== "23505") {
        await failJob(job, "persistence_failed", "The rating could not be saved.", true);
        return job.id;
      }
      scoreCacheId = inserted?.id ?? null;
      if (!scoreCacheId) {
        const { data: existing } = await admin
          .from("score_cache")
          .select("id")
          .eq("user_id", job.user_id)
          .eq("image_hash", imageHash)
          .eq("mode", mode)
          .eq("rubric_version", rubricVersion)
          .eq("context_hash", contextHash)
          .maybeSingle();
        scoreCacheId = existing?.id ?? null;
      }
    }

    if (!rubric || !scoreCacheId) {
      await failJob(job, "persistence_failed", "The rating could not be saved.", true);
      return job.id;
    }
    if (rubric.upload_kind === "invalid") {
      await failJob(
        job,
        "invalid_upload",
        "That image is not a product photo. Try another.",
        false
      );
      return job.id;
    }

    // The ONLY audit writer (0024): persists the audit (idempotent on
    // (photo_id, score_cache_id)) AND atomically advances
    // photos.current_audit_id under the same row lock select_generation_if_
    // stronger takes, so a rating completing here can never race a concurrent
    // improve's keep-better floor into comparing against a stale audit.
    const { data: auditId, error: auditError } = await admin.rpc(
      "persist_audit_and_advance_current",
      {
        p_user: job.user_id,
        p_photo: photo.id,
        p_kind: mode === "main" ? "main" : "supporting",
        p_rubric: rubric,
        p_overall_score: rubric.overall_score,
        p_rubric_version: rubricVersion,
        p_image_hash: imageHash,
        p_score_cache_id: scoreCacheId,
      }
    );
    if (auditError || !auditId) {
      await failJob(job, "persistence_failed", "The rating could not be saved.", true);
      return job.id;
    }

    await admin
      .from("rating_jobs")
      .update({
        status: "completed",
        score_cache_id: scoreCacheId,
        audit_id: auditId,
        error_code: null,
        error_message: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    logEvent("rating.finished", {
      jobId: job.id,
      status: "completed",
      score: rubric.overall_score,
    });
    if (mode === "main") {
      try {
        const unlockedJobIds = await requeueReadyDependencyRatingJobIds(
          undefined,
          job.product_id
        );
        const processedJobIds = await runQueuedRatingJobsById(unlockedJobIds, 3);
        logEvent("rating.dependency_continuation", {
          productId: job.product_id,
          unlocked: unlockedJobIds.length,
          processed: processedJobIds.length,
        });
      } catch {
        // The main rating is already durably complete. Reconciliation is a
        // separate backstop and must never rewrite that success as a failure.
        logEvent("rating.dependency_continuation_failed", {
          productId: job.product_id,
        });
      }
    }
    return job.id;
  } catch (err) {
    await failJob(
      job,
      "internal_error",
      err instanceof Error ? err.message : "Rating failed.",
      true
    );
    return job.id;
  }
}

/**
 * Process a frozen rating-job roster with bounded concurrency. Explicit IDs
 * keep this continuation scoped to the listing that just became ready; the
 * queued->scoring compare-and-set in runQueuedRatingOnce remains authoritative.
 */
export async function runQueuedRatingJobsById(
  jobIds: readonly string[],
  concurrency = 3
): Promise<string[]> {
  const limit = MAX_SUPPORTING_PHOTOS + 1;
  const uniqueIds = [...new Set(jobIds)].slice(0, limit);
  const width = Math.max(1, Math.min(3, Math.floor(concurrency) || 1));
  const processed: string[] = [];

  for (let offset = 0; offset < uniqueIds.length; offset += width) {
    const chunk = uniqueIds.slice(offset, offset + width);
    const results = await Promise.all(
      chunk.map((queuedJobId) => runQueuedRatingOnce(queuedJobId))
    );
    for (const result of results) {
      if (result) processed.push(result);
    }
  }

  return processed;
}

/** Drain one listing-sized batch of oldest queued ratings per worker tick. */
export async function runQueuedRatingBatch(limit = 10): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const boundedLimit = Math.max(
    1,
    Math.min(MAX_SUPPORTING_PHOTOS + 1, Math.floor(limit) || 1)
  );
  const { data: queued, error } = await admin
    .from("rating_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(boundedLimit);
  if (error) throw new Error("rating_batch_scan_failed");
  return runQueuedRatingJobsById(
    (queued ?? []).map((row) => row.id),
    3
  );
}

/** Requeue interrupted ratings; terminally fail and refund after three claims. */
export async function recoverStaleRatingJobs(jobId?: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - STALE_RATING_MS).toISOString();
  let query = admin
    .from("rating_jobs")
    .select("*")
    .eq("status", "scoring")
    .lt("updated_at", cutoff)
    .limit(20);
  if (jobId) query = query.eq("id", jobId);
  const { data: stale } = await query;
  let recovered = 0;
  for (const row of (stale as RatingJobRow[] | null) ?? []) {
    if (row.attempt_count >= 3) {
      await failJob(row, "provider_timeout", "Rating timed out. Try again.", true);
    } else {
      const { data: updated } = await admin
        .from("rating_jobs")
        .update({
          status: "queued",
          attempt_count: row.attempt_count,
          error_code: null,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "scoring")
        .select("id")
        .maybeSingle();
      if (updated) recovered++;
    }
  }
  return recovered;
}
