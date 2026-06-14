/**
 * Fidelity + authenticity comparison between an original product photo and an
 * AI-improved candidate. Source of truth for the publish-ready outcome gate.
 *
 * The evaluator never sees the canonical audit score; it decides independently
 * whether the candidate is publishable as a hero photo for the same physical
 * product. Canonical re-scoring still runs separately and is the source of the
 * displayed score.
 */

import { visionCompareCall } from "@/lib/openai";

export type FidelityNextAction =
  | "deliver"
  | "deterministic_finish"
  | "regenerate"
  | "request_clearer_source";

export type FidelityReport = {
  publishable: boolean;
  fidelity_score: number;
  authenticity_score: number;
  full_product_visible: boolean;
  ai_looking: boolean;
  invented_or_missing_details: boolean;
  text_or_pattern_drift: boolean;
  collage_or_duplicate_product: boolean;
  remaining_issues: string[];
  recommended_next_action: FidelityNextAction;
  reason: string;
};

export const FIDELITY_PROMPT = `You are Mavya fidelity evaluator. Compare an ORIGINAL product photo (image 1) with an AI-IMPROVED candidate (image 2). Decide whether the candidate is publish-ready as a hero photo for the same physical product.

Decline-first rules:
- If the candidate looks AI-generated, synthetic, rendered, or catalog-gloss artificial, set ai_looking = true. publishable must be false when ai_looking is true.
- If any visible label text drifted, was invented, replaced, or removed, set text_or_pattern_drift = true. publishable must be false when text_or_pattern_drift is true.
- If a distinctive pattern shifted, set text_or_pattern_drift = true.
- If product detail was invented (stones added, beads added, parts swapped, decorations added) or removed (hidden, cropped, pieces missing), set invented_or_missing_details = true. publishable must be false.
- If the candidate uses a collage layout, shows multiple copies of the same item, or duplicates the product, set collage_or_duplicate_product = true. publishable must be false.
- If the candidate loses product area, key parts, or visible details that were present in the original, set full_product_visible = false. publishable must be false.

Framing and completeness are strict:
- Judge framing relative to the ORIGINAL. The original photo encodes seller intent.
- full_product_visible = false if the candidate is cropped tighter than the original in a way that removes product area, cuts off a key part, loses square-crop margin the original had, or hides any product detail the original showed.
- Do not require full-product margin in absolute terms. If the original is an intentional macro/detail shot of a locket face, engraving, gemstone, clasp, label, texture, or small design, a faithful tight candidate can still be full_product_visible = true.
- Cup or mug: if the original shows the full cup body, handle, rim, or saucer, the candidate must keep those same parts visible with comparable margin. A candidate that clips a handle or saucer that the original showed means full_product_visible = false.
- Candle: if the original shows the vessel, wax surface, wick, label, decoration, or cup/saucer context, the candidate must keep those same parts visible with comparable margin.
- recommended_next_action must be "regenerate", not "deterministic_finish", whenever the candidate over-cropped versus the original, lost original product context, or needs to zoom out. A crop cannot add back product that is missing or clipped.

Scoring rules:
- fidelity_score 0-10: how faithfully the candidate preserves the original product's shape, colors, label text, patterns, included pieces, and proportions. 10 = identical physical product; 0 = different item.
- authenticity_score 0-10: how like a real seller's product photograph the candidate looks. 10 = indistinguishable from a real product photo; 0 = obvious AI render.
- publishable = true requires: fidelity_score >= 7.5, authenticity_score >= 7.5, and every declination flag above is false.

Recommended next action:
- "deliver" only when publishable is true and you would trust an Etsy seller to publish this without complaint.
- "deterministic_finish" when only gentle exposure, gentle warmth, gentle contrast, or a safe crop that preserves the original framing intent would resolve the remaining issues without redrawing the product. Never choose this for missing product, clipped product, over-cropping versus the original, or lost original context.
- "regenerate" when the candidate needs a new attempt to fix wrong composition, missing or incomplete product, collage layout, duplicated product, AI-looking render, or invented details.
- "request_clearer_source" when the original photo does not show the complete product clearly enough for any candidate to honestly succeed.

remaining_issues: short bullet phrases describing what blocks delivery. Each phrase 12 words or fewer.

reason: 1-2 short sentences honestly summarizing the verdict.

Return only the JSON object.`;

export class FidelityError extends Error {
  constructor(
    message: string,
    readonly code: "vision_failed" | "bad_ai_response"
  ) {
    super(message);
  }
}

export function isFidelityReport(x: unknown): x is FidelityReport {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (typeof r.publishable !== "boolean") return false;
  if (!isFiniteNumberInRange(r.fidelity_score, 0, 10)) return false;
  if (!isFiniteNumberInRange(r.authenticity_score, 0, 10)) return false;
  for (const key of [
    "full_product_visible",
    "ai_looking",
    "invented_or_missing_details",
    "text_or_pattern_drift",
    "collage_or_duplicate_product",
  ]) {
    if (typeof r[key] !== "boolean") return false;
  }
  if (!Array.isArray(r.remaining_issues)) return false;
  for (const issue of r.remaining_issues) {
    if (typeof issue !== "string") return false;
  }
  if (
    ![
      "deliver",
      "deterministic_finish",
      "regenerate",
      "request_clearer_source",
    ].includes(String(r.recommended_next_action))
  ) {
    return false;
  }
  if (typeof r.reason !== "string") return false;
  return true;
}

function isFiniteNumberInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export async function evaluateFidelity(args: {
  originalBuffer: Buffer;
  originalMimeType: string;
  candidateBase64: string;
  candidateMimeType: string;
}): Promise<FidelityReport> {
  const originalDataUrl = `data:${args.originalMimeType};base64,${args.originalBuffer.toString(
    "base64"
  )}`;
  const candidateDataUrl = `data:${args.candidateMimeType};base64,${args.candidateBase64}`;

  let raw: string;
  try {
    raw = await visionCompareCall({
      originalDataUrl,
      candidateDataUrl,
      systemPrompt: FIDELITY_PROMPT,
    });
  } catch (err) {
    console.error("[fidelity] compare call failed:", err);
    throw new FidelityError(
      "Fidelity comparison failed. Try again.",
      "vision_failed"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FidelityError(
      "Fidelity comparison returned an invalid response. Try again.",
      "bad_ai_response"
    );
  }

  if (!isFidelityReport(parsed)) {
    throw new FidelityError(
      "Fidelity comparison returned an invalid response. Try again.",
      "bad_ai_response"
    );
  }

  // Defense in depth: enforce decline-first invariants the model may try to bend.
  const report = parsed;
  if (
    report.ai_looking ||
    report.text_or_pattern_drift ||
    report.invented_or_missing_details ||
    report.collage_or_duplicate_product ||
    !report.full_product_visible ||
    report.fidelity_score < 7.5 ||
    report.authenticity_score < 7.5
  ) {
    report.publishable = false;
  }
  return report;
}

/**
 * Conservative delivery gate. Returns true only when every trust criterion holds.
 * Used alongside the canonical audit overall_score >= 8.0 check.
 */
export function passesDeliveryGate(args: {
  fidelity: FidelityReport;
  candidateScore: number;
}): boolean {
  if (!args.fidelity.publishable) return false;
  if (args.fidelity.ai_looking) return false;
  if (args.fidelity.text_or_pattern_drift) return false;
  if (args.fidelity.invented_or_missing_details) return false;
  if (args.fidelity.collage_or_duplicate_product) return false;
  if (!args.fidelity.full_product_visible) return false;
  if (args.fidelity.fidelity_score < 7.5) return false;
  if (args.fidelity.authenticity_score < 7.5) return false;
  if (args.candidateScore < 8.0) return false;
  return true;
}
