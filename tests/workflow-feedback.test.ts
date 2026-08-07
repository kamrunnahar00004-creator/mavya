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

  it("rejects a SUPPLIED wrong-type boolean/text field instead of silently nulling it", () => {
    // A malformed client (or bug) sending the wrong shape must fail loudly, not
    // look identical to "the seller said nothing" and quietly erase intent.
    expect(buildWorkflowFeedbackFields({ wouldUse: "yes" }).ok).toBe(false);
    expect(buildWorkflowFeedbackFields({ wouldUse: 1 }).ok).toBe(false);
    expect(buildWorkflowFeedbackFields({ rejectionReason: 123 }).ok).toBe(false);
    expect(buildWorkflowFeedbackFields({ rejectionReason: true }).ok).toBe(false);
  });

  it("an explicit null clears that column for bool/text/star fields (still a supplied field)", () => {
    expect(buildWorkflowFeedbackFields({ imageRating: null })).toEqual({
      ok: true,
      fields: { image_rating: null },
    });
    expect(buildWorkflowFeedbackFields({ wouldUse: null })).toEqual({
      ok: true,
      fields: { would_use: null },
    });
    expect(buildWorkflowFeedbackFields({ rejectionReason: null })).toEqual({
      ok: true,
      fields: { rejection_reason: null },
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

describe("deriveWorkflowRootId (feedback targets the LATEST completed workflow)", () => {
  it("returns the attempt-1 id when the root is present", () => {
    expect(
      deriveWorkflowRootId([
        { id: "root", attemptNumber: 1, workflowId: null, createdAt: "2026-01-01T00:00:00Z" },
        { id: "a2", attemptNumber: 2, workflowId: "root", createdAt: "2026-01-01T00:05:00Z" },
      ])
    ).toBe("root");
  });

  it("derives the root from workflowId when attempt 1 FAILED (only a2 completed)", () => {
    // The unsafe fallback used to return a2's id (a non-root) which the API
    // rejects. workflowId carries the true root.
    expect(
      deriveWorkflowRootId([{ id: "a2", attemptNumber: 2, workflowId: "root", createdAt: "2026-01-01T00:00:00Z" }])
    ).toBe("root");
  });

  it("targets the NEWEST workflow, not whichever entry happens to be first", () => {
    // versions is oldest-first from hydration: an old workflow's root sits at
    // index 0. Feedback must attach to the most recently completed workflow.
    const old = { id: "old-root", attemptNumber: 1, workflowId: null, createdAt: "2026-01-01T00:00:00Z" };
    const recent = { id: "new-root", attemptNumber: 1, workflowId: null, createdAt: "2026-01-02T00:00:00Z" };
    expect(deriveWorkflowRootId([old, recent])).toBe("new-root");
  });

  it("targets the newest workflow even when ITS attempt 1 failed (only attempt 2 present)", () => {
    // Two full workflows: an old one that completed cleanly on attempt 1, and a
    // newer one whose attempt 1 failed so only its attempt 2 shows as a
    // completed version. The root must resolve to the NEW workflow via its
    // attempt-2 entry's workflowId, not fall back to the old workflow.
    const oldRoot = { id: "old-root", attemptNumber: 1, workflowId: null, createdAt: "2026-01-01T00:00:00Z" };
    const newAttempt2 = { id: "new-a2", attemptNumber: 2, workflowId: "new-root", createdAt: "2026-01-03T00:00:00Z" };
    expect(deriveWorkflowRootId([oldRoot, newAttempt2])).toBe("new-root");
    // Order in the array must not matter.
    expect(deriveWorkflowRootId([newAttempt2, oldRoot])).toBe("new-root");
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

describe("feedback route sets the upsert options defensively", () => {
  const route = readFileSync(
    path.resolve("src/app/api/feedback/workflow/route.ts"),
    "utf8"
  );

  it("passes defaultToNull: false so a future switch to a batch upsert cannot null-fill gaps", () => {
    expect(route).toContain("defaultToNull: false");
  });

  it("builds the patch from the field builder, not an inline all-columns object", () => {
    expect(route).toContain("buildWorkflowFeedbackFields(body)");
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
