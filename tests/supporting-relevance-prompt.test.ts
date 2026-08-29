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
      "the same broad category but an unmistakably different BASE FORM"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "a jar candle in a listing for a teacup candle"
    );
  });

  it("the reject example turns on base form, never on colour", () => {
    // The v18/v19 example was "a BLACK jar candle in a listing for a PINK
    // FLORAL teacup candle". Both differences in that sentence are colour
    // words, so it taught the model exactly the inference the variant rule
    // forbids -- and a koi plush in another colour was duly scored
    // "Different product" under v19. The example must isolate the base-form
    // difference (vessel), with no colour in it at all.
    const example = "a jar candle in a listing for a teacup candle";
    expect(GENERAL_RUBRIC_PROMPT).toContain(example);
    for (const colour of ["black jar candle", "pink floral teacup"]) {
      expect(GENERAL_RUBRIC_PROMPT).not.toContain(colour);
    }
  });

  it("states outright that colour alone can never justify wrong-product", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "COLOR, PATTERN, PRINT, FINISH, OR SIZE DIFFERENCE IS NEVER, ON ITS OWN, EVIDENCE OF A WRONG PRODUCT"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "even when the description explicitly names a different color"
    );
    // The founder-reported case, named so a future edit cannot regress it.
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "a crochet koi plush is a crochet koi plush whether it is orange, black, or white"
    );
  });

  it("requires the model to name a base-form difference before rejecting", () => {
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      "first state to yourself which BASE-FORM difference justifies it"
    );
    expect(GENERAL_RUBRIC_PROMPT).toContain(
      'you are wrong: return "variation" and score the photo normally'
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
