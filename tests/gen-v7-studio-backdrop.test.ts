import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generationStylePromptBlock } from "@/lib/generation-prompt-strategy";
import { GENERATION_PROMPT_VERSION } from "@/lib/versions";

const improve = readFileSync(path.resolve("src/lib/improve-photo.ts"), "utf8");

const studio = generationStylePromptBlock({
  style: "studio",
  detectedCategory: "crochet_plush",
  role: "main",
});

/**
 * gen-v7. Studio previously hardcoded "a plain white or light-gray
 * background/surface". White is not what makes a shot a studio shot -- a
 * studio backdrop is seamless paper, which comes in every color -- and the
 * static default actively hurt two cases: an Etsy grid rendered on a white
 * page (the thumbnail has no edge) and a white or reflective product (the
 * silhouette disappears).
 */
describe("gen-v7: Studio picks a backdrop tone instead of defaulting to white", () => {
  it("is pinned to a bumped version -- prompt text is part of the cache key", () => {
    // THE single literal pin for GENERATION_PROMPT_VERSION. score_cache and
    // generation reuse are keyed on the exact prompt string, so changed text
    // read under an unchanged version is a correctness bug, not just untidy.
    // When the next prompt change lands, MOVE this assertion into that
    // change's test file and delete it here -- do not add a second one.
    expect(GENERATION_PROMPT_VERSION).toBe("gen-v7");
  });

  it("no longer hardcodes a white or light-gray backdrop", () => {
    expect(studio).not.toContain("plain white or light-gray background/surface");
    expect(studio).toContain("one plain seamless backdrop and surface");
  });

  it("tells the model to choose the tone for THIS product", () => {
    expect(studio).toContain("NEVER DEFAULT TO WHITE");
    expect(studio).toContain(
      "Choose ONE flat, low-saturation backdrop tone that makes THIS product read clearly",
    );
    expect(studio).toContain("gentle complementary or contrasting relationship");
  });

  it("protects the case that motivated the change: a pale or reflective product", () => {
    // A white mug on a white sweep has no outline at all. The founder's own
    // observation, and the reason a static default was wrong rather than
    // merely bland.
    expect(studio).toContain("MUST NOT BE PLACED ON WHITE OR NEAR-WHITE");
    expect(studio).toContain("Its outline disappears entirely");
    expect(studio).toContain("clearly deeper mid-tone");
  });

  it("never allows pure white, because the page behind it is already white", () => {
    expect(studio).toContain("Never use pure paper white");
    expect(studio).toContain("no visible edge at all");
  });

  it("caps saturation so the backdrop cannot tint the product", () => {
    // The entire fidelity argument for allowing color at all: a pale tint
    // bounces almost no colored light onto the product. A strong one shifts
    // its apparent color, and a wrong color is a return and a bad review.
    expect(studio).toContain("Keep saturation LOW");
    expect(studio).toContain("never a strong, vivid, or bold color");
    expect(studio).toContain(
      "its real color, finish, and material must be completely unchanged",
    );
  });

  it("stays a studio shot: one flat tone, no gel, gradient, or pattern", () => {
    expect(studio).toContain("One flat, evenly lit tone");
    expect(studio).toContain("no visible seam, sweep line, or horizon");
    expect(studio).toContain("no decorative props");
  });

  it("re-scopes the audit's own white-background advice instead of obeying it", () => {
    // THE LOAD-BEARING ASSERTION, and the gen-v4 lesson applied a second time.
    // buildTargetedPrompt composes fixesBlock AFTER styleBlock, and the audit
    // really does emit "using a plain white or light gray background" (see
    // tests/advice-quality.test.ts). Without this override the later and more
    // specific instruction wins and the backdrop stays white regardless of
    // everything above it.
    expect(studio).toContain("execute it as THIS style");
    expect(studio).toContain("chosen backdrop tone");
    expect(studio).toContain("it is not prescribing the literal color white");
    expect(studio).toContain("including the audit's own phrasing");
  });

  it("the style block is still composed BEFORE the fixes block", () => {
    // The override wording assumes the audit fixes arrive afterwards. If that
    // order ever flips, the wording needs revisiting rather than silently
    // meaning something else.
    const styleIdx = improve.indexOf("styleBlock,");
    const fixesIdx = improve.indexOf("fixesBlock,");
    expect(styleIdx).toBeGreaterThan(-1);
    expect(fixesIdx).toBeGreaterThan(styleIdx);
  });

  it("leaves the product-fidelity floor and role lock untouched", () => {
    expect(studio).toContain("ABSOLUTE PRODUCT-FIDELITY FLOOR");
    expect(studio).toContain("MAIN-PHOTO ROLE LOCK");
  });
});
