import type { RubricJson } from "@/lib/rubric";
import { bandForScore } from "@/lib/utils";

export type FixEligibilityBucket =
  | "needs_work"
  | "acceptable"
  | "strong"
  | "not_generatable";

/**
 * "Fix all" eligibility (slice 4, 2026-08-23). Deterministic, code-computed
 * -- never returned by the AI. One shared function, used by both the
 * product-page hydration display and the bulk-fix endpoint, so the two can
 * never disagree about which photos are eligible.
 *
 * `not_generatable` mirrors the REAL server-side gates in
 * /api/generate/route.ts exactly (verified directly against that file this
 * session, not assumed): upload_kind digital/invalid, is_marketing_graphic,
 * supporting_photo_role digital_preview or (supporting only)
 * unrelated_or_wrong_product, and generation_risk "unsupported". Those
 * gates in the real route only apply when operation !== "edit" -- "Fix
 * all" is always the AUTO one-click path, never a seller-directed edit, so
 * that condition always holds here and isn't parameterized.
 *
 * generation_risk === "review_text" remains generatable: the live endpoint
 * currently allows it, only "unsupported" blocks.
 *
 * Otherwise reuses the SAME score bands already canonical elsewhere in the
 * UI (bandForScore, src/lib/utils.ts: <6 weak, 6-<8 mid, >=8 strong) rather
 * than a second set of thresholds -- a seller who sees their score band as
 * "strong" on screen must never have "Fix all" silently disagree about it.
 * Uses the PRESENTED overall_score (post-calibration), matching every
 * other place bandForScore is already called against a displayed score,
 * not the raw pre-calibration value.
 */
export function computeFixEligibilityBucket(
  rubric: Pick<
    RubricJson,
    | "overall_score"
    | "upload_kind"
    | "is_marketing_graphic"
    | "supporting_photo_role"
    | "generation_risk"
  >,
  role: "main" | "supporting"
): FixEligibilityBucket {
  const notGeneratable =
    rubric.upload_kind === "invalid" ||
    rubric.upload_kind === "digital_product" ||
    rubric.is_marketing_graphic === true ||
    rubric.supporting_photo_role === "digital_preview" ||
    (role === "supporting" &&
      rubric.supporting_photo_role === "unrelated_or_wrong_product") ||
    rubric.generation_risk === "unsupported";
  if (notGeneratable) return "not_generatable";

  const band = bandForScore(rubric.overall_score);
  if (band === "strong") return "strong";
  if (band === "mid") return "acceptable";
  return "needs_work";
}

/** The two buckets "Fix all" actually queues. strong (already good) and
 *  not_generatable (the endpoint would refuse it anyway) are excluded. */
export function isFixAllEligible(bucket: FixEligibilityBucket): boolean {
  return bucket === "needs_work" || bucket === "acceptable";
}
