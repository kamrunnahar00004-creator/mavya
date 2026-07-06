import {
  RUBRIC_PROMPT,
  computeOverall,
  computeSupportingOverall,
  isRubricJson,
  type RubricJson,
} from "@/lib/rubric";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { visionScoreCall } from "@/lib/openai";
import { ALL_SHOT_IDS, poolFor } from "@/data/photo-checklist-pool";

export class ScorePhotoError extends Error {
  constructor(message: string, readonly code: "vision_failed" | "bad_ai_response") {
    super(message);
  }
}

export async function scorePhoto(args: {
  imageBuffer: Buffer;
  imageMimeType: string;
  /** System prompt to use. Defaults to the main hero/thumbnail rubric. Pass the
   *  general supporting-photo prompt for extra photos. Same JSON contract. */
  systemPrompt?: string;
}): Promise<RubricJson> {
  const dataUrl = `data:${args.imageMimeType};base64,${args.imageBuffer.toString("base64")}`;

  let raw: string;
  try {
    raw = await visionScoreCall({
      imageDataUrl: dataUrl,
      systemPrompt: args.systemPrompt ?? RUBRIC_PROMPT,
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
  const supporting = args.systemPrompt === GENERAL_RUBRIC_PROMPT;
  const isInvalid = parsed.upload_kind === "invalid";
  parsed.overall_score = isInvalid
    ? 0
    : supporting
    ? computeSupportingOverall(parsed.pillars)
    : computeOverall(parsed.pillars);

  // Checklist safety: invalid uploads carry no checklist. Otherwise keep only shots
  // that are valid for THIS category's pool — a digital planner must not return a
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
