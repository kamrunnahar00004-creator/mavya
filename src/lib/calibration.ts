import type { RubricJson } from "@/lib/rubric";

/**
 * TEMPORARY beta score calibration (founder decision, 2026-07-11).
 *
 * Exact rule ("near-eight normalization"):
 *   raw 0.0-7.4  -> unchanged
 *   raw 7.5-7.9  -> presented as 8.0
 *   raw 8.0-10.0 -> unchanged
 *
 * This is NOT rounding: 8.4 stays 8.4, 7.4 stays 7.4. It applies identically to
 * original uploads and generated candidates (no special advantage for generated
 * images). The honest pre-calibration score is preserved in
 * `raw_overall_score` so the founder can later review ~20-30 real results
 * around raw 7.5-8.4 blindly and decide whether the rule stays.
 *
 * ORDER MATTERS: every authenticity/trust/fidelity safeguard runs BEFORE this
 * normalization. computeOverall() applies the click_appeal trust ceiling (cap
 * 6.9) first, so a weighted 7.7 pulled down to 6.9 by the trust ceiling is
 * NOT promoted to 8.0. Fidelity/safety gates on generated candidates evaluate
 * boolean drift flags and fidelity scores that calibration never touches.
 */
export const CALIBRATION_RULE = "near_eight_normalization_v1";

/** Apply the exact near-eight rule to a raw (post-safeguard) overall score. */
export function calibrateScore(raw: number): number {
  if (!Number.isFinite(raw)) return raw;
  return raw >= 7.5 && raw < 8.0 ? 8.0 : raw;
}

/**
 * The honest pre-calibration score of a rubric. Falls back to overall_score
 * for legacy audits persisted before calibration existed (those were never
 * calibrated, so overall_score IS the raw score).
 *
 * Use this for ALL internal comparisons: refinement triggers, selection
 * ("strictly better"), gain thresholds, and eval golds. Calibrated
 * overall_score is presentation only.
 */
export function rawOverall(
  rubric: Pick<RubricJson, "overall_score"> & { raw_overall_score?: number }
): number {
  return typeof rubric.raw_overall_score === "number"
    ? rubric.raw_overall_score
    : rubric.overall_score;
}

/**
 * Enrich a scored rubric in place: preserve the raw score, then present the
 * calibrated score. Call ONLY after the backend recompute (which includes the
 * trust ceiling) has produced the final honest raw score.
 */
export function applyScoreCalibration(rubric: RubricJson): RubricJson {
  const raw = rubric.overall_score;
  rubric.raw_overall_score = raw;
  rubric.overall_score = calibrateScore(raw);
  rubric.calibration_rule = CALIBRATION_RULE;
  return rubric;
}
