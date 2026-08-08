import type { FidelityReport } from "@/lib/fidelity";

/**
 * Copy shown alongside a "free preview" (a generated candidate the fidelity
 * check flagged for review rather than a clean pass). Pure + dependency-light
 * so it is unit-testable without rendering the client component.
 */

const FREE_PREVIEW_PREFIX =
  "This version is better, but Mavya still found things worth reviewing. We recommend ";

// Default honest message when the fidelity check found nothing specific to
// flag. Points the seller straight at AI Edit for a directed change instead of
// a vague "worth reviewing" hedge. The general "Label text and small patterns
// may differ..." disclaimer (shown unconditionally, for every improved
// preview) already covers the verify-before-publish requirement, so this
// message does not need to repeat it.
export const NEUTRAL_PREVIEW_MESSAGE =
  "We kept your product exactly as uploaded. For a different result, use AI Edit and tell us what to change.";

export function freePreviewMessage(fidelity: FidelityReport | null): string {
  if (!fidelity) return NEUTRAL_PREVIEW_MESSAGE;
  // Fidelity flags can coexist (a candidate can be BOTH ai_looking AND
  // text_or_pattern_drift). Check the more severe/actionable warnings FIRST so
  // the removed drift message (below) never silently suppresses a real
  // AI-looking or incomplete-product warning that also applies.
  if (fidelity.ai_looking) {
    return "This version may look AI-generated. Check it against your real product before using it.";
  }
  if (!fidelity.full_product_visible) {
    return `${FREE_PREVIEW_PREFIX}uploading a photo that shows the complete product.`;
  }
  // Founder decision 2026-08-08: removed WHEN drift/invented-details is the
  // only flag raised. Redundant with the always-shown "Label text and small
  // patterns may differ..." disclaimer, which already satisfies the
  // verify-before-publish requirement for every AI-improved preview.
  if (fidelity.text_or_pattern_drift || fidelity.invented_or_missing_details) {
    return "";
  }
  return NEUTRAL_PREVIEW_MESSAGE;
}
