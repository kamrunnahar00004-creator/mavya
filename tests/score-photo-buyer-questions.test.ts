import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogForCategory,
  type QuestionCatalog,
} from "@/data/buyer-questions";
import { INVALID_RESPONSE, isRubricJson, type RubricJson } from "@/lib/rubric";
import { scorePhoto, ScorePhotoError } from "@/lib/score-photo";

vi.mock("@/lib/openai", () => ({
  visionScoreCall: vi.fn(),
  checklistCall: vi.fn(),
}));

import { visionScoreCall } from "@/lib/openai";

const mockVisionScoreCall = vi.mocked(visionScoreCall);

function response(
  catalog: QuestionCatalog,
  ids: string[],
  overrides: Partial<RubricJson> = {}
): string {
  return JSON.stringify({
    ...INVALID_RESPONSE,
    upload_kind: "physical_product",
    detected_category: catalog.category,
    checklist_category: catalog.category,
    product_summary: "test product",
    overall_score: 6,
    pillars: { thumbnail: 6, lighting: 6, background: 6, click_appeal: 6 },
    generation_risk: "standard",
    generation_risk_reason: "",
    answers_question_ids: ids,
    ...overrides,
  });
}

describe("scorePhoto buyer-question contract", () => {
  const jewelry = catalogForCategory("jewelry")!;
  const candles = catalogForCategory("candles")!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("repairs one cross-category response, then stamps the validated catalog", async () => {
    mockVisionScoreCall
      .mockResolvedValueOnce(response(jewelry, [candles.questions[0].id]))
      .mockResolvedValueOnce(response(jewelry, [jewelry.questions[0].id]));

    const result = await scorePhoto({
      imageBuffer: Buffer.from("image"),
      imageMimeType: "image/jpeg",
      buyerQuestions: { kind: "all" },
    });

    expect(mockVisionScoreCall).toHaveBeenCalledTimes(2);
    expect(result.answers_question_ids).toEqual([jewelry.questions[0].id]);
    expect(result.question_catalog_category).toBe("jewelry");
    expect(result.question_catalog_version).toBe(jewelry.version);
    expect(mockVisionScoreCall.mock.calls[1][0].systemPrompt).toContain(
      "STRICT OUTPUT REPAIR"
    );
  });

  it("rejects a duplicate id after the single controlled repair retry", async () => {
    const duplicate = [jewelry.questions[0].id, jewelry.questions[0].id];
    mockVisionScoreCall
      .mockResolvedValueOnce(response(jewelry, duplicate))
      .mockResolvedValueOnce(response(jewelry, duplicate));

    await expect(
      scorePhoto({
        imageBuffer: Buffer.from("image"),
        imageMimeType: "image/jpeg",
        buyerQuestions: { kind: "all" },
      })
    ).rejects.toMatchObject({ code: "bad_ai_response" } satisfies Partial<ScorePhotoError>);
    expect(mockVisionScoreCall).toHaveBeenCalledTimes(2);
  });

  it("requires no buyer-question ids when the feature is disabled", async () => {
    mockVisionScoreCall
      .mockResolvedValueOnce(response(jewelry, [jewelry.questions[0].id]))
      .mockResolvedValueOnce(response(jewelry, [jewelry.questions[0].id]));

    await expect(
      scorePhoto({
        imageBuffer: Buffer.from("image"),
        imageMimeType: "image/jpeg",
        buyerQuestions: { kind: "none" },
      })
    ).rejects.toMatchObject({ code: "bad_ai_response" });
  });

  it("normalizes invalid uploads to empty coverage without catalog stamps", async () => {
    mockVisionScoreCall.mockResolvedValueOnce(
      JSON.stringify({
        ...INVALID_RESPONSE,
        answers_question_ids: [jewelry.questions[0].id],
      })
    );

    const result = await scorePhoto({
      imageBuffer: Buffer.from("image"),
      imageMimeType: "image/jpeg",
      buyerQuestions: { kind: "all" },
    });

    expect(result.upload_kind).toBe("invalid");
    expect(result.answers_question_ids).toEqual([]);
    expect(result.question_catalog_category).toBeUndefined();
    expect(result.question_catalog_version).toBeUndefined();
  });

  it("keeps legacy persisted rubrics readable when the new field is absent", () => {
    const legacy = { ...JSON.parse(response(jewelry, [])) };
    delete legacy.answers_question_ids;
    expect(isRubricJson(legacy)).toBe(true);
  });
});
