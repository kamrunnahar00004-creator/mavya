import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS_PER_WORKFLOW,
  REFINEMENT_STOP_RAW_SCORE,
  candidateIsSafe,
  resolveAutoSelection,
  shouldQueueRefinement,
} from "@/lib/workflow-rules";
import {
  CREDITS_PER_PERIOD,
  RATING_COST,
  WORKFLOW_COST,
} from "@/lib/allowances";
import type { FidelityReport } from "@/lib/fidelity";

const safeFidelity: FidelityReport = {
  publishable: true,
  fidelity_score: 8,
  authenticity_score: 8,
  full_product_visible: true,
  ai_looking: false,
  invented_or_missing_details: false,
  text_or_pattern_drift: false,
  collage_or_duplicate_product: false,
  remaining_issues: [],
  recommended_next_action: "deliver",
  reason: "Faithful.",
};

describe("paid-beta shared-credit constants (founder decisions)", () => {
  it("locks 1,000 monthly credits, action costs, and 3 attempts", () => {
    expect(CREDITS_PER_PERIOD).toBe(1000);
    expect(RATING_COST).toBe(10);
    expect(WORKFLOW_COST).toBe(20);
    expect(MAX_ATTEMPTS_PER_WORKFLOW).toBe(3);
    expect(REFINEMENT_STOP_RAW_SCORE).toBe(7.5);
  });
});

describe("shouldQueueRefinement (bounded background attempts)", () => {
  it("raw below 7.5 queues background refinement", () => {
    expect(shouldQueueRefinement({ attemptNumber: 1, acceptedRawScore: 7.4 })).toBe(true);
    expect(shouldQueueRefinement({ attemptNumber: 1, acceptedRawScore: 3.1 })).toBe(true);
    expect(shouldQueueRefinement({ attemptNumber: 2, acceptedRawScore: 7.4 })).toBe(true);
  });

  it("raw 7.5+ stops refinement (presents as 8.0; no fraction-chasing)", () => {
    expect(shouldQueueRefinement({ attemptNumber: 1, acceptedRawScore: 7.5 })).toBe(false);
    expect(shouldQueueRefinement({ attemptNumber: 1, acceptedRawScore: 7.9 })).toBe(false);
    expect(shouldQueueRefinement({ attemptNumber: 1, acceptedRawScore: 8.4 })).toBe(false);
  });

  it("an unsafe/rejected attempt (no accepted score) still refines", () => {
    expect(shouldQueueRefinement({ attemptNumber: 1, acceptedRawScore: null })).toBe(true);
    expect(shouldQueueRefinement({ attemptNumber: 2, acceptedRawScore: null })).toBe(true);
  });

  it("NEVER exceeds three total attempts", () => {
    expect(shouldQueueRefinement({ attemptNumber: 3, acceptedRawScore: null })).toBe(false);
    expect(shouldQueueRefinement({ attemptNumber: 3, acceptedRawScore: 1.0 })).toBe(false);
    expect(shouldQueueRefinement({ attemptNumber: 4, acceptedRawScore: null })).toBe(false);
  });
});

describe("resolveAutoSelection (score-based, never override the seller)", () => {
  it("a higher-scoring candidate is selected even with fidelity warnings (candidateSafe=false)", () => {
    // All generated images are shown. Warnings don't block selection.
    // Compare by score, not by safety flags.
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // Has warnings: drift, incomplete, AI-looking, etc.
        candidateRawScore: 9.0,
        currentRawScore: 5.0,
        currentSelectionSource: "auto",
      })
    ).toBe(true);
  });

  it("a weaker candidate cannot replace a stronger selection", () => {
    expect(
      resolveAutoSelection({
        operation: "retry",
        candidateSafe: true,
        candidateRawScore: 6.9,
        currentRawScore: 7.4,
        currentSelectionSource: "auto",
      })
    ).toBe(false);
  });

  it("an equal score keeps the current version (strictly better only)", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 7.4,
        currentRawScore: 7.4,
        currentSelectionSource: "auto",
      })
    ).toBe(false);
  });

  it("a strictly better safe candidate replaces an auto selection", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 7.8,
        currentRawScore: 7.2,
        currentSelectionSource: "auto",
      })
    ).toBe(true);
  });

  it("the seller's manual pick is never overwritten by background refinement", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 9.9,
        currentRawScore: 3.0,
        currentSelectionSource: "user",
      })
    ).toBe(false);
  });

  it("a NEW seller-initiated retry applies keep-better even after a manual pick", () => {
    // The seller reverted (selection_source='user'), then asked for another
    // version: that's explicit intent, so a strictly stronger result selects.
    expect(
      resolveAutoSelection({
        operation: "retry",
        candidateSafe: true,
        candidateRawScore: 9.9,
        currentRawScore: 3.0,
        currentSelectionSource: "user",
      })
    ).toBe(true);
    // ...but a weaker one still keeps the seller's pick.
    expect(
      resolveAutoSelection({
        operation: "retry",
        candidateSafe: true,
        candidateRawScore: 2.5,
        currentRawScore: 3.0,
        currentSelectionSource: "user",
      })
    ).toBe(false);
  });

  it("a seller-directed edit selects even when weaker (explicit intent)", () => {
    expect(
      resolveAutoSelection({
        operation: "edit",
        candidateSafe: true,
        candidateRawScore: 5.0,
        currentRawScore: 8.0,
        currentSelectionSource: "user",
      })
    ).toBe(true);
  });

  it("first safe result selects when nothing is selected yet", () => {
    expect(
      resolveAutoSelection({
        operation: "improve",
        candidateSafe: true,
        candidateRawScore: 4.0,
        currentRawScore: null,
        currentSelectionSource: null,
      })
    ).toBe(true);
  });

  it("first result selects when nothing is selected yet, even if candidateSafe=false (warnings)", () => {
    expect(
      resolveAutoSelection({
        operation: "improve",
        candidateSafe: false, // Has warnings but no current selection
        candidateRawScore: 3.1,
        currentRawScore: null,
        currentSelectionSource: null,
      })
    ).toBe(true);
  });

  it("an AI-looking candidate with higher score replaces auto selection", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // ai_looking=true
        candidateRawScore: 8.5,
        currentRawScore: 7.2,
        currentSelectionSource: "auto",
      })
    ).toBe(true);
  });

  it("an incomplete-product candidate with higher score replaces auto selection", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // full_product_visible=false
        candidateRawScore: 7.8,
        currentRawScore: 6.9,
        currentSelectionSource: "auto",
      })
    ).toBe(true);
  });

  it("a candidate with changed-details warning and higher score replaces auto selection", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // text_or_pattern_drift=true or invented_or_missing_details=true
        candidateRawScore: 8.2,
        currentRawScore: 7.1,
        currentSelectionSource: "auto",
      })
    ).toBe(true);
  });

  it("a weaker AI-looking candidate does NOT replace auto selection", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // ai_looking=true
        candidateRawScore: 6.8,
        currentRawScore: 7.2,
        currentSelectionSource: "auto",
      })
    ).toBe(false);
  });

  it("background refinement cannot overwrite seller choice", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 9.9, // Much higher score
        currentRawScore: 3.0,
        currentSelectionSource: "user", // Seller chose this
      })
    ).toBe(false);
  });
});

describe("candidateIsSafe (product-drift never normalized)", () => {
  it("accepts a faithful candidate and rejects known drift", () => {
    expect(candidateIsSafe(safeFidelity, "main")).toBe(true);
    expect(candidateIsSafe({ ...safeFidelity, text_or_pattern_drift: true }, "main")).toBe(false);
    expect(
      candidateIsSafe({ ...safeFidelity, invented_or_missing_details: true }, "main")
    ).toBe(false);
    expect(
      candidateIsSafe({ ...safeFidelity, collage_or_duplicate_product: true }, "main")
    ).toBe(false);
    expect(candidateIsSafe({ ...safeFidelity, full_product_visible: false }, "main")).toBe(false);
    expect(candidateIsSafe(null, "main")).toBe(false);
  });
});
