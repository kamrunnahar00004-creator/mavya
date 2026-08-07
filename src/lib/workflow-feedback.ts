/**
 * Pure builder for the post-workflow feedback upsert PATCH.
 *
 * PATCH semantics: only fields the caller actually supplied are written, so the
 * star widget can never erase older boolean feedback and an old boolean caller
 * can never erase stars. A SUPPLIED but invalid star is a hard error, never a
 * silent null. Kept pure (no DB, no request) so it is unit-testable.
 */

export const FEEDBACK_MAX_TEXT = 500;

function cleanText(v: unknown): string | null {
  return typeof v === "string"
    ? v.replace(/\s+/g, " ").trim().slice(0, FEEDBACK_MAX_TEXT) || null
    : null;
}

export type FeedbackFieldsResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string };

const BOOL_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["betterThanOriginal", "better_than_original"],
  ["wouldUse", "would_use"],
  ["detailChanged", "detail_changed"],
];

const TEXT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["preferredVersion", "preferred_version"],
  ["rejectionReason", "rejection_reason"],
  ["ratingAgreementNote", "rating_agreement_note"],
  ["imageRatingNote", "image_rating_note"],
];

const STAR_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["ratingAgreement", "rating_agreement"],
  ["imageRating", "image_rating"],
];

export function buildWorkflowFeedbackFields(
  body: Record<string, unknown>
): FeedbackFieldsResult {
  const fields: Record<string, unknown> = {};

  for (const [key, col] of BOOL_FIELDS) {
    if (key in body) fields[col] = typeof body[key] === "boolean" ? body[key] : null;
  }

  for (const [key, col] of TEXT_FIELDS) {
    if (key in body) fields[col] = cleanText(body[key]);
  }

  for (const [key, col] of STAR_FIELDS) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v === null) {
      fields[col] = null;
      continue;
    }
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) {
      fields[col] = v;
      continue;
    }
    return { ok: false, error: `Invalid ${key}: expected an integer 1 to 5.` };
  }

  if (Object.keys(fields).length === 0) {
    return { ok: false, error: "No feedback provided." };
  }
  return { ok: true, fields };
}
