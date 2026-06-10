import {
  RUBRIC_PROMPT,
  computeOverall,
  isRubricJson,
  type RubricJson,
} from "@/lib/rubric";
import { visionScoreCall } from "@/lib/openai";

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

  const allZeroPillars =
    parsed.pillars.thumbnail === 0 &&
    parsed.pillars.lighting === 0 &&
    parsed.pillars.background === 0 &&
    parsed.pillars.click_appeal === 0;
  const isInvalid = parsed.detected_category === "other" && allZeroPillars;
  parsed.overall_score = isInvalid ? 0 : computeOverall(parsed.pillars);

  return parsed;
}
