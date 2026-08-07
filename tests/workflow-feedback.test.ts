import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkflowFeedbackFields,
  FEEDBACK_MAX_TEXT,
} from "@/lib/workflow-feedback";
import { deriveWorkflowRootId } from "@/lib/selection-display";

describe("buildWorkflowFeedbackFields (patch semantics, no data loss)", () => {
  it("includes only SUPPLIED fields, so omitted columns are preserved on upsert", () => {
    const r = buildWorkflowFeedbackFields({ ratingAgreement: 4 });
    expect(r).toEqual({ ok: true, fields: { rating_agreement: 4 } });
    // Legacy boolean columns are NOT in the patch -> upsert leaves them intact.
    expect(Object.keys((r as { fields: object }).fields)).not.toContain(
      "better_than_original"
    );
    expect(Object.keys((r as { fields: object }).fields)).not.toContain(
      "image_rating"
    );
  });

  it("accepts both stars + notes together", () => {
    const r = buildWorkflowFeedbackFields({
      ratingAgreement: 5,
      imageRating: 2,
      ratingAgreementNote: "  spot on ",
      imageRatingNote: "meh",
    });
    expect(r).toEqual({
      ok: true,
      fields: {
        rating_agreement: 5,
        image_rating: 2,
        rating_agreement_note: "spot on",
        image_rating_note: "meh",
      },
    });
  });

  it("rejects a SUPPLIED invalid star with an error (never a silent null)", () => {
    for (const bad of [0, 6, 7, 2.5, "3", true, {}]) {
      const r = buildWorkflowFeedbackFields({ ratingAgreement: bad });
      expect(r.ok, `value ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("an explicit null star clears that column (but is still a supplied field)", () => {
    expect(buildWorkflowFeedbackFields({ imageRating: null })).toEqual({
      ok: true,
      fields: { image_rating: null },
    });
  });

  it("an empty submit (no recognized fields) is a 400", () => {
    expect(buildWorkflowFeedbackFields({}).ok).toBe(false);
    expect(buildWorkflowFeedbackFields({ nonsense: 1 }).ok).toBe(false);
  });

  it("caps note length and preserves legacy boolean feedback shape", () => {
    const long = "x".repeat(FEEDBACK_MAX_TEXT + 50);
    const r = buildWorkflowFeedbackFields({
      wouldUse: true,
      rejectionReason: long,
    });
    expect(r.ok).toBe(true);
    const fields = (r as { fields: Record<string, unknown> }).fields;
    expect(fields.would_use).toBe(true);
    expect((fields.rejection_reason as string).length).toBe(FEEDBACK_MAX_TEXT);
  });
});

describe("deriveWorkflowRootId (feedback targets the attempt-1 root only)", () => {
  it("returns the attempt-1 id when the root is present", () => {
    expect(
      deriveWorkflowRootId([
        { id: "root", attemptNumber: 1, workflowId: null },
        { id: "a2", attemptNumber: 2, workflowId: "root" },
      ])
    ).toBe("root");
  });

  it("derives the root from workflowId when attempt 1 FAILED (only a2 completed)", () => {
    // The unsafe fallback used to return a2's id (a non-root) which the API
    // rejects. workflowId carries the true root.
    expect(
      deriveWorkflowRootId([{ id: "a2", attemptNumber: 2, workflowId: "root" }])
    ).toBe("root");
  });

  it("never returns a non-root version id", () => {
    // A lone refinement with no workflowId cannot resolve to a root.
    expect(
      deriveWorkflowRootId([{ id: "a2", attemptNumber: 2 }])
    ).toBeNull();
  });

  it("returns null for no versions", () => {
    expect(deriveWorkflowRootId([])).toBeNull();
    expect(deriveWorkflowRootId(undefined)).toBeNull();
  });
});

describe("feedback nudge only completes on a successful save", () => {
  const nudge = readFileSync(
    path.resolve("src/components/feedback-nudge.tsx"),
    "utf8"
  );

  it("gates completion on response.ok and keeps the form open on failure", () => {
    expect(nudge).toContain("ok = res.ok");
    // On failure it must NOT persist dismissal or mark done.
    expect(nudge).toMatch(/if \(!ok\)[\s\S]*setFailed\(true\)[\s\S]*return;/);
  });
});
