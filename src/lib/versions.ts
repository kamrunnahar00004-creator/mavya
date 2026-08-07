/**
 * Model + prompt version constants. Client-safe (no secrets).
 *
 * Bump a version whenever the corresponding prompt/schema changes in a way that
 * should invalidate cached scores or make old audits incomparable. score_cache
 * keys and audits.rubric_version persist these.
 */

/** Canonical category taxonomy version (src/lib/taxonomy.ts). */
export const TAXONOMY_VERSION = 1;

// main-v5 / supporting-v4: near-eight beta calibration (raw 7.5-7.9 presents
// as 8.0; raw preserved in raw_overall_score; rule near_eight_normalization_v1,
// 2026-07-11). Bumped so pre-calibration cached scores are never mistaken for
// results of the new scoring policy.
// main-v4 / supporting-v3 were: canonical 25-category taxonomy + category
// scoring notes + priority_pillar/priority_issue_family fields (2026-07-11).
// supporting-v8: is_marketing_graphic detection — a composed sales/advertising
// graphic (promo banner text, price/CTA overlay, ad-style collage) is flagged
// and DETERMINISTICALLY capped into the weak band, independent of the model's
// Accuracy pillar (which it scored inconsistently on collages). Also keeps the
// supporting-v7 Accuracy gate (background <= 3 caps at 4.9). (2026-08-07.)
export const RUBRIC_VERSION = "main-v12";
export const SUPPORTING_RUBRIC_VERSION = "supporting-v8";
export const CHECKLIST_PROMPT_VERSION = "checklist-v1";
export const GENERATION_PROMPT_VERSION = "gen-v2";
export const FIDELITY_PROMPT_VERSION = "fidelity-v2";

/** Rubric version for a scoring mode. */
export function rubricVersionFor(mode: "main" | "supporting"): string {
  return mode === "main" ? RUBRIC_VERSION : SUPPORTING_RUBRIC_VERSION;
}

/** Hard product limits enforced before any billable call. */
export const MAX_SUPPORTING_PHOTOS = 9;
export const MIN_IMAGE_DIMENSION = 200;
export const MAX_IMAGE_DIMENSION = 10000;
