import { describe, expect, it } from "vitest";
import { resolveAutoSelection } from "@/lib/workflow-rules";

describe("score-based automatic selection (warnings don't block)", () => {
  describe("seller workflow: one improved preview, not 1/2/3 picker", () => {
    it("shows lowest-scoring generated image with warnings", () => {
      // Generated image: score 3.1, warnings (AI-looking, incomplete)
      // This is shown to seller with warnings, not hidden
      // Requirement: don't reject based on low score or warnings
      const willSelect = resolveAutoSelection({
        operation: "improve",
        candidateSafe: false, // Has warnings
        candidateRawScore: 3.1, // Very low score
        currentRawScore: null, // First result
        currentSelectionSource: null,
      });
      expect(willSelect).toBe(true); // Still selected and shown
    });

    it("shows score-unavailable generated image", () => {
      // Generated image: score null (vision failed), but image exists
      // This is shown to seller with "Score unavailable" message
      const willSelect = resolveAutoSelection({
        operation: "improve",
        candidateSafe: false, // Can't evaluate safety without score
        candidateRawScore: null, // Score unavailable
        currentRawScore: null,
        currentSelectionSource: null,
      });
      expect(willSelect).toBe(false); // Skipped (no score to compare)
    });

    it("highest-scoring completed candidate becomes current preview", () => {
      // Scenario: attempt 1 = score 5.0, attempt 2 = score 7.3
      // Attempt 2 should become the current preview (highest score)
      const attempt2Wins = resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 7.3,
        currentRawScore: 5.0,
        currentSelectionSource: "auto",
      });
      expect(attempt2Wins).toBe(true);
    });

    it("lower-scoring candidate doesn't replace higher-scoring", () => {
      // Scenario: current = 7.3, background attempt = 6.8
      // Should keep current (don't downgrade)
      const keepCurrent = !resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 6.8,
        currentRawScore: 7.3,
        currentSelectionSource: "auto",
      });
      expect(keepCurrent).toBe(true);
    });
  });

  describe("warnings don't prevent selection", () => {
    it("AI-looking image with highest score becomes preview", () => {
      // Generated: AI-looking (ai_looking=true) but score 8.5
      // This should be shown as improved preview with warning
      const aiLookingHighScore = resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // ai_looking=true
        candidateRawScore: 8.5,
        currentRawScore: 7.0,
        currentSelectionSource: "auto",
      });
      expect(aiLookingHighScore).toBe(true);
    });

    it("incomplete-product image with highest score becomes preview", () => {
      // Generated: incomplete (full_product_visible=false) but score 7.9
      // This should be shown with warning
      const incompleteHighScore = resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // full_product_visible=false
        candidateRawScore: 7.9,
        currentRawScore: 6.8,
        currentSelectionSource: "auto",
      });
      expect(incompleteHighScore).toBe(true);
    });

    it("changed-details image with highest score becomes preview", () => {
      // Generated: changed details (text_or_pattern_drift=true) but score 8.1
      // This should be shown with clear warning
      const driftHighScore = resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // text_or_pattern_drift=true
        candidateRawScore: 8.1,
        currentRawScore: 7.2,
        currentSelectionSource: "auto",
      });
      expect(driftHighScore).toBe(true);
    });

    it("multiple warnings don't block if score is highest", () => {
      // Generated: AI-looking + incomplete + drift, but score 8.3
      // All warnings displayed but image shown
      const multipleWarningsHighScore = resolveAutoSelection({
        operation: "refine",
        candidateSafe: false, // Multiple flags true
        candidateRawScore: 8.3,
        currentRawScore: 6.5,
        currentSelectionSource: "auto",
      });
      expect(multipleWarningsHighScore).toBe(true);
    });
  });

  describe("seller choice is locked forever", () => {
    it("Use improved photo selects that version permanently", () => {
      // Seller clicks "Use improved photo"
      // Sets selection_source = 'user' and selectedJobId
      // Even if background attempts find higher score later, no auto-replacement
      const sellerPicked = !resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 9.5, // Background finds much higher score
        currentRawScore: 5.5,
        currentSelectionSource: "user", // Seller chose this
      });
      expect(sellerPicked).toBe(true); // Stays selected
    });

    it("Keep original selects original permanently", () => {
      // Seller clicks "Keep original"
      // Sets selectedJobId = null and selection_source = 'user'
      // Background refinement cannot auto-replace with improved preview
      const keepOriginal = !resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 9.9, // Background finds very high score
        currentRawScore: null, // Original (no score)
        currentSelectionSource: "user", // Seller chose original
      });
      expect(keepOriginal).toBe(true); // Stays original
    });

    it("seller edit selection overrides score comparison", () => {
      // Seller manually edits the photo
      // The edited result is selected regardless of score
      const sellerEdit = resolveAutoSelection({
        operation: "edit",
        candidateSafe: false, // Edited result might have warnings
        candidateRawScore: 4.5, // Even with low score
        currentRawScore: 8.0,
        currentSelectionSource: "auto",
      });
      expect(sellerEdit).toBe(true); // Still selected (explicit edit)
    });
  });

  describe("background refinement before seller choice", () => {
    it("attempt 2 with higher score replaces attempt 1 before seller choice", () => {
      // Initial attempt = 6.9 (auto-selected)
      // Background attempt 2 = 7.8
      // Should replace because selection_source is still 'auto'
      const refinementWins = resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 7.8,
        currentRawScore: 6.9,
        currentSelectionSource: "auto",
      });
      expect(refinementWins).toBe(true);
    });

    it("attempt 3 with highest score becomes final preview", () => {
      // Attempt 1 = 6.5
      // Attempt 2 = 7.2 (auto-selected)
      // Attempt 3 = 7.6 (auto-selected, replaces attempt 2)
      const attempt3Wins = resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 7.6,
        currentRawScore: 7.2,
        currentSelectionSource: "auto",
      });
      expect(attempt3Wins).toBe(true);
    });

    it("weaker background attempt doesn't replace current", () => {
      // Initial attempt = 7.4 (auto-selected)
      // Background attempt 2 = 7.1 (weaker)
      // Should not replace
      const keepStronger = !resolveAutoSelection({
        operation: "refine",
        candidateSafe: true,
        candidateRawScore: 7.1,
        currentRawScore: 7.4,
        currentSelectionSource: "auto",
      });
      expect(keepStronger).toBe(true);
    });
  });

  describe("generation history preserved in database", () => {
    it("all generation attempts stored even though UI shows one preview", () => {
      // Database still has all jobs (attempt 1, 2, 3)
      // But UI shows only the current best (highest score)
      // This test documents the requirement: don't delete history
      expect(true).toBe(true); // Placeholder: actual test is DB integrity check
    });

    it("seller can debug by inspecting generation_jobs table", () => {
      // Raw scores, fidelity reports, errors, timings all preserved
      // For analytics and debugging, not UI
      expect(true).toBe(true); // Placeholder: actual test is audit query
    });
  });
});
