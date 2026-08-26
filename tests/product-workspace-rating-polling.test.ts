import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyRatingPollResult,
  isExpectedPendingRatingStatus,
  ratingPollRecoveryAction,
  RATING_POLL_ANOMALY_DELAY_AFTER,
  RATING_POLL_ANOMALY_REFRESH_AFTER,
  shouldHydrateCompletedRating,
} from "../src/lib/rating-poll";

const source = readFileSync(
  path.resolve("src/components/dashboard/product-workspace.tsx"),
  "utf8"
);

describe("rating poll decisions", () => {
  it.each(["queued", "waiting_dependency", "scoring", undefined, "unknown"])(
    "keeps %s unsettled",
    (status) => {
      expect(classifyRatingPollResult(status, false)).toBe("pending");
    }
  );

  it("does not terminate a completed response without a rubric", () => {
    expect(classifyRatingPollResult("completed", false)).toBe("pending");
    expect(isExpectedPendingRatingStatus("completed")).toBe(false);
  });

  it("grades only a completed response with a rubric", () => {
    expect(classifyRatingPollResult("completed", true)).toBe("graded");
  });

  it.each(["failed", "cancelled"])(
    "treats explicit %s as failed",
    (status) => {
      expect(classifyRatingPollResult(status, false)).toBe("failed");
    }
  );
});

describe("missing rating-job recovery", () => {
  it("continues during the initial consistency grace period", () => {
    expect(ratingPollRecoveryAction(1)).toBe("continue");
    expect(
      ratingPollRecoveryAction(RATING_POLL_ANOMALY_REFRESH_AFTER - 1)
    ).toBe("continue");
  });

  it("requests one server refresh at the configured threshold", () => {
    expect(ratingPollRecoveryAction(RATING_POLL_ANOMALY_REFRESH_AFTER)).toBe(
      "refresh"
    );
  });

  it("continues after refresh while still inside the bounded window", () => {
    expect(
      ratingPollRecoveryAction(RATING_POLL_ANOMALY_REFRESH_AFTER + 1)
    ).toBe("continue");
  });

  it("moves to a retryable delayed state instead of spinning forever", () => {
    expect(ratingPollRecoveryAction(RATING_POLL_ANOMALY_DELAY_AFTER)).toBe(
      "delay"
    );
    expect(ratingPollRecoveryAction(RATING_POLL_ANOMALY_DELAY_AFTER + 5)).toBe(
      "delay"
    );
  });

  it("recognizes only the three legitimate in-progress statuses", () => {
    expect(isExpectedPendingRatingStatus("queued")).toBe(true);
    expect(isExpectedPendingRatingStatus("waiting_dependency")).toBe(true);
    expect(isExpectedPendingRatingStatus("scoring")).toBe(true);
    expect(isExpectedPendingRatingStatus(undefined)).toBe(false);
    expect(isExpectedPendingRatingStatus("future_status")).toBe(false);
  });
});

describe("same-product refresh reconciliation", () => {
  it.each(["analyzing", "delayed", "failed"] as const)(
    "hydrates a completed server rating over local %s state",
    (status) => {
      expect(shouldHydrateCompletedRating(status, true)).toBe(true);
    }
  );

  it("does not overwrite an already graded photo or hydrate without a rubric", () => {
    expect(shouldHydrateCompletedRating("graded", true)).toBe(false);
    expect(shouldHydrateCompletedRating("analyzing", false)).toBe(false);
  });
});

describe("product-workspace rating-poll wiring", () => {
  it("uses independent timers and an optional photo-id fallback", () => {
    expect(source).toContain('const key = `rating:${photoId}`;');
    expect(source).toContain("(photoId: string, jobId?: string)");
    expect(source).toContain('`photoId=${encodeURIComponent(photoId)}`');
    expect(source).toContain("queryByJobId = false;");
  });

  it("prevents overlapping async requests for the same photo", () => {
    expect(source).toContain("if (inFlight) return;");
    expect(source).toContain("inFlight = true;");
    expect(source).toContain("finally {");
    expect(source).toContain("inFlight = false;");
  });

  it("preserves anomaly counts across an automatic router refresh", () => {
    expect(source).toContain("const ratingPollAnomalies = useRef<");
    expect(source).toContain(
      "const anomalies = (ratingPollAnomalies.current[photoId] ??="
    );
    expect(source).toContain(
      "delete ratingPollAnomalies.current[photo.id];"
    );
  });

  it("clears the timer only after the pure classifier returns terminal", () => {
    const classifier = source.indexOf("const decision = classifyRatingPollResult(");
    const pending = source.indexOf('if (decision === "pending") {', classifier);
    const clear = source.indexOf("clearInterval(pollTimers.current[key]);", pending);
    expect(classifier).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(classifier);
    expect(clear).toBeGreaterThan(pending);
  });

  it("keeps per-photo functional patches and both resume effects", () => {
    expect(source).toContain(
      "setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));"
    );
    expect(source.match(/pollRating\(p\.id, p\.ratingJob\?\.id\)/g)).toHaveLength(2);
  });

  it("offers a bounded delayed-state retry instead of a false failure", () => {
    expect(source).toContain('status: "delayed"');
    expect(source).toContain("Check rating again");
    expect(source).toContain("pollRating(photo.id, photo.ratingJobId);");
    expect(source).toContain("recoverFromAnomaly(anomalies.malformed);");
    expect(source).toContain(
      "recoverFromAnomaly(anomalies.requestFailures);"
    );
    expect(source).toContain("Back to main photo");
  });

  it("merges completed same-product refresh props without resetting all photo state", () => {
    expect(source).toContain("shouldHydrateCompletedRating(");
    expect(source).toContain("const hydrated = makePhoto(incoming);");
    expect(source).toContain("return changed ? reconciled : currentPhotos;");
  });
});

describe("rating status endpoint uses the authoritative audit pointer", () => {
  const route = readFileSync(
    path.resolve("src/app/api/score/jobs/route.ts"),
    "utf8"
  );

  it("loads photos.current_audit_id and fetches that exact audit", () => {
    expect(route).toContain('.select("storage_path, current_audit_id")');
    expect(route).toContain("if (photo?.current_audit_id)");
    expect(route).toContain('.eq("id", photo.current_audit_id)');
    expect(route).toContain('.eq("photo_id", job.photo_id)');
  });

  it("does not independently sort an embedded audits relation", () => {
    expect(route).not.toContain("audits(rubric, created_at)");
    expect(route).not.toContain("localeCompare");
  });
});
