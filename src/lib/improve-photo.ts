/**
 * Publish-ready outcome gate for Mavya.
 *
 * Single targeted attempt per request:
 *
 *   targeted generation (base + category + crop_suggestion + light_adjustment
 *     + priority fixes)
 *   -> canonical re-score AND fidelity comparison in parallel
 *   -> if (delivered): return
 *   -> else candidate-specific deterministic finish using the CANDIDATE audit's
 *      own light_adjustment (then re-verified)
 *      -> re-score AND fidelity in parallel
 *      -> if (delivered): return
 *   -> else structured failure with unresolved issues for a user-triggered retry
 *
 * The scoring rubric is never changed and never inflated. A generated photo is
 * delivered only when it honestly scores >= 8.0, the original diagnosed issue is
 * resolved, and every fidelity/authenticity trust check passes. A retry runs one
 * new targeted generation using the unresolved issues from the failed candidate.
 *
 * Show only delivered results. Intermediate failed candidates are never exposed.
 */

import { scorePhoto } from "@/lib/score-photo";
import {
  evaluateFidelity,
  passesDeliveryGate,
  type FidelityReport,
} from "@/lib/fidelity";
import { imageEditCall } from "@/lib/openai";
import type { RubricJson } from "@/lib/rubric";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import sharp from "sharp";

/** "main" grades by the hero/thumbnail rubric; "extra" by the supporting rubric. */
export type ImproveMode = "main" | "extra";

const SUPPORT_PHOTO_PATTERN =
  /\b(separate|additional|second)\s+(photo|image|shot)\b|\b(add|include|take|shoot|photograph)\b.*\b(scale|size|macro|close-?up|detail|packaging|gift|in-?hand|context|lifestyle|angle)\b.*\b(photo|image|shot)?\b/i;

type TargetedFix = { action: string; reason?: string };

function isSupportPhotoSuggestion(fix: TargetedFix): boolean {
  return SUPPORT_PHOTO_PATTERN.test(`${fix.action} ${fix.reason ?? ""}`);
}

/**
 * Classify a fix into an issue family so the generation prompt does not receive
 * the same problem three ways (e.g. three lighting fixes). Unmatched fixes get a
 * unique key so genuinely distinct advice is never merged.
 */
function fixFamily(text: string): string {
  const t = text.toLowerCase();
  if (/\b(light|lighting|glare|shadow|exposure|bright|dim|dark|hotspot)\b/.test(t))
    return "lighting";
  if (
    /\b(background|backdrop|surface|clutter|dirty|stain|wrinkl|lint|grim|distract|faucet|sink|appliance|fixture|prop|setting|scene|messy|table|counter|floor|bed)\b/.test(
      t
    )
  )
    return "background";
  if (/\b(crop|fill|frame|center|compos|angle|reposition|tighter|pulled)\b/.test(t))
    return "framing";
  if (/\b(ai|mockup|template|fake|composite|cheap|trust|authentic|render|warp)\b/.test(t))
    return "trust";
  if (/\b(blur|sharp|focus|detail|readab|clarity|crisp|texture)\b/.test(t))
    return "clarity";
  return `other:${t.slice(0, 24)}`;
}

function dedupeFixesByFamily(fixes: TargetedFix[]): TargetedFix[] {
  const seen = new Set<string>();
  const out: TargetedFix[] = [];
  for (const f of fixes) {
    const fam = fixFamily(`${f.action} ${f.reason ?? ""}`);
    if (seen.has(fam)) continue;
    seen.add(fam);
    out.push(f);
  }
  return out;
}

const RESTRAINED_PROMPT = `Edit the attached product photo into a restrained but more professional Etsy hero photo. Make it look like a real product photographer retook the same physical item. Keep natural perspective and realistic lens feel. Use a slightly better angle only when it does not hide, invent, or alter product details.

Cleanliness requirements: remove visible hair, lint, dust, grime, debris, stains, dirty-looking marks, distracting clutter, and background mess. Keep real handmade texture and material detail visible, but make the product clean and gift-ready.

Preserve product identity aggressively: same product type, same shape, materials, colors, label, design, pattern, edges, proportions, included pieces, and distinctive details. Do not redesign the product, invent decorations, or make a different item.

Label and pattern protection is strict: preserve every visible label word exactly as shown in the source photo. Preserve typography, brand name, small label artwork, packaging text, and distinctive patterns faithfully. If any source text is unclear, keep it visually unchanged and unclear rather than guessing or replacing it. Do not invent text, rewrite text, replace label artwork, or clean away printed details.

PRODUCT FIDELITY — STRICT: Preserve the product itself exactly. Keep the same object, shape, proportions, colors, materials, visible label/text/design, pattern, packaging if part of the product, count, bundle pieces, and included accessories. Do not invent, redesign, relabel, warp, remove, or hide product details. Preserve the original framing intent: if the source shows the full product, keep the full product visible with comparable margin; if the source is an intentional macro/detail shot, keep that detail-shot intent without inventing missing context. Never crop tighter than the source in a way that cuts off product parts, removes square-crop margin the source had, or hides details the source showed. For mugs, teacups, and cup candles, if the source shows the cup body, rim, handle, or saucer, keep those same parts visible with comparable margin.

SCENE / BACKGROUND — FLEXIBLE WHEN THE AUDIT FLAGS IT: The surrounding scene is not sacred. If the audit identifies background distraction, clutter, an awkward setting, a dirty surface, a low-trust scene, or non-product objects competing with the product, you MAY remove or replace those scene elements. You may place the product on a clean, simple, realistic surface with natural contact shadow. You may remove distracting non-product objects such as faucets, sinks, appliances, fixtures, furniture, tools, random props, clutter, messy bedding, floors, shelves, or hands when they are not part of the product or a useful scale reference.

Scene-cleanup safeguards:
- Remove only objects clearly NOT part of the product or the sold set. Do not remove included accessories, bundle pieces, lids, dishes, stands, or packaging that appear to be part of what is sold.
- Do not remove intentional scale references (coin, ruler, clean hand) when they are clean, useful, and not hiding the product.
- Do not strip clean intentional styling. A candle on a clean tray, jewelry on clean linen/velvet/wood, or soap on clean styled fabric can remain when it supports the product. Only perform aggressive scene cleanup when the audit actually flags background/scene distraction.
- For transparent or reflective products, keep the product's contents, reflections, refractions, and visible material behavior consistent. Do not change what appears inside or on the product in a way that looks like product drift.
- If the product was leaning on a removed object, reposition it naturally so it rests on a clean surface with believable contact shadow. No floating product, no impossible physics.
- Keep the result realistic, not a synthetic catalog render.

Category notes: soap/skincare/candles — sinks, faucets, bathrooms, dirty counters, grimy tile, and kitchen/toilet/shower fixtures hurt trust; prefer a clean dry product surface, preserve label/container/wax. Jewelry — clean linen, velvet, wood, acrylic, jewelry cards are fine; dirty/wrinkled/linty cloth is not. Mugs — preserve design/text/handle/rim; remove appliances/clutter/loud template graphics if flagged; do not add coffee/props unless requested. Plush/crochet — clean soft fabric is fine; messy/linty bed or floor is not; preserve face/stitches/proportions.

Lighting: soft natural window light, gentle real shadows, clean white balance, no harsh flash, no dirty grey cast.

Style: believable professional product photography for Etsy, natural and restrained, not an AI-generated catalog render. The result should be a faithful professional retake of this product, not a redesigned version. The output must not look synthetic, rendered, or catalog-glossy.

Avoid: invented or melted text, warped patterns, fake bokeh, extra props, hands, obvious synthetic lighting, duplicated product, collage layouts, and cropped or hidden product details.`;

function categoryGuidance(category: RubricJson["detected_category"]): string {
  switch (category) {
    case "candles":
      return "For this candle, preserve the jar, label, wax, wick, and flame. Use a restrained backdrop with enough contrast for the container silhouette and label to read clearly. Product-only presentation. Do not add lifestyle props.";
    case "soap":
      return "For this soap, preserve the bar shape, texture, packaging, and handmade surface. Use a clean neutral surface without smoothing away real material detail. Product-only presentation. Do not add lifestyle props.";
    case "mugs":
      return "For this mug, preserve the handle, rim, proportions, printed design, and glaze. Use an angle that keeps the full design readable. Product-only presentation. Do not add coffee, hands, or lifestyle props unless explicitly requested.";
    case "crochet_plush":
      return "For this crochet or plush product, preserve stitch pattern, seams, proportions, face details, and every included piece. Keep soft texture visible without inventing fibers or accessories. Product-only presentation. Do not add hands, models, or extra pieces.";
    case "jewelry":
      return "For this jewelry product, preserve stone count, settings, metal color, shape, proportions, clasp, both ends of the piece, and arrangement exactly. Do not invent sparkle, stones, or engraving. Product-only presentation by default; only a clean model-worn close-up is acceptable when it clearly improves comprehension and preserves every original detail.";
    default:
      return "Preserve every visible product-specific detail exactly. Use a clean product-first composition without redesigning the item. Product-only presentation. Do not add people, hands, props, or lifestyle scenes.";
  }
}

/**
 * Translate the audit's normalized crop_suggestion into a concrete composition
 * instruction for the generation model. The audit returns the region of the
 * frame the product should occupy; convert that into "fill roughly N% of the
 * square" guidance while always demanding the complete product stays visible.
 */
function describeCropInstruction(
  crop: RubricJson["crop_suggestion"]
): string | null {
  if (!crop) return null;
  const width = Math.round(crop.w * 100);
  const height = Math.round(crop.h * 100);
  if (width <= 0 || height <= 0) return null;
  return `Composition target: use a gentle recompose comparable to retaining roughly ${width}% of the current frame width and ${height}% of its height. Apply this only when it keeps every product part the source showed with comparable margin. Never crop tighter than the source in a way that cuts off, hides, or removes product context.`;
}

/**
 * Translate the audit's normalized light_adjustment into a concrete lighting
 * instruction. Values are -1..1. Only emit guidance for meaningful adjustments.
 */
function describeLightInstruction(
  light: RubricJson["light_adjustment"]
): string | null {
  if (!light) return null;
  const parts: string[] = [];
  if (light.exposure >= 0.15) {
    parts.push(
      light.exposure >= 0.5
        ? "brighten the product noticeably so detail and color read clearly"
        : "brighten the product moderately so detail and color read clearly"
    );
  } else if (light.exposure <= -0.15) {
    parts.push("reduce blown highlights and recover detail in bright areas");
  }
  if (light.warmth >= 0.15) {
    parts.push("warm the white balance slightly for a natural tone");
  } else if (light.warmth <= -0.15) {
    parts.push("cool the white balance slightly to remove a yellow cast");
  }
  if (parts.length === 0) return null;
  return `Lighting target: ${parts.join(", ")}. Keep it realistic with soft natural light and no harsh flash.`;
}

function buildTargetedPrompt(
  audit: RubricJson,
  extraConstraints: string[] = [],
  mode: ImproveMode = "main",
  source: "original" | "improved_preview" = "original"
): string {
  const isExtra = mode === "extra";
  // Pass each fix as Action + Reason so the generator resolves the actual
  // diagnosed problem (e.g. "the faucet makes it a kitchen snapshot"), not just
  // the short action line. Support-photo suggestions are filtered out, and the
  // top fixes are deduped by issue family so one problem is not sent three ways.
  const fixes = dedupeFixesByFamily(
    [
      { action: audit.priority_action, reason: audit.priority_explanation },
      ...audit.next_steps.map((step) => ({
        action: step.action,
        reason: step.observation,
      })),
    ].filter((f) => f.action && !isSupportPhotoSuggestion(f))
  );

  const problemLabel = isExtra
    ? "supporting product photo"
    : "hero photo";
  const fixesBlock = fixes.length
    ? `The original audit identified these ${problemLabel} problems. Resolve the actual problem described in each reason, not just the short action:\n${fixes
        .map((f) => `- Action: ${f.action}\n  Reason: ${f.reason ?? ""}`)
        .join("\n")}`
    : `The original audit did not identify a ${problemLabel} edit. Keep the product faithful and make only restrained professional improvements.`;

  const cropInstruction = describeCropInstruction(audit.crop_suggestion);
  const lightInstruction = describeLightInstruction(audit.light_adjustment);

  const extras = extraConstraints.length
    ? `The previous attempt failed these checks. They MUST be resolved this time:\n${extraConstraints
        .map((c) => `- ${c}`)
        .join("\n")}`
    : "";

  const retryInstruction =
    source === "improved_preview"
      ? `This image is already an improved version of the product. Preserve everything that is already correct: product identity, shape, colors, label text, patterns, realistic lighting, clean background, and the parts that already look good. Do not redraw the product. Fix only the remaining issues identified below. Preserve the original framing intent. If the previous attempt cropped tighter than the original, cut off an edge, or lost product context the original showed, zoom out and restore that visible product area with enough margin for Etsy square crop. If the original was an intentional macro/detail shot, keep the macro intent and improve only light, clarity, cleanliness, and trust.`
      : "";

  const objective = isExtra
    ? `Quality objective: make a genuinely clearer, more trustworthy SUPPORTING listing photo — better clarity, lighting, background, and product proof — with the complete physical product clearly visible and authentic. This is NOT a search thumbnail; it does not need hero framing. Do not fabricate quality or sacrifice product identity. If preservation and polish conflict, preserve the physical product faithfully.`
    : `Quality objective: make the improved hero image genuinely listing-ready, with the complete physical product clearly visible, authentic in appearance, and strong enough to earn an honest 8+ audit score on thumbnail clarity, lighting, background, and click appeal. Do not fabricate quality or sacrifice product identity to reach that target. If preservation and polish conflict, preserve the physical product faithfully.`;

  return [
    RESTRAINED_PROMPT,
    categoryGuidance(audit.detected_category),
    fixesBlock,
    cropInstruction,
    lightInstruction,
    extras,
    retryInstruction,
    objective,
  ]
    .filter((block): block is string =>
      typeof block === "string" && block.length > 0
    )
    .join("\n\n");
}

/**
 * Honest "dominant issue resolved" proxy. Until the rubric returns an explicit
 * priority pillar, require the weakest original pillar (including ties) to reach
 * at least 7 in the candidate. The scores themselves are never altered.
 */
function dominantIssueResolved(
  original: RubricJson,
  candidate: RubricJson
): boolean {
  const keys = ["thumbnail", "lighting", "background", "click_appeal"] as const;
  const weakestScore = Math.min(...keys.map((key) => original.pillars[key]));
  for (const key of keys) {
    if (
      original.pillars[key] === weakestScore &&
      candidate.pillars[key] < 7
    ) {
      return false;
    }
  }
  return true;
}

function delivered(args: {
  original: RubricJson;
  candidateAudit: RubricJson;
  fidelity: FidelityReport;
}): boolean {
  return (
    passesDeliveryGate({
      fidelity: args.fidelity,
      candidateScore: args.candidateAudit.overall_score,
    }) && dominantIssueResolved(args.original, args.candidateAudit)
  );
}

/**
 * Candidate-specific deterministic finish. Uses only the CANDIDATE audit's own
 * light_adjustment. Cropping is intentionally skipped here: a local crop cannot
 * restore clipped product or square-crop margin, and it can manufacture the exact
 * too-tight framing failure the fidelity gate is trying to catch.
 */
async function applyCandidateFinish(
  candidateBase64: string,
  candidateAudit: RubricJson
): Promise<string> {
  const light = candidateAudit.light_adjustment;

  let pipeline = sharp(Buffer.from(candidateBase64, "base64"));
  let changed = false;

  // Gentle exposure/warmth only when the candidate audit asks for it.
  if (light) {
    if (light.exposure >= 0.15) {
      const brightness = 1 + Math.min(0.08, light.exposure * 0.12);
      pipeline = pipeline.modulate({ brightness });
      changed = true;
    } else if (light.exposure <= -0.15) {
      const brightness = 1 - Math.min(0.08, Math.abs(light.exposure) * 0.12);
      pipeline = pipeline.modulate({ brightness });
      changed = true;
    }
    if (Math.abs(light.warmth) >= 0.15) {
      // Warmth: nudge red up / blue down for positive, opposite for negative.
      const shift = Math.min(8, Math.abs(light.warmth) * 10);
      const r = light.warmth > 0 ? shift : -shift;
      const b = light.warmth > 0 ? -shift : shift;
      pipeline = pipeline.linear([1, 1, 1], [r, 0, b]);
      changed = true;
    }
  }

  if (!changed) return candidateBase64;

  const finished = await pipeline.png().toBuffer();
  return finished.toString("base64");
}

async function scoreAndFidelity(args: {
  originalBuffer: Buffer;
  originalMimeType: "image/png" | "image/jpeg";
  candidateBase64: string;
  systemPrompt?: string;
}): Promise<{ candidateAudit: RubricJson; fidelity: FidelityReport }> {
  const candidateBuffer = Buffer.from(args.candidateBase64, "base64");
  const [candidateAudit, fidelity] = await Promise.all([
    scorePhoto({
      imageBuffer: candidateBuffer,
      imageMimeType: "image/png",
      systemPrompt: args.systemPrompt,
    }),
    evaluateFidelity({
      originalBuffer: args.originalBuffer,
      originalMimeType: args.originalMimeType,
      candidateBase64: args.candidateBase64,
      candidateMimeType: "image/png",
    }),
  ]);
  return { candidateAudit, fidelity };
}

export type AttemptRecord = {
  attempt: number;
  stage: "generation" | "deterministic_finish";
  candidateScore: number;
  fidelityScore: number;
  authenticityScore: number;
  publishable: boolean;
  priorityResolved: boolean;
  reason: string;
  recommendedNextAction: FidelityReport["recommended_next_action"];
};

/**
 * Delivered result. `publish_ready` is the honest 8+ paid-outcome class.
 * `useful_free_preview` is a safe improvement shown free when it does not satisfy
 * every publish-ready check. The image is safe to render and its score is honest.
 */
export type ImproveSuccess = {
  ok: true;
  outcome: "publish_ready" | "useful_free_preview";
  imageBase64: string;
  mimeType: "image/png";
  candidateAudit: RubricJson;
  fidelity: FidelityReport;
  attempts: AttemptRecord[];
};

export type ImproveFailure = {
  ok: false;
  /** `unsafe_candidate` = a hard trust failure; image is never returned. */
  code:
    | "unsafe_candidate"
    | "no_publishable_candidate"
    | "incomplete_source"
    | "vision_failed"
    | "image_failed"
    | "bad_ai_response";
  message: string;
  /** Unresolved issues from the failed candidate, used to target a retry. */
  unresolvedIssues: string[];
  attempts: AttemptRecord[];
};

export type ImproveResult = ImproveSuccess | ImproveFailure;

const FAILURE_QUALITY =
  "This version did not reach publish-ready quality, so we did not deliver it. Generate another version or try a different source photo.";
const FAILURE_SUPPORTING_QUALITY =
  "This version did not become a strong supporting photo, so we did not deliver it. Generate another version or try a different source photo.";
const FAILURE_INCOMPLETE =
  "We could not create a publish-ready result. Upload one photo showing the complete product.";
const FAILURE_SUPPORTING_INCOMPLETE =
  "We could not create a strong supporting photo from this source. Upload one photo showing the complete product.";
const FAILURE_AI_LOOKING =
  "This version looked too artificial, so we did not deliver it. Generate another version or try a different source photo.";
const FAILURE_DETAIL_DRIFT =
  "This version changed important product details, so we did not deliver it. Generate another version or try a different source photo.";
const FAILURE_INCOMPLETE_RESULT =
  "This version did not show the complete product, so we did not deliver it. Generate another version or try a different source photo.";

/**
 * A safe candidate is worth showing free when it has no hard trust failure, is a
 * genuine improvement over the original, and the product stays complete and
 * recognizable, even if it misses a publish-ready check. Scores are never altered.
 */
const USEFUL_PREVIEW_MIN_GAIN = 0.3;
// Lowered 6 -> 5: deliver moderate-drift previews on clear real products instead
// of hard-rejecting them. The "patterns may differ" warning + seller review is the
// safeguard. Authenticity floor stays 6 so AI-looking results still cannot pass.
const USEFUL_PREVIEW_MIN_FIDELITY = 5;
const USEFUL_PREVIEW_MIN_AUTHENTICITY = 6;

function hasHardTrustFailure(fidelity: FidelityReport): boolean {
  return (
    fidelity.ai_looking ||
    fidelity.text_or_pattern_drift ||
    fidelity.invented_or_missing_details ||
    fidelity.collage_or_duplicate_product ||
    !fidelity.full_product_visible
  );
}

/**
 * Blocks for the FREE-PREVIEW path only. Softer than hasHardTrustFailure: it does
 * NOT auto-reject text/pattern/detail drift. Minor polish drift on a clear real
 * product should deliver as a labeled "patterns may differ — review before
 * publishing" preview, gated by the graded fidelity_score below (which still
 * rejects SEVERE drift). Only unambiguously broken results hard-block here:
 * AI-looking, collage/duplicate, or an incomplete product.
 */
function blocksFreePreview(fidelity: FidelityReport): boolean {
  return (
    fidelity.ai_looking ||
    fidelity.collage_or_duplicate_product ||
    !fidelity.full_product_visible
  );
}

function unsafeMessage(fidelity: FidelityReport): string {
  if (fidelity.ai_looking) return FAILURE_AI_LOOKING;
  if (fidelity.text_or_pattern_drift || fidelity.invented_or_missing_details) {
    return FAILURE_DETAIL_DRIFT;
  }
  if (!fidelity.full_product_visible || fidelity.collage_or_duplicate_product) {
    return FAILURE_INCOMPLETE_RESULT;
  }
  return FAILURE_QUALITY;
}

function qualityFailureMessage(mode: ImproveMode): string {
  return mode === "extra" ? FAILURE_SUPPORTING_QUALITY : FAILURE_QUALITY;
}

function incompleteFailureMessage(mode: ImproveMode): string {
  return mode === "extra" ? FAILURE_SUPPORTING_INCOMPLETE : FAILURE_INCOMPLETE;
}

function isUsefulFreePreview(args: {
  original: RubricJson;
  candidateAudit: RubricJson;
  fidelity: FidelityReport;
}): boolean {
  if (blocksFreePreview(args.fidelity)) return false;
  if (
    args.candidateAudit.overall_score <
    args.original.overall_score + USEFUL_PREVIEW_MIN_GAIN
  ) {
    return false;
  }
  if (args.fidelity.fidelity_score < USEFUL_PREVIEW_MIN_FIDELITY) return false;
  if (args.fidelity.authenticity_score < USEFUL_PREVIEW_MIN_AUTHENTICITY) {
    return false;
  }
  return true;
}

/**
 * Server-defined remediation phrases accepted by a user-triggered retry. The
 * browser round-trip is untrusted, so retry prompt text must match this allowlist.
 */
const RETRY_CONSTRAINTS = {
  aiLooking:
    "The previous attempt looked AI-generated. Produce a believable real product photo, not a synthetic render.",
  textDrift:
    "The previous attempt altered visible label text or distinctive patterns. Preserve every word and pattern exactly.",
  detailDrift:
    "The previous attempt invented or removed product details. Keep the physical product identical: same shape, parts, decorations, included pieces.",
  duplicate:
    "The previous attempt produced a collage or duplicated the product. Render exactly one product instance in a clean single composition.",
  incomplete:
    "The previous attempt did not show the complete product. Include the entire item end to end, with all included pieces visible.",
  thumbnail:
    "Improve thumbnail clarity. Keep the complete product visible, centered, and large enough to understand immediately.",
  lighting:
    "Improve the lighting. Use soft natural light with accurate color and clearly visible product detail.",
  background:
    "Improve the background. Use a clean, simple backdrop with clear separation from the product.",
  clickAppeal:
    "Improve click appeal without redesigning the product. Make the photo believable, clean, and product-first.",
} as const;

const RETRY_CONSTRAINT_ALLOWLIST = new Set<string>(
  Object.values(RETRY_CONSTRAINTS)
);

export function sanitizeRetryConstraints(items: string[]): string[] {
  return items.filter((item) => RETRY_CONSTRAINT_ALLOWLIST.has(item)).slice(0, 8);
}

/**
 * Collect safe, server-defined unresolved issues from a failed candidate so a
 * retry can target its most important defects without trusting model prose.
 */
export function unresolvedIssuesForRetry(
  report: FidelityReport,
  candidateAudit: RubricJson
): string[] {
  const issues: string[] = [];
  if (report.ai_looking) {
    issues.push(RETRY_CONSTRAINTS.aiLooking);
  }
  if (report.text_or_pattern_drift) {
    issues.push(RETRY_CONSTRAINTS.textDrift);
  }
  if (report.invented_or_missing_details) {
    issues.push(RETRY_CONSTRAINTS.detailDrift);
  }
  if (report.collage_or_duplicate_product) {
    issues.push(RETRY_CONSTRAINTS.duplicate);
  }
  if (!report.full_product_visible) {
    issues.push(RETRY_CONSTRAINTS.incomplete);
  }

  const keys = ["thumbnail", "lighting", "background", "click_appeal"] as const;
  const weakestScore = Math.min(...keys.map((key) => candidateAudit.pillars[key]));
  for (const key of keys) {
    if (candidateAudit.pillars[key] !== weakestScore) continue;
    if (key === "thumbnail") issues.push(RETRY_CONSTRAINTS.thumbnail);
    if (key === "lighting") issues.push(RETRY_CONSTRAINTS.lighting);
    if (key === "background") issues.push(RETRY_CONSTRAINTS.background);
    if (key === "click_appeal") issues.push(RETRY_CONSTRAINTS.clickAppeal);
  }
  return [...new Set(issues)];
}

/**
 * One targeted attempt: generate, verify, optional candidate-specific finish,
 * verify again. No automatic second generation. Pass `extraConstraints` (from a
 * prior failed candidate) to target a user-triggered retry.
 */
export async function improvePhoto(args: {
  originalBuffer: Buffer;
  originalMimeType: "image/png" | "image/jpeg";
  originalAudit: RubricJson;
  /** Optional edit base. Retries can start from the current preview, while fidelity still compares to the original. */
  baseBuffer?: Buffer;
  baseMimeType?: "image/png" | "image/jpeg";
  /** Optional audit of the edit base, used so retries target remaining issues in the current preview. */
  promptAudit?: RubricJson;
  extraConstraints?: string[];
  mode?: ImproveMode;
}): Promise<ImproveResult> {
  const attempts: AttemptRecord[] = [];
  const mode: ImproveMode = args.mode ?? "main";
  // Supporting photos are re-scored by the general rubric, not the hero rubric.
  const systemPrompt = mode === "extra" ? GENERAL_RUBRIC_PROMPT : undefined;
  const editBuffer = args.baseBuffer ?? args.originalBuffer;
  const editMimeType = args.baseMimeType ?? args.originalMimeType;
  const promptAudit = args.promptAudit ?? args.originalAudit;
  const promptSource = args.baseBuffer ? "improved_preview" : "original";

  // 1. Targeted generation.
  let candidateBase64: string;
  try {
    candidateBase64 = await imageEditCall({
      imageBuffer: editBuffer,
      imageMimeType: editMimeType,
      prompt: buildTargetedPrompt(
        promptAudit,
        args.extraConstraints,
        mode,
        promptSource
      ),
      size: "1024x1024",
    });
  } catch (err) {
    console.error("[improve-photo] image edit failed:", err);
    return {
      ok: false,
      code: "image_failed",
      message: "AI generation failed. Try again.",
      unresolvedIssues: [],
      attempts,
    };
  }

  // 2. Re-score + fidelity in parallel.
  let candidateAudit: RubricJson;
  let fidelity: FidelityReport;
  try {
    ({ candidateAudit, fidelity } = await scoreAndFidelity({
      originalBuffer: args.originalBuffer,
      originalMimeType: args.originalMimeType,
      candidateBase64,
      systemPrompt,
    }));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI verification failed. Try again.";
    console.error("[improve-photo] score/fidelity failed:", err);
    return {
      ok: false,
      code: "vision_failed",
      message,
      unresolvedIssues: [],
      attempts,
    };
  }

  attempts.push({
    attempt: 1,
    stage: "generation",
    candidateScore: candidateAudit.overall_score,
    fidelityScore: fidelity.fidelity_score,
    authenticityScore: fidelity.authenticity_score,
    publishable: fidelity.publishable,
    priorityResolved: dominantIssueResolved(args.originalAudit, candidateAudit),
    reason: fidelity.reason,
    recommendedNextAction: fidelity.recommended_next_action,
  });

  // Track the image that matches the current candidateAudit/fidelity. The
  // deterministic finish may replace it; keep them in lockstep so a delivered
  // or free-preview result never returns a mismatched image.
  let deliverableBase64 = candidateBase64;

  if (delivered({ original: args.originalAudit, candidateAudit, fidelity })) {
    return {
      ok: true,
      outcome: "publish_ready",
      imageBase64: deliverableBase64,
      mimeType: "image/png",
      candidateAudit,
      fidelity,
      attempts,
    };
  }

  // 3. Candidate-specific deterministic finish, only when fidelity is sound but
  //    the canonical score sits just under the gate. Never run a finish over an
  //    already-untrustworthy candidate.
  const finishWorthTrying =
    fidelity.publishable &&
    !fidelity.ai_looking &&
    !fidelity.text_or_pattern_drift &&
    !fidelity.invented_or_missing_details &&
    !fidelity.collage_or_duplicate_product &&
    fidelity.full_product_visible &&
    candidateAudit.overall_score < 8;

  if (finishWorthTrying) {
    try {
      const finishedBase64 = await applyCandidateFinish(
        candidateBase64,
        candidateAudit
      );
      if (finishedBase64 !== candidateBase64) {
        const finished = await scoreAndFidelity({
          originalBuffer: args.originalBuffer,
          originalMimeType: args.originalMimeType,
          candidateBase64: finishedBase64,
          systemPrompt,
        });

        attempts.push({
          attempt: 1,
          stage: "deterministic_finish",
          candidateScore: finished.candidateAudit.overall_score,
          fidelityScore: finished.fidelity.fidelity_score,
          authenticityScore: finished.fidelity.authenticity_score,
          publishable: finished.fidelity.publishable,
          priorityResolved: dominantIssueResolved(
            args.originalAudit,
            finished.candidateAudit
          ),
          reason: finished.fidelity.reason,
          recommendedNextAction: finished.fidelity.recommended_next_action,
        });

        if (
          delivered({
            original: args.originalAudit,
            candidateAudit: finished.candidateAudit,
            fidelity: finished.fidelity,
          })
        ) {
          return {
            ok: true,
            outcome: "publish_ready",
            imageBase64: finishedBase64,
            mimeType: "image/png",
            candidateAudit: finished.candidateAudit,
            fidelity: finished.fidelity,
            attempts,
          };
        }
        // Finish did not clear the gate; fall through using the finished verdict
        // and its matching image for the free-preview / failure classification.
        candidateAudit = finished.candidateAudit;
        fidelity = finished.fidelity;
        deliverableBase64 = finishedBase64;
      }
    } catch (err) {
      // Finishing is an optimization. A local processing failure must not block
      // an honest failure response.
      console.error("[improve-photo] candidate finish failed:", err);
    }
  }

  // 4. Not publish-ready. Classify the outcome. Order matters: a genuinely
  //    incomplete original is its own message; hard trust failures never return
  //    an image; a safe, genuine sub-8 improvement is shown free; otherwise the
  //    candidate simply did not improve enough.
  if (fidelity.recommended_next_action === "request_clearer_source") {
    return {
      ok: false,
      code: "incomplete_source",
      message: incompleteFailureMessage(mode),
      unresolvedIssues: unresolvedIssuesForRetry(fidelity, candidateAudit),
      attempts,
    };
  }

  if (
    isUsefulFreePreview({
      original: args.originalAudit,
      candidateAudit,
      fidelity,
    })
  ) {
    return {
      ok: true,
      outcome: "useful_free_preview",
      imageBase64: deliverableBase64,
      mimeType: "image/png",
      candidateAudit,
      fidelity,
      attempts,
    };
  }

  if (hasHardTrustFailure(fidelity)) {
    return {
      ok: false,
      code: "unsafe_candidate",
      message: unsafeMessage(fidelity),
      unresolvedIssues: unresolvedIssuesForRetry(fidelity, candidateAudit),
      attempts,
    };
  }

  return {
    ok: false,
    code: "no_publishable_candidate",
    message: qualityFailureMessage(mode),
    unresolvedIssues: unresolvedIssuesForRetry(fidelity, candidateAudit),
    attempts,
  };
}
