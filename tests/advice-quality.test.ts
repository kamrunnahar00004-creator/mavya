import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findAmbiguousProp,
  findDecorativeProp,
  findJargon,
  hasConcreteSpecific,
} from "../eval/advice-quality";

describe("hasConcreteSpecific (Codex review: word-boundary + action-portion + unit-aware numbers)", () => {
  it("fails bare vague instructions with no real specific (Codex's exact must-fail list)", () => {
    expect(hasConcreteSpecific("Increase contrast.")).toBe(false);
    expect(hasConcreteSpecific("Use a cleaner background.")).toBe(false);
    expect(hasConcreteSpecific("Crop the image.")).toBe(false);
    expect(hasConcreteSpecific("Make it more suitable for buyers.")).toBe(false);
    expect(hasConcreteSpecific("Improve the lighting.")).toBe(false);
  });

  it("fails a problem sentence followed by a vague action sentence", () => {
    expect(hasConcreteSpecific("The background looks weak. Make it better.")).toBe(false);
  });

  it("fails a vague action even when an earlier, unrelated sentence has a number", () => {
    // The "3" belongs to the problem sentence, not the action -- it must not
    // launder the vague action sentence that follows it.
    expect(
      hasConcreteSpecific("The photo currently scores a 3. The presentation could be more appealing.")
    ).toBe(false);
  });

  it("passes concrete instructions naming a number+unit or a real tool/surface/color (Codex's exact must-pass list)", () => {
    expect(hasConcreteSpecific("Place the candle on a plain white poster board.")).toBe(true);
    expect(hasConcreteSpecific("Move the camera back 12 inches.")).toBe(true);
    expect(hasConcreteSpecific("Use one desk lamp above and slightly left of the product.")).toBe(true);
    expect(hasConcreteSpecific("Crop to a square with 10% empty space around the product.")).toBe(true);
  });

  it("passes real generated examples from earlier review rounds", () => {
    expect(
      hasConcreteSpecific("Move the camera about a foot closer so the product fills 70% of the frame.")
    ).toBe(true);
    expect(hasConcreteSpecific("Photograph on a plain white poster board instead.")).toBe(true);
    expect(hasConcreteSpecific("Position a desk lamp about a foot away.")).toBe(true);
    expect(hasConcreteSpecific("Switch to a plain light gray background.")).toBe(true);
  });

  it("fails real problem-only text with zero specifics (unchanged from before)", () => {
    expect(
      hasConcreteSpecific("The overall presentation could be more appealing to buyers.")
    ).toBe(false);
    expect(
      hasConcreteSpecific("The lighting is generally even but could be improved to enhance the detail.")
    ).toBe(false);
  });

  it("boundary: 'suitable' does not trigger the removed 'table' word", () => {
    // Regression guard for the exact bug Codex found: "table" is no longer a
    // concrete-keyword at all, but this proves the substring collision is gone
    // even if a surface keyword is ever reintroduced.
    expect(hasConcreteSpecific("Make it more suitable for buyers.")).toBe(false);
  });

  it("boundary: a bare unrelated digit does not count without a unit", () => {
    expect(hasConcreteSpecific("This is the 3rd photo but it still looks off.")).toBe(false);
  });
});

describe("findJargon (Codex: the reading-level rule must not contradict its own examples)", () => {
  it("flags the exact jargon words Codex found still present", () => {
    expect(findJargon("hides the surface texture")).toContain("surface texture");
    expect(findJargon("increase the preview image resolution")).toContain("resolution");
    expect(findJargon("place it in a high-contrast box")).toContain("high-contrast");
    expect(findJargon("diffused through a white sheet of paper")).toContain("diffused");
  });

  it("passes plain-language rewrites", () => {
    expect(findJargon("hides the small details on the item")).toEqual([]);
    expect(findJargon("upload a bigger, sharper image file")).toEqual([]);
    expect(findJargon("a box with a dark background and light text")).toEqual([]);
    expect(findJargon("pointed through a white sheet of paper so the light is soft")).toEqual([]);
  });
});

describe("findDecorativeProp (Codex review: word-boundary matching, spoon is not universally decorative)", () => {
  it("flags unambiguous decorative props", () => {
    expect(findDecorativeProp("Add a few flowers and a ribbon nearby.")).toEqual(
      expect.arrayContaining(["flowers", "ribbon"])
    );
  });

  it("passes genuinely functional props (used WITH the product)", () => {
    expect(
      findDecorativeProp("Add one folded washcloth next to the bars, off to the side.")
    ).toEqual([]);
    expect(
      findDecorativeProp("Add a small box of matches near the candle, since you use them to light it.")
    ).toEqual([]);
  });

  it("no longer treats spoon as always-decorative (Codex: a spoon can be functionally normal for tea/coffee/sugar/soup)", () => {
    expect(
      findDecorativeProp("Add one small decorative element, like a spoon, beside the teacup.")
    ).toEqual([]);
    expect(findDecorativeProp("Set a small spoon beside the sugar bowl.")).toEqual([]);
  });

  it("boundary: 'bowl' does not trigger the banned word 'bow'", () => {
    expect(findDecorativeProp("Set a small sugar bowl next to the teacup.")).toEqual([]);
  });
});

describe("findAmbiguousProp (category-dependent props, informational only, never a failure)", () => {
  it("flags spoon as ambiguous rather than silently dropping it", () => {
    expect(findAmbiguousProp("Add a small spoon beside the teacup.")).toContain("spoon");
    expect(findAmbiguousProp("Set a small spoon beside the sugar bowl.")).toContain("spoon");
  });

  it("stays empty for props with no ambiguity either way", () => {
    expect(findAmbiguousProp("Add a folded washcloth next to the bars.")).toEqual([]);
    expect(findAmbiguousProp("Add a few flowers nearby.")).toEqual([]);
  });
});

describe("the prompt source files themselves are clean (Codex round: spoon + jargon)", () => {
  const rubric = readFileSync(path.resolve("src/lib/rubric.ts"), "utf8");
  const general = readFileSync(path.resolve("src/lib/general-rubric.ts"), "utf8");

  it("neither prompt suggests a spoon (the exact self-contradicting example Codex caught)", () => {
    expect(rubric.toLowerCase()).not.toContain("spoon");
    expect(general.toLowerCase()).not.toContain("spoon");
  });

  it("neither prompt's own worked examples still contain the banned jargon", () => {
    // Scoped to the WORKED EXAMPLES block only -- the READING LEVEL rule text
    // itself legitimately NAMES "diffuse"/"aperture" etc. to ban them, so
    // checking the whole file would false-positive on the rule's own wording.
    for (const src of [rubric, general]) {
      const start = src.indexOf("WORKED EXAMPLES");
      const end = src.indexOf("CRITICAL: this two-part structure");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(findJargon(src.slice(start, end))).toEqual([]);
    }
  });

  it("the PROP RULE requires the prop be USED WITH the product, not just placed near it", () => {
    expect(rubric).toContain("a suggested prop must be exactly ONE small item you actually USE with the product");
    expect(general).toContain("a suggested prop must be exactly ONE small item you actually USE with the product");
  });
});
