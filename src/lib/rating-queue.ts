/**
 * Pure response handling for the durable rating queue (POST /api/score/jobs).
 * Extracted from the add-product dialog so the post-queue behavior is
 * unit-testable: a successful queue means the SERVER owns the rating from
 * that moment; the browser only closes its UI and refreshes the dashboard.
 */

export type RatingQueueResult =
  | { ok: true; productId: string; jobId: string }
  | { ok: false; message: string };

/** Map a failed queue response to the message the seller should see. */
export function ratingQueueErrorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as { error?: unknown; code?: unknown };
  const code = typeof b.code === "string" ? b.code : "";
  if (code === "insufficient_credits") return "Your rating credit ran out";
  if (code === "active_listing_limit_reached") {
    return "You've reached your active listing limit. Delete a listing to free a slot.";
  }
  if (code === "subscription_required" || code === "subscription_past_due") {
    return "An active plan is needed to rate photos. Check Settings to update billing.";
  }
  if (code === "unauthenticated") return "Your session expired. Log in again.";
  if (typeof b.error === "string" && b.error) return b.error;
  return `Scoring failed (${status})`;
}

/** Parse a successful queue response; the job is durable once this is ok. */
export function parseRatingQueueResponse(body: unknown): RatingQueueResult {
  const b = (body ?? {}) as { productId?: unknown; jobId?: unknown };
  const productId = typeof b.productId === "string" ? b.productId : "";
  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  if (!productId || !jobId) {
    return { ok: false, message: "Could not create the product." };
  }
  return { ok: true, productId, jobId };
}
