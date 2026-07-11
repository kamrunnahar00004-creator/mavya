import {
  RUBRIC_PROMPT,
  computeOverall,
  computeSupportingOverall,
  isChecklistItem,
  isRubricJson,
  type RubricJson,
  type SupportingPhotoChecklistItem,
} from "@/lib/rubric";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { applyScoreCalibration } from "@/lib/calibration";
import {
  CHECKLIST_PROMPT,
  checklistUserMessage,
  type ChecklistGenInput,
} from "@/lib/checklist-gen";
import { checklistCall, visionScoreCall } from "@/lib/openai";
import { ALL_SHOT_IDS, poolFor } from "@/data/photo-checklist-pool";

export class ScorePhotoError extends Error {
  constructor(message: string, readonly code: "vision_failed" | "bad_ai_response") {
    super(message);
  }
}

/**
 * Generate the supporting-photo checklist in a SEPARATE, text-only call. Runs in
 * the background after the score renders. Returns pool-filtered items valid for
 * this category, or [] on any failure (the checklist is optional; a failure
 * must never block or error the main flow).
 */
export async function generateChecklist(
  input: ChecklistGenInput
): Promise<SupportingPhotoChecklistItem[]> {
  let parsed: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await checklistCall({
        systemPrompt:
          attempt === 0
            ? CHECKLIST_PROMPT
            : CHECKLIST_PROMPT +
              "\n\nSTRICT OUTPUT REPAIR: your previous response failed validation. Return ONLY the exact JSON object. No prose.",
        userMessage: checklistUserMessage(input),
      });
    } catch (error) {
      console.error("[checklist] generation failed:", error);
      return []; // provider failure: best-effort, no retry
    }
    try {
      parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") break;
    } catch {
      parsed = undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as {
    checklist_category?: unknown;
    supporting_photo_checklist?: unknown;
  };
  if (!Array.isArray(obj.supporting_photo_checklist)) return [];

  // Canonical routing: the detected_category from the main audit IS the
  // checklist pool key (one taxonomy). The model's checklist_category is
  // ignored — no second vocabulary, no mapping drift. Unknown ids fall back to
  // the universal pool inside poolFor.
  const allowed = new Set(
    poolFor(input.upload_kind, input.detected_category).map((s) => s.shot_id)
  );
  return obj.supporting_photo_checklist.filter(
    (item): item is SupportingPhotoChecklistItem =>
      isChecklistItem(item) &&
      ALL_SHOT_IDS.has(item.shot_id) &&
      allowed.has(item.shot_id)
  );
}

/** Appended on the single structured-output repair retry. */
const REPAIR_INSTRUCTION =
  "\n\nSTRICT OUTPUT REPAIR: your previous response failed JSON schema validation. Return ONLY the exact JSON object matching the schema. No prose, no markdown, no truncation.";

export async function scorePhoto(args: {
  imageBuffer: Buffer;
  imageMimeType: string;
  /** System prompt to use. Defaults to the main hero/thumbnail rubric. Pass the
   *  general supporting-photo prompt for extra photos. Same JSON contract. */
  systemPrompt?: string;
  /** Descriptive main-listing product (e.g. "pink candle in a glass cup with a
   *  leaf design"). Only used when scoring a SUPPORTING photo, for relevance. */
  mainProductContext?: string;
}): Promise<RubricJson> {
  const dataUrl = `data:${args.imageMimeType};base64,${args.imageBuffer.toString("base64")}`;

  const supporting = args.systemPrompt === GENERAL_RUBRIC_PROMPT;
  const basePrompt = args.systemPrompt ?? RUBRIC_PROMPT;

  // One controlled retry on parse/schema failure with a stricter instruction.
  // Provider/network failures are NOT retried here (route-level policy decides).
  let parsed: RubricJson | undefined;
  let lastFailure: "vision_failed" | "bad_ai_response" = "bad_ai_response";
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await visionScoreCall({
        imageDataUrl: dataUrl,
        systemPrompt: attempt === 0 ? basePrompt : basePrompt + REPAIR_INSTRUCTION,
        // Relevance context is only meaningful for supporting photos.
        mainProductContext: supporting ? args.mainProductContext : undefined,
      });
    } catch (error) {
      console.error("[score-photo] vision call failed:", error);
      lastFailure = "vision_failed";
      break; // do not burn a retry on provider failure
    }

    try {
      const candidate: unknown = JSON.parse(raw);
      if (isRubricJson(candidate)) {
        parsed = candidate;
        if (attempt === 1) {
          console.log(JSON.stringify({ event: "score.repair_retry_succeeded" }));
        }
        break;
      }
    } catch {
      // fall through to retry
    }
    lastFailure = "bad_ai_response";
  }

  if (parsed === undefined) {
    throw new ScorePhotoError(
      lastFailure === "vision_failed"
        ? "AI scoring failed. Try again."
        : "AI scoring returned an invalid response. Try again.",
      lastFailure
    );
  }

  // Invalid is now an explicit model classification (upload_kind), not inferred
  // from "other + all-zero pillars". This stops digital Etsy products (planners,
  // printables, templates) from being treated as non-products.
  // Supporting photos (graded with the general rubric) use their own 35/30/20/15
  // weights; main photos use the locked 40/25/20/15.
  const isInvalid = parsed.upload_kind === "invalid";
  parsed.overall_score = isInvalid
    ? 0
    : supporting
    ? computeSupportingOverall(parsed.pillars)
    : computeOverall(parsed.pillars);

  // Beta calibration LAST: computeOverall already applied the trust ceiling, so
  // a score reduced below 7.5 by authenticity/trust can never be promoted to
  // 8.0. The honest score is preserved in raw_overall_score.
  applyScoreCalibration(parsed);

  // Contradiction detection (not blind trust): the model's declared
  // priority_pillar should normally be the weakest pillar. A mismatch is kept
  // (the model may legitimately target a tied/near-tie pillar) but logged so
  // eval reports can quantify disagreement.
  if (!isInvalid) {
    const weakest = Math.min(
      parsed.pillars.thumbnail,
      parsed.pillars.lighting,
      parsed.pillars.background,
      parsed.pillars.click_appeal
    );
    if (parsed.pillars[parsed.priority_pillar] > weakest + 1) {
      console.log(
        JSON.stringify({
          event: "score.priority_pillar_mismatch",
          declared: parsed.priority_pillar,
          declaredValue: parsed.pillars[parsed.priority_pillar],
          weakest,
        })
      );
    }
  }

  // Checklist safety: invalid uploads carry no checklist. Otherwise keep only shots
  // that are valid for THIS category's pool; a digital planner must not return a
  // physical shot like `lit_glow`, even though that id exists globally.
  if (isInvalid || parsed.upload_kind === "invalid") {
    parsed.supporting_photo_checklist = [];
  } else {
    const allowed = new Set(
      poolFor(parsed.upload_kind, parsed.checklist_category).map((s) => s.shot_id)
    );
    parsed.supporting_photo_checklist = parsed.supporting_photo_checklist.filter(
      (item) => ALL_SHOT_IDS.has(item.shot_id) && allowed.has(item.shot_id)
    );
  }

  return parsed;
}
