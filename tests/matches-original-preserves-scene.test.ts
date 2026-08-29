import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generationStylePromptBlock } from "@/lib/generation-prompt-strategy";

const improve = readFileSync(path.resolve("src/lib/improve-photo.ts"), "utf8");

const matchesOriginal = generationStylePromptBlock({
  style: "matches_original",
  detectedCategory: "crochet_plush",
  role: "main",
});
const studio = generationStylePromptBlock({
  style: "studio",
  detectedCategory: "crochet_plush",
  role: "main",
});

describe("Matches Original keeps the seller's own scene", () => {
  it("carries an override with the same force Studio and Lifestyle already had", () => {
    // ROOT CAUSE of the founder report ("Matches Original sometimes completely
    // removes the background, making Studio"): Studio and Lifestyle each said
    // their instruction "replaces earlier default scene-preservation
    // guidance", but Matches Original said nothing of the kind -- so it was
    // the one style with no authority against the fixes block that follows it.
    expect(matchesOriginal).toContain("OVERRIDES");
    expect(studio).toContain("replaces earlier default");
  });

  it("re-scopes a plain-background fix instead of obeying it literally", () => {
    // The audit's own priority_action routinely reads "use a plain white or
    // light gray background". That text is injected AFTER this block and is
    // introduced as the FIRST problem to resolve, so it has to be named here
    // explicitly or it wins.
    expect(matchesOriginal).toContain("use a plain/white/neutral background");
    expect(matchesOriginal).toContain(
      "MUST be executed as an IMPROVEMENT OF THE EXISTING BACKGROUND, never as a substitution"
    );
    expect(matchesOriginal).toContain("including the audit's own phrasing");
  });

  it("keeps the seller's actual backdrop, by example", () => {
    expect(matchesOriginal).toContain(
      "If the photo has a blue backdrop, the result still has that blue backdrop"
    );
  });

  it("preserves hands and people rather than cutting the product out", () => {
    expect(matchesOriginal).toContain("hands");
    expect(matchesOriginal).toContain(
      "remove a hand or person that is holding or wearing the product"
    );
    expect(matchesOriginal).toContain("cut the product out onto a new surface");
  });

  it("allows genuine improvement, and at most one restrained prop", () => {
    expect(matchesOriginal).toContain("exposure, white balance, contrast");
    expect(matchesOriginal).toContain("ONE small, restrained, plausible supporting prop");
    expect(matchesOriginal).toContain("add more than one prop");
  });

  it("still forbids becoming a studio or lifestyle shot", () => {
    expect(matchesOriginal).toContain("introduce a seamless studio sweep");
    expect(matchesOriginal).toContain("relight the scene as if photographed somewhere else");
  });

  it("keeps the shared fidelity floor and role lock", () => {
    expect(matchesOriginal).toContain("ABSOLUTE PRODUCT-FIDELITY FLOOR");
    expect(matchesOriginal).toContain("MAIN-PHOTO ROLE LOCK");
  });

  it("the style block is still composed BEFORE the fixes block", () => {
    // The override wording above is written on the assumption that the audit
    // fixes arrive afterwards. If that order ever flips, the wording needs
    // revisiting rather than silently meaning something else.
    const styleIdx = improve.indexOf("styleBlock,");
    const fixesIdx = improve.indexOf("fixesBlock,");
    expect(styleIdx).toBeGreaterThan(-1);
    expect(fixesIdx).toBeGreaterThan(styleIdx);
  });
});
