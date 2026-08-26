import {
  CATEGORY_IDS,
  categoryById,
  type CanonicalCategory,
} from "@/lib/taxonomy";
import type { SupportingPhotoRole } from "@/lib/rubric";

/**
 * Shared, CLIENT-SAFE generation-style policy (style picker, slice 1 of the
 * Codex-approved architecture). Kept dependency-light on purpose, the same
 * pattern as generation-policy.ts: this module is imported by both the
 * popup UI (client) and the server-side request validator, so the two can
 * never drift on WHICH styles exist or are offered for a given
 * category/role. It carries no prompt text and no generation instructions
 * -- those are server-only (see the point-2 warning below) and live in a
 * separate module Codex owns.
 *
 * NEVER add detailed generation prompt strings to this file. If you find
 * yourself writing an instruction sentence here, it belongs in the
 * server-only prompt-strategy module instead.
 */

/** Stable, persisted ids. Never rename once shipped -- these get written to
 *  generation_jobs.generation_style and bulk_generation_requests. Labels
 *  may vary by category; ids must not. */
export type GenerationStyle = "matches_original" | "studio" | "lifestyle";

/** The model may return `other` even though it is not a catalog category. */
export type GenerationStyleCategory = CanonicalCategory | "other";

export const GENERATION_STYLES: readonly GenerationStyle[] = [
  "matches_original",
  "studio",
  "lifestyle",
];

/** Runtime boundary guard for JSON request bodies and persisted values. */
export function isGenerationStyle(value: unknown): value is GenerationStyle {
  return (
    typeof value === "string" &&
    (GENERATION_STYLES as readonly string[]).includes(value)
  );
}

/** Conservative bridge from persisted/model strings into the policy type. */
export function normalizeGenerationStyleCategory(
  value: unknown
): GenerationStyleCategory {
  if (value === "other") return "other";
  return typeof value === "string" &&
    (CATEGORY_IDS as readonly string[]).includes(value)
    ? (value as CanonicalCategory)
    : "other";
}

export type GenerationStyleOption = {
  id: GenerationStyle;
  /** Category-aware display label, e.g. "Model / Lifestyle" for jewelry vs
   *  "Styled scene" for candles. Populated by the caller (labelForStyle),
   *  not hardcoded per option here, so the same availability data can
   *  drive different wording without duplicating the matrix. */
  label: string;
  /** True only for the single best default for a MAIN thumbnail of this
   *  category. Display metadata only -- never authorization, and the
   *  caller decides whether to actually render a badge (main popup: yes;
   *  supporting/bulk popup: never, per the approved architecture). */
  recommendedForMain: boolean;
};

/**
 * Informational/document-style supporting roles where a studio or
 * lifestyle treatment does not make sense at all -- the photo's entire
 * job is to communicate exact information (a size chart, an ingredients
 * label, a device mockup), not to look appealing. These roles get
 * "matches_original" only, regardless of category.
 *
 * These roles retain only the existing restrained treatment. They must not
 * be restaged into studio/lifestyle scenes because their text, measurements,
 * contents, or display context are the information being sold.
 */
const INFORMATIONAL_SUPPORTING_ROLES: readonly SupportingPhotoRole[] = [
  "size_chart",
  "ingredients_materials",
  "bundle_layout",
  "feature_spec",
  "care_instruction",
  "printed_example",
  "device_mockup",
  "planner_preview",
];

/** These roles already fail the authoritative generation queue's safety
 * gates. Keep the style policy aligned so a future caller cannot present a
 * picker that the server will inevitably reject. */
const BLOCKED_SUPPORTING_ROLES: ReadonlySet<SupportingPhotoRole> = new Set([
  "digital_preview",
  "unrelated_or_wrong_product",
]);

/**
 * Explicit lifestyle/model allowlist by category, per architecture
 * requirement 4 ("do not offer model generation universally"). Populated
 * from taxonomy.ts's OWN existing generation-guidance text where that text
 * already gives an unambiguous signal (categories that already say
 * "Product-only presentation, do not add lifestyle props" are excluded;
 * categories whose guidance already anticipates model/lifestyle context
 * are included) -- not invented independently of the taxonomy that
 * already governs generation behavior.
 *
 * NOT YET CODEX-CONFIRMED for: vintage (condition-honesty risk), personalized
 * (text-preservation risk), stickers/stationery/art_supplies (ambiguous,
 * defaulted to excluded/conservative). Every digital category is excluded
 * -- lifestyle/studio styling does not apply to screenshots and mockups.
 */
const LIFESTYLE_ALLOWED_CATEGORIES: ReadonlySet<CanonicalCategory> = new Set([
  "jewelry", // taxonomy.ts: "a clean model-worn close-up is acceptable when it clearly improves comprehension"
  "apparel", // worn by definition
  "bags", // taxonomy.ts scoring note: "scale (on-shoulder or beside a known object)"
  "wall_art", // taxonomy.ts: "on-wall shots communicate size" -- in-room context already endorsed
  "home_decor", // taxonomy.ts: "believable room context if it aids scale" -- already endorsed
  "mugs", // taxonomy.ts: "...lifestyle props unless explicitly requested" -- selecting this style IS that explicit request
  "candles", // same "unless explicitly requested" carve-out as mugs
] as CanonicalCategory[]);

/** Lifestyle is available for these categories, but is not the safest first
 * choice for a cold main-photo fix. Model-worn context is the clearest default
 * only where fit/scale is central to understanding the product. */
const LIFESTYLE_RECOMMENDED_CATEGORIES: ReadonlySet<CanonicalCategory> = new Set([
  "jewelry",
  "apparel",
  "bags",
] as CanonicalCategory[]);

/** Supporting photos must preserve their existing job. Studio treatment is
 * limited to roles where a cleaner controlled presentation does not replace
 * that job with a different scene. */
const STUDIO_SUPPORTING_ROLES: ReadonlySet<SupportingPhotoRole> = new Set([
  "detail_closeup",
  "alternate_angle",
  "variation",
]);

/** Lifestyle treatment is only coherent for an already in-use photo. It must
 * never turn a detail, packaging, process, or informational image into a new
 * kind of supporting photo. */
const LIFESTYLE_SUPPORTING_ROLES: ReadonlySet<SupportingPhotoRole> = new Set([
  "in_use",
]);

function isInformationalSupportingRole(
  role: SupportingPhotoRole | undefined
): boolean {
  return Boolean(role && INFORMATIONAL_SUPPORTING_ROLES.includes(role));
}

/**
 * The set of generation styles available for a given photo. "matches_original"
 * is always available -- it is today's existing, unchanged behavior and the
 * required no-regression baseline. Studio and lifestyle are added only when
 * the category/role rules allow them.
 *
 * Pure function, no recommendation logic beyond the data-level
 * recommendedForMain flag -- callers decide whether to render it.
 */
export function availableGenerationStyles(args: {
  category: GenerationStyleCategory;
  role: "main" | "supporting";
  supportingPhotoRole?: SupportingPhotoRole;
}): GenerationStyle[] {
  const { category, role, supportingPhotoRole } = args;
  if (category === "other") {
    // Unknown may represent a product outside the catalog. Do not infer a
    // physical scene or model treatment without category-specific safeguards.
    return ["matches_original"];
  }
  if (categoryById(category)?.kind === "digital") {
    // Digital generation is rejected by the authoritative server queue today.
    // Returning no options keeps this policy honest if it is reused by either
    // the picker or request validator.
    return [];
  }
  if (
    role === "supporting" &&
    supportingPhotoRole &&
    BLOCKED_SUPPORTING_ROLES.has(supportingPhotoRole)
  ) {
    return [];
  }
  if (role === "supporting" && isInformationalSupportingRole(supportingPhotoRole)) {
    return ["matches_original"];
  }
  if (role === "supporting") {
    const styles: GenerationStyle[] = ["matches_original"];
    if (supportingPhotoRole && STUDIO_SUPPORTING_ROLES.has(supportingPhotoRole)) {
      styles.push("studio");
    }
    if (
      supportingPhotoRole &&
      LIFESTYLE_SUPPORTING_ROLES.has(supportingPhotoRole) &&
      LIFESTYLE_ALLOWED_CATEGORIES.has(category)
    ) {
      styles.push("lifestyle");
    }
    return styles;
  }
  const styles: GenerationStyle[] = ["matches_original"];
  // A studio treatment may change only presentation. Vintage preservation is
  // enforced by the server prompt/fidelity gate, not by hiding the option.
  styles.push("studio");
  if (LIFESTYLE_ALLOWED_CATEGORIES.has(category)) {
    styles.push("lifestyle");
  }
  return styles;
}

/**
 * The recommended default style for a category's MAIN thumbnail, or null
 * when matches_original is the safest default (no strong category signal
 * either way). Purely informational -- see GenerationStyleOption's own
 * doc comment on how callers must treat this.
 */
export function recommendedMainStyle(
  category: GenerationStyleCategory
): GenerationStyle | null {
  if (category === "other") return "matches_original";
  if (categoryById(category)?.kind === "digital") return null;
  if (category === "vintage") return "matches_original";
  if (LIFESTYLE_RECOMMENDED_CATEGORIES.has(category)) return "lifestyle";
  return "studio";
}
