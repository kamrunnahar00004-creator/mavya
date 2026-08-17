import { describe, expect, it } from "vitest";
import {
  buildEditSuggestionChips,
  deriveEditContext,
  type EditableNextStep,
} from "../src/lib/selection-display";

/**
 * Codex review (2026-08-16): rubric.next_steps[].action is written as "the
 * exact, physically executable step" for a SELLER reshoot -- it regularly
 * includes reshoot advice, prop suggestions, separate-photo suggestions, and
 * strong-band praise, none of which is a valid instruction for the AI
 * editor to apply to existing pixels. These tests use the exact wording
 * patterns the rubric's own worked examples produce (verified against
 * rubric.ts/general-rubric.ts earlier this session), not invented text.
 */
describe("buildEditSuggestionChips", () => {
  const weakScore = 6.5;

  function step(action: string, observation = ""): EditableNextStep {
    return { observation, action };
  }

  it("keeps genuinely edit-safe actions (lighting, background, framing, sharpness)", () => {
    const steps = [
      step("Soften the lighting on the candle."),
      step("Use a plain white or gray background."),
      step("Crop to fill the frame."),
    ];
    const result = buildEditSuggestionChips(steps, weakScore, ["fallback"]);
    expect(result).toEqual([
      "Soften the lighting on the candle.",
      "Use a plain white or gray background.",
      "Crop to fill the frame.",
    ]);
  });

  it("rejects reshoot/capture instructions (rubric's own worked-example wording)", () => {
    const steps = [
      step("Rest it on a dark cloth, tap the phone screen on the prongs to lock focus."),
      step("Angle a soft lamp for detail."),
      step("Photograph on a plain white poster board instead."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("regression (Codex review round 2): rejects general physical-placement phrasing, not just the literal 'place it' string", () => {
    // "Place the candle on a plain white surface." previously slipped
    // through: the old reject pattern only matched "place it (on|against|
    // next to)", and this sentence then PASSED the allow-check on
    // "surface" -- exactly the physical restaging the filter exists to
    // block, confirmed real by Codex.
    const steps = [
      step("Place the candle on a plain white surface."),
      step("Position the mug against a light gray backdrop."),
      step("Set the item on a wood table."),
      step("Lay the necklace on a clean cloth."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("regression (Codex review round 2): allow-keyword check no longer matches a keyword as a substring of an unrelated word", () => {
    // "slightly" contains "light" as a raw substring -- the old .includes()
    // check would have wrongly treated this as a lighting-related action.
    const steps = [step("The product looks slightly off center in the frame.")];
    // Passes now for a real reason (contains "center"/"frame" as actual
    // words), not because "slightly" accidentally matched "light".
    const result = buildEditSuggestionChips(steps, weakScore, ["fallback"]);
    expect(result).toEqual(["The product looks slightly off center in the frame."]);

    // Isolate the substring risk directly: a sentence whose ONLY brush with
    // "light" is inside "slightly" must NOT pass on that basis alone.
    const isolated = [step("The item sits slightly to one side of the packaging.")];
    expect(buildEditSuggestionChips(isolated, weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("rejects physical prop suggestions (the exact PROP RULE boundary)", () => {
    const steps = [
      step("Add one folded washcloth next to the bars, off to the side."),
      step("Add a small box of matches beside the candle."),
      step("Add one bookmark beside the journal."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("rejects separate/additional-photo suggestions", () => {
    const steps = [
      step("Add a separate in-hand photo showing scale."),
      step("Add an additional photo of the packaging."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("rejects strong-band praise language even if it slips into a weak-band array", () => {
    const steps = [step("Keep this as your main photo, it is strong.")];
    expect(buildEditSuggestionChips(steps, weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("strong-band photos (score >= 8) always use the fallback, regardless of content", () => {
    const steps = [step("Use a plain white background.")]; // would otherwise pass
    expect(buildEditSuggestionChips(steps, 8.4, ["fallback"])).toEqual([
      "fallback",
    ]);
    expect(buildEditSuggestionChips(steps, 8.0, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("deduplicates case-insensitively", () => {
    const steps = [
      step("Use a plain white background."),
      step("use a plain white background."),
      step("Soften the lighting."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, [])).toEqual([
      "Use a plain white background.",
      "Soften the lighting.",
    ]);
  });

  it("rejects overlong actions instead of truncating them", () => {
    const long = "Use a plain white background " + "with extra padding words ".repeat(5);
    expect(long.length).toBeGreaterThan(70);
    const steps = [step(long), step("Soften the lighting.")];
    const result = buildEditSuggestionChips(steps, weakScore, []);
    expect(result).toEqual(["Soften the lighting."]);
    expect(result).not.toContain(long);
    expect(result.some((r) => long.startsWith(r) && r !== long)).toBe(false);
  });

  it("caps at 3 chips even when more are safe", () => {
    const steps = [
      step("Soften the lighting."),
      step("Use a plain white background."),
      step("Remove the background clutter."),
      step("Straighten the frame."),
      step("Sharpen the focus."),
    ];
    expect(buildEditSuggestionChips(steps, weakScore, [])).toHaveLength(3);
  });

  it("empty next_steps -> fallback", () => {
    expect(buildEditSuggestionChips([], weakScore, ["fallback"])).toEqual([
      "fallback",
    ]);
  });

  it("all-rejected next_steps -> fallback, not an empty array", () => {
    const steps = [step("Photograph on a plain white poster board.")];
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
