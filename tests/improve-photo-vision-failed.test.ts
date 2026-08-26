import { describe, it, expect, vi, beforeEach } from "vitest";
import { improvePhoto } from "@/lib/improve-photo";
import type { RubricJson } from "@/lib/rubric";

vi.mock("@/lib/openai", () => ({
  imageEditCall: vi.fn(),
  getImageModel: vi.fn(),
}));

vi.mock("@/lib/score-photo", () => ({
  scorePhoto: vi.fn(),
}));

vi.mock("@/lib/fidelity", () => ({
  evaluateFidelity: vi.fn(),
  passesDeliveryGate: vi.fn(),
  passesSupportingDeliveryGate: vi.fn(),
  SUPPORTING_FIDELITY_PROMPT: "test",
}));

import { imageEditCall } from "@/lib/openai";
import { scorePhoto } from "@/lib/score-photo";
import { evaluateFidelity } from "@/lib/fidelity";

const mockImageEditCall = imageEditCall as ReturnType<typeof vi.fn>;
const mockScorePhoto = scorePhoto as ReturnType<typeof vi.fn>;
const mockEvaluateFidelity = evaluateFidelity as ReturnType<typeof vi.fn>;

const mockOriginalAudit: RubricJson = {
  upload_kind: "physical_product",
  checklist_category: "test",
  supporting_photo_checklist: [],
  product_summary: "test product",
  supporting_photo_role: "other",
  buyer_question_answered: "",
  supporting_verdict: "",
  priority_pillar: "thumbnail",
  priority_issue_family: "lighting",
  overall_score: 5,
  raw_overall_score: 5,
  pillars: { thumbnail: 5, lighting: 5, background: 5, click_appeal: 5 },
  detected_category: "small-goods",
  priority_action: "Improve lighting",
  priority_explanation: "Lighting is dim",
  next_steps: [{ observation: "Dim lighting", action: "Add light" }],
  share_headline: "Improve lighting",
  crop_suggestion: null,
  light_adjustment: null,
  generation_risk: "standard",
  generation_risk_reason: "none",
  answers_question_ids: [],
};

describe("improve-photo vision_failed handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers generated image with unavailable score if fidelity check fails", async () => {
    const originalBuffer = Buffer.from("original");
    const generatedBase64 = "generated-base64-data";

    // Step 1: Image generation succeeds
    mockImageEditCall.mockResolvedValueOnce(generatedBase64);

    // Step 2: Scoring fails (vision_failed case)
    mockScorePhoto.mockRejectedValueOnce(new Error("Vision API timeout"));
    mockEvaluateFidelity.mockRejectedValueOnce(new Error("Vision API timeout"));

    const result = await improvePhoto({
      originalBuffer,
      originalMimeType: "image/jpeg",
      originalAudit: mockOriginalAudit,
      mode: "main",
      onStage: vi.fn(),
    });

    // Should return ok: true with the generated image
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Expected success, received ${result.code}`);
    expect(result.imageBase64).toBe(generatedBase64);

    // Should have unavailable score (0)
    expect(result.candidateAudit.overall_score).toBe(0);
    expect(result.candidateAudit.raw_overall_score).toBe(0);
    expect(result.candidateAudit.priority_action).toBe("Score unavailable");

    // Should have unavailable fidelity
    expect(result.fidelity.fidelity_score).toBe(0);
    expect(result.fidelity.authenticity_score).toBe(0);
    expect(result.fidelity.reason.toLowerCase()).toContain("unavailable");

    // Should be delivered as useful_free_preview (shown to seller with warnings)
    expect(result.outcome).toBe("useful_free_preview");

    // Should include the failure in attempts
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].candidateScore).toBe(0);
  });

  it("marks fidelity as unavailable when scoring provider fails mid-attempt", async () => {
    const originalBuffer = Buffer.from("original");
    const generatedBase64 = "another-generated-base64";

    mockImageEditCall.mockResolvedValueOnce(generatedBase64);
    mockScorePhoto.mockRejectedValueOnce(new Error("Network error"));
    mockEvaluateFidelity.mockRejectedValueOnce(new Error("Network error"));

    const result = await improvePhoto({
      originalBuffer,
      originalMimeType: "image/jpeg",
      originalAudit: mockOriginalAudit,
      mode: "main",
      onStage: vi.fn(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Expected success, received ${result.code}`);
    expect(result.imageBase64).toBe(generatedBase64);

    // Fidelity should indicate unavailability
    const unavailableMarkers = [
      result.fidelity.reason.toLowerCase().includes("unavailable") ||
        result.fidelity.reason.toLowerCase().includes("failed"),
      result.fidelity.remaining_issues.some((issue: string) =>
        issue.toLowerCase().includes("unavailable") ||
        issue.toLowerCase().includes("failed")
      ),
    ];

    expect(unavailableMarkers.some((m) => m)).toBe(true);
  });

  it("seller can still see and retry from an unavailable-score version", async () => {
    // This test documents that even with unavailable score,
    // the image is shown to the seller (outcome: useful_free_preview)
    // and they can choose to retry or use it

    const originalBuffer = Buffer.from("original");
    const generatedBase64 = "base64-data";

    mockImageEditCall.mockResolvedValueOnce(generatedBase64);
    mockScorePhoto.mockRejectedValueOnce(new Error("Verification failed"));
    mockEvaluateFidelity.mockRejectedValueOnce(new Error("Verification failed"));

    const result = await improvePhoto({
      originalBuffer,
      originalMimeType: "image/jpeg",
      originalAudit: mockOriginalAudit,
      mode: "main",
      onStage: vi.fn(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Expected success, received ${result.code}`);
    expect(result.outcome).toBe("useful_free_preview");

    // The image itself is intact
    expect(result.imageBase64).toBe(generatedBase64);
    expect(result.mimeType).toBe("image/png");

    // Audit indicates score unavailable (not that generation failed)
    expect(result.candidateAudit.priority_action).toContain("unavailable");
  });

  it.each([
    ["studio", "SELECTED GENERATION STYLE: STUDIO", "jewelry-studio"],
    ["lifestyle", "SELECTED GENERATION STYLE: MODEL / LIFESTYLE", "naturally worn"],
  ] as const)(
    "passes the selected %s strategy into the provider prompt",
    async (generationStyle, styleHeading, categoryDirection) => {
      mockImageEditCall.mockResolvedValueOnce("styled-generated-image");
      mockScorePhoto.mockRejectedValueOnce(new Error("Verification failed"));
      mockEvaluateFidelity.mockRejectedValueOnce(new Error("Verification failed"));

      const result = await improvePhoto({
        originalBuffer: Buffer.from("original"),
        originalMimeType: "image/jpeg",
        originalAudit: {
          ...mockOriginalAudit,
          detected_category: "jewelry",
        },
        mode: "main",
        generationStyle,
        onStage: vi.fn(),
      });

      expect(result.ok).toBe(true);
      expect(mockImageEditCall).toHaveBeenCalledOnce();

      const prompt = mockImageEditCall.mock.calls[0]?.[0]?.prompt;
      expect(prompt).toEqual(expect.any(String));
      expect(prompt).toContain(styleHeading);
      expect(prompt.toLowerCase()).toContain(categoryDirection);
      expect(prompt).toContain("ABSOLUTE PRODUCT-FIDELITY FLOOR");
    }
  );
});
