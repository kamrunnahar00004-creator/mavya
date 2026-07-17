import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_IDS,
  DETECTED_CATEGORY_VALUES,
  categoryById,
  classifierPromptBlock,
  generationGuidanceFor,
  scoringNotesBlock,
  GENERIC_GENERATION_GUIDANCE,
} from "@/lib/taxonomy";
import { poolFor, PHYSICAL_POOLS, DIGITAL_POOLS } from "@/data/photo-checklist-pool";
import { INVALID_RESPONSE, isRubricJson } from "@/lib/rubric";
import { RUBRIC_VERSION, SUPPORTING_RUBRIC_VERSION, TAXONOMY_VERSION } from "@/lib/versions";

describe("canonical taxonomy", () => {
  it("ids are unique and every category has label, kind, classify, scoring", () => {
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
    for (const c of CATEGORIES) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(["physical", "digital"]).toContain(c.kind);
      expect(c.classify.length, c.id).toBeGreaterThan(5);
      expect(c.scoring.length, `${c.id} needs scoring guidance`).toBeGreaterThan(20);
    }
  });

  it("major legacy Etsy segments are first-class (no longer collapse to other)", () => {
    for (const id of [
      "apparel",
      "wall_art",
      "home_decor",
      "vintage",
      "bags",
      "personalized",
      "jewelry",
      "candles",
      "crochet_plush",
      "soap",
      "mugs",
    ]) {
      expect(CATEGORY_IDS, id).toContain(id);
    }
  });

  it("legacy 6-enum values remain valid (backward compatibility)", () => {
    for (const legacy of ["jewelry", "candles", "crochet_plush", "soap", "mugs", "other"]) {
      expect(DETECTED_CATEGORY_VALUES).toContain(legacy);
    }
    // Legacy persisted audits (pre-taxonomy) must still validate.
    expect(isRubricJson({ ...INVALID_RESPONSE, detected_category: "candles" })).toBe(true);
  });

  it("every category routes to a real checklist pool (id === pool key)", () => {
    for (const c of CATEGORIES) {
      const pools = c.kind === "physical" ? PHYSICAL_POOLS : DIGITAL_POOLS;
      expect(pools[c.id], `${c.id} has no checklist pool`).toBeDefined();
      const kind = c.kind === "physical" ? "physical_product" : "digital_product";
      expect(poolFor(kind, c.id).length).toBeGreaterThan(0);
    }
  });

  it("every category has generation guidance OR the explicit generic declaration", () => {
    for (const c of CATEGORIES) {
      const guidance = generationGuidanceFor(c.id);
      expect(guidance.length, c.id).toBeGreaterThan(40);
      if (c.generation === null) {
        expect(guidance).toBe(GENERIC_GENERATION_GUIDANCE);
      } else {
        expect(guidance).toBe(c.generation);
      }
    }
    // Unknown/legacy values fall back to generic guidance, never throw.
    expect(generationGuidanceFor("other")).toBe(GENERIC_GENERATION_GUIDANCE);
    expect(generationGuidanceFor("not-a-category")).toBe(GENERIC_GENERATION_GUIDANCE);
  });

  it("prompt blocks render every category exactly once", () => {
    const classifier = classifierPromptBlock();
    const notes = scoringNotesBlock("physical") + scoringNotesBlock("digital");
    for (const c of CATEGORIES) {
      expect(classifier).toContain(`"${c.id}"`);
      expect(notes).toContain(`- ${c.id}:`);
    }
  });

  it("category lookups behave", () => {
    expect(categoryById("candles")?.kind).toBe("physical");
    expect(categoryById("digital_planner")?.kind).toBe("digital");
    expect(categoryById("nope")).toBeUndefined();
  });

  it("rubric versions were bumped with the taxonomy", () => {
    expect(TAXONOMY_VERSION).toBe(1);
    // v9 = framing judged by buyer understanding, not literal 100% inclusion
    // (general rule replaces the necklace-only exception). (v8 = margin vs
    // truncation wording; v7 = evidence-based trust findings.)
    expect(RUBRIC_VERSION).toBe("main-v9");
    expect(SUPPORTING_RUBRIC_VERSION).toBe("supporting-v5");
  });
});

describe("priority fields validation", () => {
  it("rejects invalid priority_pillar / priority_issue_family", () => {
    expect(isRubricJson({ ...INVALID_RESPONSE, priority_pillar: "vibes" })).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, priority_issue_family: "vibes" })).toBe(false);
    expect(
      isRubricJson({
        ...INVALID_RESPONSE,
        priority_pillar: "lighting",
        priority_issue_family: "lighting",
      })
    ).toBe(true);
  });
});
