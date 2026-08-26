export type RatingPollDecision = "pending" | "graded" | "failed";

export const RATING_POLL_ANOMALY_REFRESH_AFTER = 3;
export const RATING_POLL_ANOMALY_DELAY_AFTER = 12;

/**
 * Decide whether a rating response is truly terminal. Missing or unfamiliar
 * data is never converted into a failure; only the database's explicit
 * failed/cancelled states may do that.
 */
export function classifyRatingPollResult(
  status: unknown,
  hasRubric: boolean
): RatingPollDecision {
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "completed" && hasRubric) return "graded";
  return "pending";
}

export function isExpectedPendingRatingStatus(status: unknown): boolean {
  return (
    status === "queued" ||
    status === "waiting_dependency" ||
    status === "scoring"
  );
}

/**
 * A same-product server refresh must be allowed to fill in a rating that the
 * client poll missed. It must not replace an already-live graded photo, whose
 * client state may also contain generation/edit progress not present in the
 * refreshed server snapshot.
 */
export function shouldHydrateCompletedRating(
  currentStatus: "analyzing" | "graded" | "delayed" | "failed",
  incomingHasRubric: boolean
): boolean {
  return incomingHasRubric && currentStatus !== "graded";
}

export type RatingPollRecoveryAction = "continue" | "refresh" | "delay";

/** Bounded recovery policy for a missing job or malformed terminal payload. */
export function ratingPollRecoveryAction(
  consecutiveAnomalousResponses: number
): RatingPollRecoveryAction {
  if (consecutiveAnomalousResponses >= RATING_POLL_ANOMALY_DELAY_AFTER) {
    return "delay";
  }
  if (consecutiveAnomalousResponses === RATING_POLL_ANOMALY_REFRESH_AFTER) {
    return "refresh";
  }
  return "continue";
}
