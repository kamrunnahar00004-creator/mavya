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
  let raw: string;
  try {
    raw = await checklistCall({
      systemPrompt: CHECKLIST_PROMPT,
      userMessage: checklistUserMessage(input),
    });
  } catch (error) {
    console.error("[checklist] generation failed:", error);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as {
    checklist_category?: unknown;
    supporting_photo_checklist?: unknown;
  };
  const category =
    typeof obj.checklist_category === "string" ? obj.checklist_category : "other";
  if (!Array.isArray(obj.supporting_photo_checklist)) return [];

  const allowed = new Set(
    poolFor(input.upload_kind, category).map((s) => s.shot_id)
  );
  return obj.supporting_photo_checklist.filter(
    (item): item is SupportingPhotoChecklistItem =>
      isChecklistItem(item) &&
      ALL_SHOT_IDS.has(item.shot_id) &&
      allowed.has(item.shot_id)
  );
}

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

  let raw: string;
  try {
    raw = await visionScoreCall({
      imageDataUrl: dataUrl,
      systemPrompt: args.systemPrompt ?? RUBRIC_PROMPT,
      // Relevance context is only meaningful for supporting photos.
      mainProductContext: supporting ? args.mainProductContext : undefined,
    });
  } catch (error) {
    console.error("[score-photo] vision call failed:", error);
    throw new ScorePhotoError("AI scoring failed. Try again.", "vision_failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ScorePhotoError(
      "AI scoring returned an invalid response. Try again.",
      "bad_ai_response"
    );
  }

  if (!isRubricJson(parsed)) {
    throw new ScorePhotoError(
      "AI scoring returned an invalid response. Try again.",
      "bad_ai_response"
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
