import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATION_PROMPT_VERSION } from "@/lib/versions";

const improve = readFileSync(path.resolve("src/lib/improve-photo.ts"), "utf8");

/**
 * gen-v5. Three self-contradictions in the generation prompts, all the same
 * shape as the two fixed in gen-v4/supporting-v20: two rules teaching
 * opposite lessons about the same feature, where the model obeys whichever
 * is louder or later rather than the one that is correct.
 */
describe("gen-v5: the generation prompts no longer argue with themselves", () => {
  it("is pinned to a bumped version -- prompt text is part of the cache key", () => {
    expect(GENERATION_PROMPT_VERSION).toBe("gen-v5");
  });

  describe("condition is not dirt", () => {
    it("no longer orders stains and dirty-looking marks removed wholesale", () => {
      // The old cleanliness line listed "stains, dirty-looking marks" beside
      // hair and lint, while the vintage guidance requires wear and patina
      // preserved. On a second-hand listing the mark IS the disclosure.
      expect(improve).not.toContain(
        "remove visible hair, lint, dust, grime, debris, stains, dirty-looking marks"
      );
    });

    it("scopes removal to loose scene debris and protects the product surface", () => {
      expect(improve).toContain("remove LOOSE SCENE DEBRIS ONLY");
      expect(improve).toContain(
        "NEVER remove a mark on the product itself unless the audit establishes it is temporary lint or dust"
      );
      expect(improve).toContain("is CONDITION: it must survive the edit exactly as shown");
    });
  });

  describe("hands are not clutter", () => {
    it("no longer lists hands as removable background objects", () => {
      // This contradicted gen-v4's own Matches Original override, which
      // forbids removing a hand holding the product. v4 fixed the style
      // block and left the BASE prompt arguing with it.
      expect(improve).not.toContain("messy bedding, floors, shelves, or hands");
    });

    it("states outright that a holding or wearing hand is the subject", () => {
      expect(improve).toContain("HANDS AND PEOPLE ARE NOT CLUTTER");
      expect(improve).toContain(
        "never remove a hand, arm, or person that is HOLDING, WEARING, MODELING, or DEMONSTRATING the product"
      );
      // The narrow, still-legitimate case survives.
      expect(improve).toContain(
        "may be removed only when it is idle in the background and is touching nothing that is sold"
      );
    });

    it("agrees with the Matches Original style block rather than contradicting it", () => {
      expect(improve).toContain("HANDS AND PEOPLE ARE NOT CLUTTER");
      const strategy = readFileSync(
        path.resolve("src/lib/generation-prompt-strategy.ts"),
        "utf8"
      );
      expect(strategy).toContain(
        "remove a hand or person that is holding or wearing the product"
      );
    });
  });

  describe("text legibility is an exposure fix, not a redraw", () => {
    it("no longer offers open-ended readability improvement", () => {
      // The supporting prompt promised "readability of text" two paragraphs
      // after declaring unclear text must stay "visually unchanged rather
      // than guessing" -- a direct conflict on the single highest-stakes
      // content in an informational photo.
      expect(improve).not.toContain("sharpness and focus, readability of text");
    });

    it("permits only whole-image adjustments and forbids glyph reconstruction", () => {
      expect(improve).toContain("TEXT LEGIBILITY IS AN EXPOSURE FIX, NEVER A REDRAW");
      expect(improve).toContain(
        "exposure, white balance, contrast, straightening, and crop -- applied uniformly"
      );
      expect(improve).toContain(
        "You may NOT redraw, re-render, re-typeset, reconstruct, complete, or sharpen text character by character"
      );
    });

    it("keeps the original sacred-text rule intact rather than replacing it", () => {
      expect(improve).toContain("TEXT AND NUMBERS ARE SACRED (STRICT)");
      expect(improve).toContain(
        "If any text is blurry or unclear, keep it visually unchanged rather than guessing"
      );
      expect(improve).toContain(
        "MUST remain exactly that blurry, cut off, or unreadable in the result"
      );
    });
  });
});
