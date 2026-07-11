import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS_PER_WORKFLOW,
  REFINEMENT_STOP_RAW_SCORE,
  candidateIsSafe,
  resolveAutoSelection,
  shouldQueueRefinement,
} from "@/lib/workflow-rules";
import {
  ASSESSMENTS_PER_PERIOD,
  WORKFLOWS_PER_PERIOD,
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

describe("paid-beta allowance constants (founder decisions)", () => {
  it("locks 20 assessments / 12 workflows / 3 attempts", () => {
    expect(ASSESSMENTS_PER_PERIOD).toBe(20);
    expect(WORKFLOWS_PER_PERIOD).toBe(12);
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

describe("resolveAutoSelection (never downgrade, never override the seller)", () => {
  it("an unsafe candidate can never be selected, even with a higher score", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: false,
        candidateRawScore: 9.0,
        currentRawScore: 5.0,
        currentSelectionSource: "auto",
      })
    ).toBe(false);
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

  it("the seller's manual pick is never overwritten automatically", () => {
    expect(
      resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 9.9,
        currentRawScore: 3.0,
        currentSelectionSource: "user",
      })
    ).toBe(false);
    expect(
      resolveAutoSelection({
        operation: "retry",
        candidateSafe: true,
        candidateRawScore: 9.9,
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
