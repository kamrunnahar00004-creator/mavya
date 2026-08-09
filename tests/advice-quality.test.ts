import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findDecorativeProp,
  findJargon,
  hasConcreteSpecific,
} from "../eval/advice-quality";

describe("hasConcreteSpecific (Codex: verify the concreteness rule, not just assert it)", () => {
  it("flags a real generated failure case: problem-only text with zero specifics", () => {
    expect(
      hasConcreteSpecific("The overall presentation could be more appealing to buyers.")
    ).toBe(false);
    expect(
      hasConcreteSpecific("The lighting is generally even but could be improved to enhance the detail.")
    ).toBe(false);
  });

  it("passes text naming a number, tool, surface, or color", () => {
    expect(
      hasConcreteSpecific("Move the camera about a foot closer so the product fills 70% of the frame.")
    ).toBe(true);
    expect(hasConcreteSpecific("Photograph on a plain white poster board instead.")).toBe(true);
    expect(hasConcreteSpecific("Position a desk lamp about a foot away.")).toBe(true);
    expect(hasConcreteSpecific("Switch to a plain light gray background.")).toBe(true);
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

describe("findDecorativeProp (Codex: the spoon example contradicted its own functional-prop rule)", () => {
  it("flags the exact bad example Codex caught", () => {
    expect(
      findDecorativeProp("Add one small decorative element, like a spoon, beside the teacup.")
    ).toContain("spoon");
  });

  it("flags other purely-decorative props", () => {
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
