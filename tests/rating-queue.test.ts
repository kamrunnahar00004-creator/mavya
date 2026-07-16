import { describe, expect, it } from "vitest";
import {
  parseRatingQueueResponse,
  ratingQueueErrorMessage,
} from "@/lib/rating-queue";

describe("post-queue behavior (durable rating handoff)", () => {
  it("a queued response with product and job ids is a durable success", () => {
    const result = parseRatingQueueResponse({
      productId: "prod-1",
      jobId: "job-1",
      status: "queued",
    });
    expect(result).toEqual({ ok: true, productId: "prod-1", jobId: "job-1" });
  });

  it("a response missing the job id is a visible failure, never a hang", () => {
    expect(parseRatingQueueResponse({ productId: "prod-1" })).toEqual({
      ok: false,
      message: "Could not create the product.",
    });
    expect(parseRatingQueueResponse(null)).toEqual({
      ok: false,
      message: "Could not create the product.",
    });
  });

  it("maps credit exhaustion to the founder-approved copy", () => {
    expect(
      ratingQueueErrorMessage({ code: "insufficient_credits" }, 402)
    ).toBe("Your rating credit ran out");
  });

  it("maps subscription states to the billing message", () => {
    const expected =
      "An active plan is needed to rate photos. Check Settings to update billing.";
    expect(ratingQueueErrorMessage({ code: "subscription_required" }, 403)).toBe(
      expected
    );
    expect(ratingQueueErrorMessage({ code: "subscription_past_due" }, 403)).toBe(
      expected
    );
  });

  it("maps an expired session and falls back to server error text", () => {
    expect(ratingQueueErrorMessage({ code: "unauthenticated" }, 401)).toBe(
      "Your session expired. Log in again."
    );
    expect(ratingQueueErrorMessage({ error: "Photo too large." }, 400)).toBe(
      "Photo too large."
    );
    expect(ratingQueueErrorMessage(null, 500)).toBe("Scoring failed (500)");
  });
});
