import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  availableGenerationStyles,
  GENERATION_STYLES,
  generationStyleLabel,
  isGenerationStyle,
  normalizeGenerationStyleCategory,
  recommendedMainStyle,
  sharedGenerationStyles,
  type GenerationStyle,
} from "@/lib/generation-style";
import { CATEGORY_IDS, categoryById } from "@/lib/taxonomy";

describe("generation-style: stable ids", () => {
  it("the three style ids match the Codex-approved architecture exactly", () => {
    expect(GENERATION_STYLES).toEqual([
      "matches_original",
      "studio",
      "lifestyle",
    ]);
  });

  it("validates request values without coercion", () => {
    for (const style of GENERATION_STYLES)
      expect(isGenerationStyle(style)).toBe(true);
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

describe("generation-style: category-aware picker labels", () => {
  it("keeps the two universal labels stable", () => {
    // Renamed 2026-08-29. "Matches Original" read as a guarantee of
    // identity, which is the exact thing the founder queried when the style
    // altered a background. The label now names the ACTION performed.
    expect(generationStyleLabel("matches_original", "jewelry")).toBe(
      "Polish this photo",
    );
    expect(generationStyleLabel("studio", "candles")).toBe("Studio");
  });

  it("uses model wording only for categories actually shown on a person", () => {
    expect(generationStyleLabel("lifestyle", "jewelry")).toBe(
      "Model wearing it",
    );
    expect(generationStyleLabel("lifestyle", "apparel")).toBe(
      "Model wearing it",
    );
    expect(generationStyleLabel("lifestyle", "bags")).toBe("Model carrying it");
    expect(generationStyleLabel("lifestyle", "candles")).toBe(
      "Lifestyle scene",
    );
    expect(generationStyleLabel("lifestyle", "home_decor")).toBe("Styled room");
  });

  it("uses neutral wording when a bulk request has no single category", () => {
    expect(generationStyleLabel("lifestyle")).toBe("Model / Lifestyle");
  });

  it("has specific lifestyle labels for every category that can offer lifestyle", () => {
    for (const category of CATEGORY_IDS) {
      const styles = availableGenerationStyles({ category, role: "main" });
      if (styles.includes("lifestyle")) {
        expect(generationStyleLabel("lifestyle", category)).not.toBe(
          "Model / Lifestyle",
        );
      }
    }
  });
});

describe("generation-style: honest bulk availability", () => {
  it("returns only styles available to every eligible photo", () => {
    expect(
      sharedGenerationStyles([
        ["matches_original", "studio", "lifestyle"],
        ["matches_original", "studio"],
      ]),
    ).toEqual(["matches_original", "studio"]);
  });

  it("narrows to what EVERY photo accepts, never the union", () => {
    // A union would let "Fix 5 photos" mean "up to 5, some may be skipped".
    expect(
      sharedGenerationStyles([
        ["matches_original", "studio", "lifestyle"],
        ["matches_original"],
      ]),
    ).toEqual(["matches_original"]);
  });

  it("collapses to nothing when one photo in the roster accepts nothing", () => {
    // This is why informational photos must be filtered OUT of the Fix-all
    // roster upstream (fix-eligibility.ts) rather than left in it: since
    // 2026-08-29 they return [], and one size chart left in the roster would
    // otherwise disable Fix all for the entire product.
    expect(
      sharedGenerationStyles([["matches_original", "studio"], []]),
    ).toEqual([]);
  });

  it("returns no choice for an empty roster", () => {
    expect(sharedGenerationStyles([])).toEqual([]);
  });
});

describe("generation-style: matches_original is the physical-photo baseline", () => {
  it("every physical category, main and supporting, includes matches_original", () => {
    // Scoped to photos with no informational supporting role. Those are
    // blocked outright since 2026-08-29 and are covered separately below;
    // this remains the baseline for every ordinary product photo.
    for (const category of CATEGORY_IDS) {
      if (categoryById(category)?.kind === "digital") continue;
      expect(availableGenerationStyles({ category, role: "main" })).toContain(
        "matches_original",
      );
      expect(
        availableGenerationStyles({ category, role: "supporting" }),
      ).toContain("matches_original");
    }
  });
});

describe("generation-style: category + role availability matrix", () => {
  it("jewelry main offers all three styles (model-worn is explicitly allowed by taxonomy.ts)", () => {
    expect(
      availableGenerationStyles({ category: "jewelry", role: "main" }).sort(),
    ).toEqual(["lifestyle", "matches_original", "studio"].sort());
  });

  it("candles never offer lifestyle unless explicitly requested via this exact picker, and that carve-out is honored", () => {
    const styles = availableGenerationStyles({
      category: "candles",
      role: "main",
    });
    expect(styles).toContain("studio");
    expect(styles).toContain("lifestyle");
  });

  it("categories whose taxonomy explicitly forbids lifestyle props never offer lifestyle", () => {
    for (const excluded of ["soap", "crochet_plush"] as const) {
      const styles = availableGenerationStyles({
        category: excluded,
        role: "main",
      });
      expect(styles).not.toContain("lifestyle");
      expect(styles).toContain("studio"); // studio (clean presentation) still fine
    }
  });

  it("vintage offers studio but conservatively recommends matches_original", () => {
    const styles = availableGenerationStyles({
      category: "vintage",
      role: "main",
    });
    expect(styles).toContain("studio");
    expect(styles).not.toContain("lifestyle");
    expect(recommendedMainStyle("vintage")).toBe("matches_original");
  });

  it("digital categories offer no styles because generation is blocked server-side", () => {
    const digitalCategories = CATEGORY_IDS.filter(
      (id) => categoryById(id)?.kind === "digital",
    );
    expect(digitalCategories.length).toBeGreaterThan(0);
    for (const category of digitalCategories) {
      expect(availableGenerationStyles({ category, role: "main" })).toEqual([]);
      expect(recommendedMainStyle(category)).toBeNull();
    }
  });

  it("defines a conservative policy for the model's other category", () => {
    expect(
      availableGenerationStyles({ category: "other", role: "main" }),
    ).toEqual(["matches_original"]);
    expect(recommendedMainStyle("other")).toBe("matches_original");
  });

  it("an informational supporting role (size chart, ingredients, device mockup, etc.) offers NO generative style at all", () => {
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
      expect(styles).toEqual([]);
    }
  });

  it("does not hand informational photos to the generative model via matches_original", () => {
    // THE BUG THIS FILE PREVIOUSLY ENCODED AS CORRECT. Until 2026-08-29 these
    // roles returned ["matches_original"], which looked conservative and was
    // not: matches_original is a STYLE, not a separate pipeline -- it still
    // routes through the generative image model in improve-photo.ts. So a
    // size chart reading "Chest: 40 in" was being handed to a model that
    // redraws the whole frame, and no prompt wording makes a diffusion model
    // guarantee exact glyphs. bundle_layout carries the same risk for COUNTS.
    // If a non-generative sharp-based path is added later, it must be a new
    // pipeline; re-adding a style here silently restores the defect.
    for (const role of ["size_chart", "bundle_layout"] as const) {
      expect(
        availableGenerationStyles({
          category: "apparel",
          role: "supporting",
          supportingPhotoRole: role,
        }),
      ).not.toContain("matches_original");
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
        }),
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
      }),
    ).toEqual(["matches_original", "lifestyle"]);
    expect(
      availableGenerationStyles({
        category: "jewelry",
        role: "supporting",
        supportingPhotoRole: "packaging",
      }),
    ).toEqual(["matches_original"]);
  });
});

describe("generation-style: recommendation is data-only, one category signal at a time", () => {
  it("returns exactly one recommended style per category, or null", () => {
    for (const category of CATEGORY_IDS) {
      const rec = recommendedMainStyle(category);
      expect(
        rec === null || GENERATION_STYLES.includes(rec as GenerationStyle),
      ).toBe(true);
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
    for (const category of [
      "candles",
      "mugs",
      "wall_art",
      "home_decor",
    ] as const) {
      expect(availableGenerationStyles({ category, role: "main" })).toContain(
        "lifestyle",
      );
      expect(recommendedMainStyle(category)).toBe("studio");
    }
  });

  it("recommends lifestyle only where fit is the product question itself", () => {
    expect(recommendedMainStyle("apparel")).toBe("lifestyle");
  });

  it("does not push jewelry or bags toward a generated model shot by default", () => {
    // Narrowed 2026-08-29 (Codex style-picker audit). Etsy expects the first
    // listing image to depict the actual item, so nudging every seller in
    // these categories toward a synthetic model scene for their MAIN photo is
    // the wrong default. The buyer's dominant doubt here is detail, finish,
    // and material -- which a hand or neck obstructs rather than clarifies.
    for (const category of ["jewelry", "bags"] as const) {
      expect(recommendedMainStyle(category)).toBe("studio");
      // Still OFFERED, just not badged: this is a default change, not a
      // capability removal.
      expect(
        availableGenerationStyles({ category, role: "main" }),
      ).toContain("lifestyle");
    }
  });
});

describe("generation-style: every generative entry point closes together", () => {
  const workspace = readFileSync(
    "src/components/dashboard/product-workspace.tsx",
    "utf8",
  );

  it("gates seller-directed AI Edit on the same informational-role check", () => {
    // The style policy alone covers one-click fix, Fix all, and retry.
    // audit-workspace.tsx also renders a STANDALONE AI Edit button, and AI
    // Edit posts to the same queue with a style -- so without this gate a
    // size chart still reached the generative model and came back with an
    // unexplained "This generation style is not available for this photo."
    expect(workspace).toContain("isInformationalSupportingRole(active.supportingRole)");
    expect(workspace).toContain(
      "onEdit={wrongProduct || informationalDocument ? undefined : handleEdit}",
    );
  });

  it("hides one-click fix for the same photos", () => {
    expect(workspace).toContain("!informationalDocument");
  });

  it("explains the block in the banner rather than leaving a dead panel", () => {
    expect(workspace).toContain(
      "This photo carries information a buyer will rely on, so AI improvement is off for it.",
    );
  });

  it("still shows the rating -- only generation is withheld", () => {
    // CLAUDE.md rule 2: every uploaded product photo may be assessed.
    expect(workspace).toContain("Your rating is ready below.");
  });
});
