import { describe, expect, it } from "vitest";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";

describe("supporting-photo listing relevance prompt", () => {
  it("protects pattern and accessory variants of the same base product", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "the same towel design in a floral versus striped pattern"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "the same duck plush with a different hat or no hat"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      'Classify it as "variation" and score it normally.'
    );
  });

  it("still rejects a clearly different product from the same category", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "the same broad category but an unmistakably different base product"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "a black jar candle in a listing for a pink floral teacup candle"
    );
  });

  it("does not confuse staging props or included bundle items with variants", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "An ordinary staging prop does not turn a photo into a variation"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "visibly included in a bundle"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain('such as "whats_included" or "bundle_layout"');
  });

  it("reserves the near-zero verdict for clear contradictions", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      'Use "unrelated_or_wrong_product" ONLY when the visual evidence leaves no reasonable possibility'
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      'do NOT use the near-zero "unrelated_or_wrong_product" verdict'
    );
  });

  it("gives the listing the benefit of the doubt at any plausible uncertainty", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "If there is even a 1% plausible chance"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "GIVE IT THE BENEFIT OF THE DOUBT"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "Any uncertainty favors the seller"
    );
  });
});
