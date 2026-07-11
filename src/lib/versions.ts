/**
 * Model + prompt version constants. Client-safe (no secrets).
 *
 * Bump a version whenever the corresponding prompt/schema changes in a way that
 * should invalidate cached scores or make old audits incomparable. score_cache
 * keys and audits.rubric_version persist these.
 */

export const RUBRIC_VERSION = "main-v3";
export const SUPPORTING_RUBRIC_VERSION = "supporting-v2";
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
