import { describe, expect, it } from "vitest";
import {
  availableGenerationStyles,
  GENERATION_STYLES,
  recommendedMainStyle,
  type GenerationStyle,
} from "@/lib/generation-style";
import { CATEGORY_IDS, categoryById } from "@/lib/taxonomy";

describe("generation-style: stable ids", () => {
  it("the three style ids match the Codex-approved architecture exactly", () => {
    expect(GENERATION_STYLES).toEqual(["matches_original", "studio", "lifestyle"]);
  });
});

describe("generation-style: matches_original is always available (no-regression baseline)", () => {
  it("every category, main and supporting, includes matches_original", () => {
    for (const category of CATEGORY_IDS) {
      expect(availableGenerationStyles({ category, role: "main" })).toContain(
        "matches_original"
      );
      expect(
        availableGenerationStyles({ category, role: "supporting" })
      ).toContain("matches_original");
    }
  });
});

describe("generation-style: category + role availability matrix", () => {
  it("jewelry main offers all three styles (model-worn is explicitly allowed by taxonomy.ts)", () => {
    expect(
      availableGenerationStyles({ category: "jewelry", role: "main" }).sort()
    ).toEqual(["lifestyle", "matches_original", "studio"].sort());
  });

  it("candles never offer lifestyle unless explicitly requested via this exact picker, and that carve-out is honored", () => {
    const styles = availableGenerationStyles({ category: "candles", role: "main" });
    expect(styles).toContain("studio");
    expect(styles).toContain("lifestyle");
  });

  it("categories whose taxonomy explicitly forbids lifestyle props never offer lifestyle", () => {
    for (const excluded of ["soap", "crochet_plush"] as const) {
      const styles = availableGenerationStyles({ category: excluded, role: "main" });
      expect(styles).not.toContain("lifestyle");
      expect(styles).toContain("studio"); // studio (clean presentation) still fine
    }
  });

  it("vintage never offers studio -- condition/patina honesty is the whole category", () => {
    const styles = availableGenerationStyles({ category: "vintage", role: "main" });
    expect(styles).not.toContain("studio");
    expect(styles).not.toContain("lifestyle");
    expect(styles).toEqual(["matches_original"]);
  });

  it("digital categories never offer studio or lifestyle -- styling a screenshot/mockup does not apply", () => {
    const digitalCategories = CATEGORY_IDS.filter(
      (id) => categoryById(id)?.kind === "digital"
    );
    expect(digitalCategories.length).toBeGreaterThan(0);
    for (const category of digitalCategories) {
      expect(availableGenerationStyles({ category, role: "main" })).toEqual([
        "matches_original",
      ]);
    }
  });

  it("an informational supporting role (size chart, ingredients, device mockup, etc.) only offers matches_original regardless of category", () => {
    const informationalRoles = [
      "size_chart",
      "ingredients_materials",
      "bundle_layout",
      "feature_spec",
      "care_instruction",
      "digital_preview",
      "printed_example",
      "device_mockup",
      "planner_preview",
    ] as const;
    for (const role of informationalRoles) {
      // jewelry is picked deliberately: it's the category with the widest
      // normal availability (all 3 styles on main), so this proves the
      // informational-role restriction overrides category, not just
      // coincides with an already-narrow category.
      const styles = availableGenerationStyles({
        category: "jewelry",
        role: "supporting",
        supportingPhotoRole: role,
      });
      expect(styles).toEqual(["matches_original"]);
    }
  });

  it("a non-informational supporting role (detail close-up, alternate angle) keeps the category's normal availability", () => {
    const styles = availableGenerationStyles({
      category: "jewelry",
      role: "supporting",
      supportingPhotoRole: "detail_closeup",
    });
    expect(styles).toContain("studio");
  });
});

describe("generation-style: recommendation is data-only, one category signal at a time", () => {
  it("returns exactly one recommended style per category, or null", () => {
    for (const category of CATEGORY_IDS) {
      const rec = recommendedMainStyle(category);
      expect(rec === null || GENERATION_STYLES.includes(rec as GenerationStyle)).toBe(
        true
      );
    }
  });

  it("the recommended style, when non-null, is always itself an available style for that category's main photo", () => {
    for (const category of CATEGORY_IDS) {
      const rec = recommendedMainStyle(category);
      if (rec === null) continue;
      const available = availableGenerationStyles({ category, role: "main" });
      expect(available).toContain(rec);
    }
  });

  it("vintage recommends matches_original -- it never gets a studio/lifestyle default", () => {
    expect(recommendedMainStyle("vintage")).toBe("matches_original");
  });
});
