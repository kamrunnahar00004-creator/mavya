import type { RubricJson } from "@/lib/rubric";
import { bandForScore } from "@/lib/utils";

export type FixEligibilityBucket =
  | "needs_work"
  | "acceptable"
  | "strong"
  | "not_generatable";

/**
 * "Fix all" INTRINSIC quality bucket (slice 4, 2026-08-23). Deterministic,
 * code-computed -- never returned by the AI. One shared function, used by
 * both the product-page hydration display and the bulk-fix endpoint, so the
 * two can never disagree about a photo's intrinsic score band and permanent
 * generation gates.
 *
 * This is NOT complete "Fix all" operational eligibility (Codex architecture
 * review, Slice 4b, 2026-08-23, finding 4): a photo can be needs_work or
 * acceptable here and still be correctly skipped by the bulk endpoint for
 * reasons this function has no way to see -- no current/stale audit, an
 * already selected/generated preview (already_improved), or an active root
 * generation workflow already in flight (already_active). Those are
 * per-request, point-in-time conditions the bulk route (src/lib/bulk-fix.ts,
 * src/app/api/generate/bulk/route.ts) checks separately, server-side, right
 * before queueing.
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

export type FixAllDisplayInput = {
  rubric: Parameters<typeof computeFixEligibilityBucket>[0] | null;
  role: "main" | "supporting";
  /** photo.status === "graded" -- a rubric-less/still-rating/failed photo
   *  has no bucket to compute at all. */
  graded: boolean;
  /** A generation is currently running or background-refining for this
   *  photo (client's live view of the server's already_active check). */
  active: boolean;
  /** A selected generation is currently the shown preview (client's live
   *  view of the server's already_improved check, photos.selected_generation_job_id). */
  alreadyImproved: boolean;
};

/**
 * "Fix all" DISPLAY eligibility (Fix-all UI wiring, 2026-08-24, Codex
 * review). A client-side HINT ONLY, for the bulk button's label and
 * visibility -- POST /api/generate/bulk re-derives the real eligible set
 * from scratch on every click and is the sole authority on what actually
 * queues. Layers the per-request conditions the intrinsic bucket alone
 * can't see on top of computeFixEligibilityBucket + isFixAllEligible,
 * mirroring (never duplicating) the same layering the server does in
 * src/lib/bulk-fix.ts's classifyPhotoForBulkFix -- stale_audit ->
 * !graded, already_active -> active, already_improved -> alreadyImproved.
 */
export function isFixAllDisplayEligible(input: FixAllDisplayInput): boolean {
  if (!input.graded || !input.rubric || input.active || input.alreadyImproved) {
    return false;
  }
  return isFixAllEligible(computeFixEligibilityBucket(input.rubric, input.role));
}
