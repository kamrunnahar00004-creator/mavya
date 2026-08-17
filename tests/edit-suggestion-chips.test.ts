import { describe, expect, it } from "vitest";
import {
  buildEditSuggestionChips,
  deriveEditContext,
  EDIT_CHIP_SAFE_LABELS,
  type EditableNextStep,
} from "../src/lib/selection-display";

/**
 * Codex review round 4: edit-photo-modal.tsx used to keep its own SEPARATE
 * fallback chip lists, and the supporting-photo one had drifted to include
 * "Make the text easier to read" (a real fidelity risk) and "Straighten the
 * photo" -- neither ever passed through buildEditSuggestionChips()'s safety
 * logic, since it was a hand-maintained list, not the detector's output.
 * EDIT_CHIP_SAFE_LABELS is now the one canonical source both the detector
 * and the modal's fallback read from. This test locks in the actual
 * guarantee that matters: whatever buildEditSuggestionChips returns is
 * ALWAYS a subset of this exact list, never something else.
 */
describe("EDIT_CHIP_SAFE_LABELS (Codex review round 4: one canonical safe set, not two independently maintained lists)", () => {
  it("is exactly the 5 categories, no more, no less", () => {
    expect(EDIT_CHIP_SAFE_LABELS).toEqual([
      "Brighten the product evenly",
      "Use a plain white background",
      "Remove background clutter",
      "Center the full product",
      "Sharpen product details",
    ]);
  });

  it("buildEditSuggestionChips can never return anything outside this list", () => {
    const cases: EditableNextStep[][] = [
      [{ observation: "", action: "Soften the lighting on the candle." }],
      [{ observation: "", action: "Use a plain white background." }],
      [{ observation: "", action: "Put the soap on a clean white surface." }],
      [{ observation: "", action: "Add a small box of matches beside the candle." }],
      [{ observation: "", action: "Make the label text sharper and easier to read." }],
    ];
    for (const steps of cases) {
      const result = buildEditSuggestionChips(steps, 6.5, [...EDIT_CHIP_SAFE_LABELS]);
      for (const chip of result) {
        expect(EDIT_CHIP_SAFE_LABELS).toContain(chip);
      }
    }
  });
});

/**
 * Codex review (2026-08-16), round 3: buildEditSuggestionChips used to
 * filter next_steps[].action text through a blacklist and pass the
 * SURVIVING TEXT THROUGH VERBATIM. That failed repeatedly to unlimited
 * synonyms for "reposition the physical object" (round 2 caught "place it
 * on...", round 3 caught "Put the soap on a clean white surface." -- an
 * unlisted verb that still passed the allow-check on "surface"). Redesigned
 * as a whitelist: detect which of 5 FIXED, hand-written categories applies,
 * return that category's fixed label, never the model's own free text.
 * Every possible output is now one of exactly 5 known-safe strings.
 */
describe("buildEditSuggestionChips", () => {
  const weakScore = 6.5;
  const LIGHTING = "Brighten the product evenly";
  const BACKGROUND = "Use a plain white background";
  const CLUTTER = "Remove background clutter";
  const FRAMING = "Center the full product";
  const SHARPNESS = "Sharpen product details";

  function step(action: string, observation = ""): EditableNextStep {
    return { observation, action };
  }

  it("detects the lighting category and returns the fixed label, never the model's own wording", () => {
    const steps = [step("Soften the lighting on the candle, it looks harsh.")];
    expect(buildEditSuggestionChips(steps, weakScore, ["fallback"])).toEqual([
      LIGHTING,
    ]);
  });

  it("detects background/clutter/framing/sharpness the same way", () => {
    expect(
      buildEditSuggestionChips([step("Use a plain white background instead.")], weakScore, [])
    ).toEqual([BACKGROUND]);
    expect(
      buildEditSuggestionChips([step("The busy, cluttered surroundings distract from the product.")], weakScore, [])
    ).toEqual([CLUTTER]);
    expect(
      buildEditSuggestionChips([step("Crop so the product fills more of the frame.")], weakScore, [])
    ).toEqual([FRAMING]);
    expect(
      buildEditSuggestionChips([step("The focus is soft and the details are blurry.")], weakScore, [])
    ).toEqual([SHARPNESS]);
  });

  it("regression (Codex review round 3): a synonym no blacklist round caught ('Put... on a surface') can no longer produce anything unsafe, because output is never free text at all", () => {
    // Under the old design this was the exact bypass Codex found: "put"
    // wasn't in the verb blacklist, and the sentence then passed on
    // "surface". Under the new design there IS no verbatim passthrough to
    // bypass -- the worst this sentence can do is correctly match the
    // BACKGROUND category (it genuinely is about the background/surface)
    // and return the fixed, pre-vetted label, never the seller's literal
    // physical-restaging phrasing.
    const steps = [step("Put the soap on a clean white surface.")];
    const result = buildEditSuggestionChips(steps, weakScore, ["fallback"]);
    expect(result).toEqual([BACKGROUND]);
    expect(result).not.toContain("Put the soap on a clean white surface.");
  });

  it("reshoot/prop/separate-photo/praise text that matches NO category falls back, and never leaks through as free text either way", () => {
    const steps = [
      step("Add one folded washcloth next to the soap, off to the side."),
      step("Add a separate in-hand photo showing scale."),
      step("Keep this as your main photo, it is strong."),
    ];
    const result = buildEditSuggestionChips(steps, weakScore, ["fallback"]);
    expect(result).toEqual(["fallback"]);
  });

  it("honest note: keyword detection can false-positive on unrelated senses of a word (e.g. 'light' the candle, not photo lighting) -- always safe regardless, since output is still just a fixed template", () => {
    const steps = [step("Add matches beside the candle, since you use them to light it.")];
    const result = buildEditSuggestionChips(steps, weakScore, ["fallback"]);
    // Matches LIGHTING on the verb "light", not the photography sense --
    // a real, known limitation of pure keyword detection. Documented here
    // rather than hidden: the outcome is still always one of the 5 safe
    // labels, never anything unsafe, which is the actual guarantee that
    // matters.
    expect(result).toEqual([LIGHTING]);
  });

  it("strong-band photos (score >= 8) always use the fallback, regardless of content", () => {
    const steps = [step("Use a plain white background.")]; // would otherwise match
    expect(buildEditSuggestionChips(steps, 8.4, ["fallback"])).toEqual([
      "fallback",
    ]);
    expect(buildEditSuggestionChips(steps, 8.0, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("never returns the same category label twice, even when multiple next_steps touch on it", () => {
    const steps = [
      step("Soften the harsh lighting."),
      step("The lighting also creates glare on the metal."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, [])).toEqual([LIGHTING]);
  });

  it("caps at 3 categories even when all 5 are touched on", () => {
    const steps = [
      step(
        "The lighting is harsh, the background is cluttered, the crop cuts off the frame, the focus is blurry, and the surface is messy."
      ),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, [])).toHaveLength(3);
  });

  it("empty next_steps -> fallback", () => {
    expect(buildEditSuggestionChips([], weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("no category matches -> fallback, not an empty array", () => {
    const steps = [step("Photograph the item again in better conditions.")];
    expect(buildEditSuggestionChips(steps, weakScore, ["a", "b"])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("deriveEditContext (Codex review: editImageSrc and editAudit must always agree on which photo is being edited)", () => {
  type FakeAudit = { nextSteps: EditableNextStep[]; overallScore: number; tag: string };
  const original: FakeAudit = { nextSteps: [], overallScore: 6.0, tag: "original" };
  const improved: FakeAudit = { nextSteps: [], overallScore: 8.0, tag: "improved" };

  it("original tab -> original image + original audit", () => {
    const result = deriveEditContext({
      activeTab: "original",
      hasImprovement: true,
      improvedSrc: "improved.jpg",
      uploadedSrc: "original.jpg",
      stateImageSrc: "state.jpg",
      stateAudit: original,
      improvedAudit: improved,
    });
    expect(result.editSource).toBe("original");
    expect(result.editImageSrc).toBe("original.jpg");
    expect(result.editAudit).toBe(original);
  });

  it("preview tab with a real improvement -> preview image + preview audit, paired correctly", () => {
    const result = deriveEditContext({
      activeTab: "preview",
      hasImprovement: true,
      improvedSrc: "improved.jpg",
      uploadedSrc: "original.jpg",
      stateImageSrc: "state.jpg",
      stateAudit: original,
      improvedAudit: improved,
    });
    expect(result.editSource).toBe("preview");
    expect(result.editImageSrc).toBe("improved.jpg");
    expect(result.editAudit).toBe(improved);
  });

  it("regression (Codex review round 2): improvedAudit missing while improvedSrc exists -> BOTH fall back to original together, never a split", () => {
    // The round-1 fix picked editImageSrc off improvedSrc and editAudit off
    // improvedAudit as two INDEPENDENT checks -- they could disagree if one
    // was present without the other. A prior version of this exact test
    // asserted editSource: "preview" paired with editAudit: original, which
    // Codex correctly called out as still being the mismatch this function
    // exists to prevent (editImageSrc would say "preview"/improved.jpg while
    // editAudit described the original -- exactly the bug). Fixed
    // structurally: a single boolean now decides image AND audit together.
    const result = deriveEditContext({
      activeTab: "preview",
      hasImprovement: true,
      improvedSrc: "improved.jpg",
      uploadedSrc: "original.jpg",
      stateImageSrc: "state.jpg",
      stateAudit: original,
      improvedAudit: undefined, // not ready yet
    });
    expect(result.editSource).toBe("original");
    expect(result.editImageSrc).toBe("original.jpg");
    expect(result.editAudit).toBe(original);
  });

  it("regression: improvedSrc missing while improvedAudit exists -> BOTH fall back to original together", () => {
    const result = deriveEditContext({
      activeTab: "preview",
      hasImprovement: true,
      improvedSrc: undefined,
      uploadedSrc: "original.jpg",
      stateImageSrc: "state.jpg",
      stateAudit: original,
      improvedAudit: improved, // ready, but no image to pair it with
    });
    expect(result.editSource).toBe("original");
    expect(result.editImageSrc).toBe("original.jpg");
    expect(result.editAudit).toBe(original);
  });

});
