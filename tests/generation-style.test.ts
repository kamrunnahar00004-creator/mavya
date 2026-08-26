import { describe, expect, it } from "vitest";
import {
  availableGenerationStyles,
  GENERATION_STYLES,
  isGenerationStyle,
  normalizeGenerationStyleCategory,
  recommendedMainStyle,
  type GenerationStyle,
} from "@/lib/generation-style";
import { CATEGORY_IDS, categoryById } from "@/lib/taxonomy";

describe("generation-style: stable ids", () => {
  it("the three style ids match the Codex-approved architecture exactly", () => {
    expect(GENERATION_STYLES).toEqual(["matches_original", "studio", "lifestyle"]);
  });

  it("validates request values without coercion", () => {
    for (const style of GENERATION_STYLES) expect(isGenerationStyle(style)).toBe(true);
    for (const invalid of [undefined, null, "", "Studio", "model", 1]) {
      expect(isGenerationStyle(invalid)).toBe(false);
    }
  });

  it("normalizes unknown persisted categories to the conservative other policy", () => {
    expect(normalizeGenerationStyleCategory("jewelry")).toBe("jewelry");
    expect(normalizeGenerationStyleCategory("other")).toBe("other");
    expect(normalizeGenerationStyleCategory("future_category")).toBe("other");
    expect(normalizeGenerationStyleCategory(null)).toBe("other");
  });
});

describe("generation-style: matches_original is the physical-photo baseline", () => {
  it("every physical category, main and supporting, includes matches_original", () => {
    for (const category of CATEGORY_IDS) {
      if (categoryById(category)?.kind === "digital") continue;
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

  it("vintage offers studio but conservatively recommends matches_original", () => {
    const styles = availableGenerationStyles({ category: "vintage", role: "main" });
    expect(styles).toContain("studio");
    expect(styles).not.toContain("lifestyle");
    expect(recommendedMainStyle("vintage")).toBe("matches_original");
  });

  it("digital categories offer no styles because generation is blocked server-side", () => {
    const digitalCategories = CATEGORY_IDS.filter(
      (id) => categoryById(id)?.kind === "digital"
    );
    expect(digitalCategories.length).toBeGreaterThan(0);
    for (const category of digitalCategories) {
      expect(availableGenerationStyles({ category, role: "main" })).toEqual([]);
      expect(recommendedMainStyle(category)).toBeNull();
    }
  });

  it("defines a conservative policy for the model's other category", () => {
    expect(availableGenerationStyles({ category: "other", role: "main" })).toEqual([
      "matches_original",
    ]);
    expect(recommendedMainStyle("other")).toBe("matches_original");
  });

  it("an informational supporting role (size chart, ingredients, device mockup, etc.) only offers matches_original regardless of category", () => {
    const informationalRoles = [
      "size_chart",
      "ingredients_materials",
      "bundle_layout",
      "feature_spec",
      "care_instruction",
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

  it("offers no styles for supporting roles the generation queue already blocks", () => {
    for (const supportingPhotoRole of [
      "digital_preview",
      "unrelated_or_wrong_product",
    ] as const) {
      expect(
        availableGenerationStyles({
          category: "jewelry",
          role: "supporting",
          supportingPhotoRole,
        })
      ).toEqual([]);
    }
  });

  it("a detail supporting role allows studio but never changes into lifestyle", () => {
    const styles = availableGenerationStyles({
      category: "jewelry",
      role: "supporting",
      supportingPhotoRole: "detail_closeup",
    });
    expect(styles).toContain("studio");
    expect(styles).not.toContain("lifestyle");
  });

  it("lifestyle is available to supporting photos only when their existing role is in_use", () => {
    expect(
      availableGenerationStyles({
        category: "jewelry",
        role: "supporting",
        supportingPhotoRole: "in_use",
      })
    ).toEqual(["matches_original", "lifestyle"]);
    expect(
      availableGenerationStyles({
        category: "jewelry",
        role: "supporting",
        supportingPhotoRole: "packaging",
      })
    ).toEqual(["matches_original"]);
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

  it("does not recommend lifestyle merely because it is available", () => {
    for (const category of ["candles", "mugs", "wall_art", "home_decor"] as const) {
      expect(availableGenerationStyles({ category, role: "main" })).toContain(
        "lifestyle"
      );
      expect(recommendedMainStyle(category)).toBe("studio");
    }
  });

  it("recommends lifestyle only where model/fit/scale is central", () => {
    for (const category of ["jewelry", "apparel", "bags"] as const) {
      expect(recommendedMainStyle(category)).toBe("lifestyle");
    }
  });
});
