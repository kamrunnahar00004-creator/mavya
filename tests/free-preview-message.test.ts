import { describe, expect, it } from "vitest";
import {
  freePreviewMessage,
  NEUTRAL_PREVIEW_MESSAGE,
} from "@/lib/free-preview-message";
import type { FidelityReport } from "@/lib/fidelity";

const base: FidelityReport = {
  publishable: true,
  fidelity_score: 7,
  authenticity_score: 7,
  full_product_visible: true,
  ai_looking: false,
  invented_or_missing_details: false,
  text_or_pattern_drift: false,
  collage_or_duplicate_product: false,
  remaining_issues: [],
  recommended_next_action: "deliver",
  reason: "",
};

describe("freePreviewMessage (severity-ordered, flags can coexist)", () => {
  it("no fidelity report at all -> the neutral honest message", () => {
    expect(freePreviewMessage(null)).toBe(NEUTRAL_PREVIEW_MESSAGE);
  });

  it("drift ONLY -> removed (empty string), per founder decision", () => {
    expect(
      freePreviewMessage({ ...base, text_or_pattern_drift: true })
    ).toBe("");
    expect(
      freePreviewMessage({ ...base, invented_or_missing_details: true })
    ).toBe("");
  });

  it("ai_looking ONLY -> the AI-looking warning", () => {
    expect(freePreviewMessage({ ...base, ai_looking: true })).toBe(
      "This version may look AI-generated. Check it against your real product before using it."
    );
  });

  it("incomplete product ONLY -> the incomplete-product warning", () => {
    expect(
      freePreviewMessage({ ...base, full_product_visible: false })
    ).toContain("uploading a photo that shows the complete product.");
  });

  it("nothing flagged -> the neutral honest message", () => {
    expect(freePreviewMessage(base)).toBe(NEUTRAL_PREVIEW_MESSAGE);
  });

  // Regression coverage for the ordering bug: drift/invented-details must
  // NEVER suppress a more severe warning it happens to coexist with.
  it("drift + ai_looking -> ai_looking wins (not silently empty)", () => {
    expect(
      freePreviewMessage({
        ...base,
        text_or_pattern_drift: true,
        ai_looking: true,
      })
    ).toBe(
      "This version may look AI-generated. Check it against your real product before using it."
    );
  });

  it("invented details + incomplete product -> incomplete-product wins (not silently empty)", () => {
    expect(
      freePreviewMessage({
        ...base,
        invented_or_missing_details: true,
        full_product_visible: false,
      })
    ).toContain("uploading a photo that shows the complete product.");
  });

  it("ai_looking + incomplete product -> ai_looking still takes priority", () => {
    expect(
      freePreviewMessage({
        ...base,
        ai_looking: true,
        full_product_visible: false,
      })
    ).toBe(
      "This version may look AI-generated. Check it against your real product before using it."
    );
  });

  it("all three flags at once -> ai_looking (most severe) wins", () => {
    expect(
      freePreviewMessage({
        ...base,
        text_or_pattern_drift: true,
        invented_or_missing_details: true,
        ai_looking: true,
        full_product_visible: false,
      })
    ).toBe(
      "This version may look AI-generated. Check it against your real product before using it."
    );
  });
});
