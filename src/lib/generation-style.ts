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
  value: unknown,
): GenerationStyleCategory {
  if (value === "other") return "other";
  return typeof value === "string" &&
    (CATEGORY_IDS as readonly string[]).includes(value)
    ? (value as CanonicalCategory)
    : "other";
}

export type GenerationStyleOption = {
  id: GenerationStyle;
  /** Category-aware display label, e.g. "Model wearing it" for jewelry vs
   *  "Lifestyle scene" for candles. Populated by the caller
   *  (generationStyleLabel),
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
 * Client-safe picker label. Persisted ids stay stable while seller-facing
 * wording can describe the category-appropriate treatment honestly.
 */
export function generationStyleLabel(
  style: GenerationStyle,
  category?: GenerationStyleCategory,
): string {
  if (style === "matches_original") return "Polish this photo";
  if (style === "studio") return "Studio";
  if (
    category &&
    category !== "other" &&
    isLifestyleAllowedCategory(category)
  ) {
    const label = LIFESTYLE_LABEL_BY_CATEGORY[category];
    if (label) return label;
  }
  return "Model / Lifestyle";
}

/** Canonically ordered styles supported by every photo in a bulk roster. */
export function sharedGenerationStyles(
  styleGroups: readonly (readonly GenerationStyle[])[],
): GenerationStyle[] {
  if (styleGroups.length === 0) return [];
  return GENERATION_STYLES.filter((style) =>
    styleGroups.every((group) => group.includes(style)),
  );
}

/**
 * Informational/document-style supporting roles whose entire job is to
 * communicate EXACT information: a size chart, an ingredients label, a care
 * card, a spec sheet, a bundle layout, a device mockup. The buyer makes a
 * purchase decision on the literal characters, numbers, and item counts in
 * these photos.
 *
 * These roles get NO generative styles at all (Codex prompt audit,
 * 2026-08-29, finding 4/5). Until 2026-08-29 they returned
 * ["matches_original"], which was wrong in a way that was easy to miss:
 * "matches_original" is a STYLE, not a pipeline. Every style, that one
 * included, still routes through the generative image model in
 * improve-photo.ts. So a size chart reading "Chest: 40 in" was being handed
 * to a model that redraws the whole frame, and no amount of prompt text
 * ("TEXT AND NUMBERS ARE SACRED") can make a diffusion model guarantee
 * exact glyphs. A silently altered measurement reaches the buyer as fact,
 * and bundle_layout carries the same risk for item COUNTS.
 *
 * The block is enforced here rather than in the UI because
 * generation-queue.ts rejects any style outside availableGenerationStyles()
 * (see its "generate.style_rejected" path), so returning [] is an
 * authoritative server-side block for every entry point -- one-click fix,
 * Fix all, retry, AND seller-directed AI Edit -- not merely a hidden button.
 *
 * FOLLOW-UP (not built here, deliberately out of scope): these photos
 * usually only need exposure, contrast, rotation, and crop, which are
 * deterministic non-generative operations `sharp` already provides. Offering
 * that as a separate non-AI path is the right way to give these roles a fix
 * again. Blocking first is the safe half; do not re-enable the generative
 * path to restore the feature.
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
const LIFESTYLE_ALLOWED_CATEGORY_IDS = [
  "jewelry", // taxonomy.ts: "a clean model-worn close-up is acceptable when it clearly improves comprehension"
  "apparel", // worn by definition
  "bags", // taxonomy.ts scoring note: "scale (on-shoulder or beside a known object)"
  "wall_art", // taxonomy.ts: "on-wall shots communicate size" -- in-room context already endorsed
  "home_decor", // taxonomy.ts: "believable room context if it aids scale" -- already endorsed
  "mugs", // taxonomy.ts: "...lifestyle props unless explicitly requested" -- selecting this style IS that explicit request
  "candles", // same "unless explicitly requested" carve-out as mugs
] as const satisfies readonly CanonicalCategory[];

type LifestyleAllowedCategory = (typeof LIFESTYLE_ALLOWED_CATEGORY_IDS)[number];

const LIFESTYLE_ALLOWED_CATEGORIES: ReadonlySet<CanonicalCategory> = new Set(
  LIFESTYLE_ALLOWED_CATEGORY_IDS,
);

const LIFESTYLE_LABEL_BY_CATEGORY = {
  jewelry: "Model wearing it",
  apparel: "Model wearing it",
  bags: "Model carrying it",
  wall_art: "Styled room",
  home_decor: "Styled room",
  mugs: "Lifestyle scene",
  candles: "Lifestyle scene",
} as const satisfies Record<LifestyleAllowedCategory, string>;

function isLifestyleAllowedCategory(
  category: CanonicalCategory,
): category is LifestyleAllowedCategory {
  return (LIFESTYLE_ALLOWED_CATEGORY_IDS as readonly CanonicalCategory[]).includes(
    category,
  );
}

/** Lifestyle stays AVAILABLE for every category in the allowlist; this set
 * controls only which category gets the badge on its MAIN photo.
 *
 * Narrowed to apparel on 2026-08-29 (Codex style-picker audit). Jewelry and
 * bags were dropped for two independent reasons. First, Etsy expects the
 * first listing image to depict the actual item, and a generated model shot
 * is a synthetic scene -- a bad thing to nudge every seller toward by
 * default. Second, the model-worn view is only the clearest presentation
 * when fit or scale is the buyer's actual doubt; for jewelry and bags the
 * dominant doubt is usually detail, finish, and material, which a hand or
 * neck obstructs rather than clarifies. Both now fall through to studio.
 * Apparel keeps it because a garment's fit IS the product question, and a
 * flat garment genuinely under-describes it.
 *
 * Per-photo conditional suggestion (badge lifestyle only when the audit's own
 * diagnosed doubt is scale/fit) is the better long-term rule and is Codex's
 * stated target; this is the category-level correction available today. */
const LIFESTYLE_RECOMMENDED_CATEGORIES: ReadonlySet<CanonicalCategory> =
  new Set(["apparel"] as CanonicalCategory[]);

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

/** Membership set for the runtime check. The SOURCE list above stays typed
 *  as SupportingPhotoRole[], so a typo in a role name is still a compile
 *  error; only the lookup is widened. */
const INFORMATIONAL_SUPPORTING_ROLE_SET: ReadonlySet<string> = new Set(
  INFORMATIONAL_SUPPORTING_ROLES,
);

/**
 * Exported so fix-eligibility.ts and the workspace UI can mirror this block
 * without keeping a second hand-maintained copy of the role list. Two lists
 * that must agree is how "Fix all" ends up offering photos the queue refuses.
 *
 * Accepts a loose string because callers sit at different boundaries: the
 * queue and fix-eligibility hold a typed SupportingPhotoRole off the parsed
 * rubric, while the client workspace holds a widened `string | undefined`
 * hydrated from the server payload. Narrowing the parameter would have forced
 * a cast at the UI call site, and a cast there is precisely how a role that
 * must be blocked slips through unblocked.
 */
export function isInformationalSupportingRole(
  role: string | null | undefined,
): boolean {
  return Boolean(role && INFORMATIONAL_SUPPORTING_ROLE_SET.has(role));
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
  if (
    role === "supporting" &&
    isInformationalSupportingRole(supportingPhotoRole)
  ) {
    // No generative style is safe here -- see INFORMATIONAL_SUPPORTING_ROLES.
    // Returning [] is what actually blocks generation; callers must surface a
    // reason rather than silently doing nothing.
    return [];
  }
  if (role === "supporting") {
    const styles: GenerationStyle[] = ["matches_original"];
    if (
      supportingPhotoRole &&
      STUDIO_SUPPORTING_ROLES.has(supportingPhotoRole)
    ) {
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
  category: GenerationStyleCategory,
): GenerationStyle | null {
  if (category === "other") return "matches_original";
  if (categoryById(category)?.kind === "digital") return null;
  if (category === "vintage") return "matches_original";
  if (LIFESTYLE_RECOMMENDED_CATEGORIES.has(category)) return "lifestyle";
  return "studio";
}
