/**
 * Model + prompt version constants. Client-safe (no secrets).
 *
 * Bump a version whenever the corresponding prompt/schema changes in a way that
 * should invalidate cached scores or make old audits incomparable. score_cache
 * keys and audits.rubric_version persist these.
 */

/** Canonical category taxonomy version (src/lib/taxonomy.ts). */
export const TAXONOMY_VERSION = 1;

// main-v4 / supporting-v3: canonical 25-category taxonomy + category scoring
// notes + priority_pillar/priority_issue_family fields (2026-07-11). Bumping
// invalidates the score cache by design.
export const RUBRIC_VERSION = "main-v4";
export const SUPPORTING_RUBRIC_VERSION = "supporting-v3";
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
