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
// supporting-v9: is_marketing_graphic is now actually EMITTABLE — the field was
// added to the strict OpenAI response schema (openai.ts); under v8 the prompt
// asked for it but the strict schema forbade it (additionalProperties:false), so
// it never reached the parser/UI/server gate. Bumped to invalidate any v8 audits
// cached without the field. Detection only (no score penalty); a composed
// listing graphic is scored honestly on usefulness (can be 8+); weak+strong
// worked examples teach the boundary; the flag drives UI disclosure + generation
// gating. Keeps the supporting-v7 Accuracy gate (background <= 3 caps at 4.9) as
// the only misleading-graphic safety net. (2026-08-07.)
// main-v14: main-rubric is_marketing_graphic WORKED EXAMPLES (a positive
// banner+diagram-as-main -> true even when physical_product; a negative
// studio/lifestyle photo -> false). v13's plain instruction was ignored on the
// positive case (composed graphic-as-main flagged false, leaving one-click
// permitted); the worked example is the lever that moves gpt-4o. Detection only.
// v13: is_marketing_graphic first added to the MAIN prompt + JSON shapes.
export const RUBRIC_VERSION = "main-v14";
export const SUPPORTING_RUBRIC_VERSION = "supporting-v9";
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
