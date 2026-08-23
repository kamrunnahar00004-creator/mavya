import { createHash } from "node:crypto";
import type { ApiErrorCode } from "@/lib/errors";
import type { QueueGenerationOutcome } from "@/lib/generation-queue";
import { isFixAllEligible, type FixEligibilityBucket } from "@/lib/fix-eligibility";

/**
 * Pure "Fix all" (Slice 4b, 2026-08-23) roster logic, kept separate from the
 * route (src/app/api/generate/bulk/route.ts) so the classification and
 * outcome-mapping rules are directly unit-testable without a database.
 */

export type BulkPhotoStatus = "queued" | "skipped" | "failed";

/** Stable, machine-readable skip/failure reasons (Codex finding 5). */
export type BulkSkipReason =
  | "strong"
  | "not_generatable"
  | "already_improved"
  | "already_active"
  | "stale_audit"
  | "capacity"
  | "queue_failed";

export type BulkRosterEntry = {
  photoId: string;
  status: BulkPhotoStatus;
  jobId?: string;
  reason?: BulkSkipReason;
};

export type BulkSummary = { total: number; queued: number; skipped: number; failed: number };

/**
 * Server hash of user, product, bulk request, and photo IDs (Codex
 * instruction, verbatim). "Bulk request" is identified by the client's own
 * bulk idempotencyKey -- deliberately, not a DB-generated
 * bulk_generation_requests.id: two concurrent requests racing on the SAME
 * idempotencyKey must derive the IDENTICAL per-photo key for every photo,
 * so the underlying generation_jobs.idempotency_key unique constraint (not
 * a coin-flip over which racer's DB row wins first) is what actually
 * serializes them. Retrying the same bulk idempotencyKey later re-derives
 * the same per-photo keys too, so queueGeneration's own idempotency replay
 * makes a bulk retry a no-op re-queue rather than a fresh duplicate.
 */
export function deriveBulkPhotoKey(
  userId: string,
  productId: string,
  bulkIdempotencyKey: string,
  photoId: string
): string {
  return createHash("sha256")
    .update(`bulk:${userId}:${productId}:${bulkIdempotencyKey}:${photoId}`)
    .digest("hex");
}

export type PhotoEligibilityInput = {
  /** False when the photo has no current_audit_id, or the audit row is a
   *  legacy row missing rubric/score_cache_id. computeFixEligibilityBucket
   *  cannot even be called in that case. */
  hasCurrentAudit: boolean;
  bucket: FixEligibilityBucket | null;
  /** photos.selected_generation_job_id is set: the seller already has an
   *  improved version selected for this photo. */
  alreadyImproved: boolean;
};

export type PhotoEligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: BulkSkipReason };

/**
 * Full "Fix all" OPERATIONAL eligibility for one photo (Codex finding 4):
 * computeFixEligibilityBucket's intrinsic bucket, PLUS the per-request
 * conditions it cannot see. Checked in this order so the most specific,
 * most informative reason wins: a stale audit is reported as stale_audit
 * even if the seller separately already improved the photo, since without a
 * current audit there is nothing to re-derive a bucket from at all.
 */
export function classifyPhotoForBulkFix(input: PhotoEligibilityInput): PhotoEligibilityVerdict {
  if (!input.hasCurrentAudit || !input.bucket) {
    return { eligible: false, reason: "stale_audit" };
  }
  if (!isFixAllEligible(input.bucket)) {
    return { eligible: false, reason: input.bucket === "strong" ? "strong" : "not_generatable" };
  }
  if (input.alreadyImproved) return { eligible: false, reason: "already_improved" };
  return { eligible: true };
}

/** Gate error codes queueGeneration can still return even after
 *  classifyPhotoForBulkFix passed (a TOCTOU edge: the audit changed between
 *  the bulk route's own bucket computation and queueGeneration's independent
 *  re-fetch). Mapped to the same "not_generatable" reason the intrinsic
 *  bucket would have reported, never a raw/unstable error code. */
const GATE_CODES_AS_NOT_GENERATABLE: ReadonlySet<ApiErrorCode> = new Set([
  "unsupported_digital_generation",
  "unsupported_graphic_generation",
  "unsupported_product",
  "wrong_product",
]);

/**
 * Maps one photo's queueGeneration() result to its final roster entry.
 * Partial failure is explicit (Codex finding 5): a failure here never
 * throws and never affects any other photo's entry.
 */
export function rosterEntryFromQueueOutcome(
  photoId: string,
  outcome: QueueGenerationOutcome
): BulkRosterEntry {
  if (!outcome.ok) {
    if (outcome.code === "stale_audit") return { photoId, status: "skipped", reason: "stale_audit" };
    if (outcome.code === "generation_disabled") {
      return { photoId, status: "skipped", reason: "capacity" };
    }
    if (GATE_CODES_AS_NOT_GENERATABLE.has(outcome.code)) {
      return { photoId, status: "skipped", reason: "not_generatable" };
    }
    // Anything else (internal_error, idempotency_conflict, source_unavailable,
    // a genuine infra failure) is a real per-photo failure.
    return { photoId, status: "failed", reason: "queue_failed" };
  }
  if (outcome.job === null) {
    // same_key_race: a concurrent duplicate of THIS photo's derived key lost
    // the insert race to another in-flight request for the same key. The
    // photo's fix genuinely is queued (by the winner); no jobId to report
    // without an extra read, matching /api/generate's own same-key-race
    // response shape.
    return { photoId, status: "queued" };
  }
  if (outcome.origin === "active_root_conflict") {
    return { photoId, status: "skipped", reason: "already_active", jobId: outcome.job.id };
  }
  return { photoId, status: "queued", jobId: outcome.job.id };
}

export function buildBulkSummary(roster: readonly BulkRosterEntry[]): BulkSummary {
  return roster.reduce<BulkSummary>(
    (acc, entry) => {
      acc.total += 1;
      acc[entry.status] += 1;
      return acc;
    },
    { total: 0, queued: 0, skipped: 0, failed: 0 }
  );
}
