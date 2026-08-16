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

describe("freePreviewMessage (incomplete-product warning always shows; every other flag is redundant with the always-on disclaimer and stays silent)", () => {
  it("no fidelity report at all -> the neutral honest message", () => {
    expect(freePreviewMessage(null)).toBe(NEUTRAL_PREVIEW_MESSAGE);
  });

  it("drift ONLY -> removed (empty string), per founder decision 2026-08-08", () => {
    expect(
      freePreviewMessage({ ...base, text_or_pattern_drift: true })
    ).toBe("");
    expect(
      freePreviewMessage({ ...base, invented_or_missing_details: true })
    ).toBe("");
  });

  it("ai_looking ONLY -> removed (empty string), per founder decision this session", () => {
    // The dedicated "may look AI-generated" warning was removed: it's
    // redundant with the always-shown "Label text and small patterns may
    // differ..." disclaimer, and it was also the source of a real bug
    // (lingering next to a "we kept your current photo" note when the
    // AI-looking candidate LOST and was never actually shown).
    expect(freePreviewMessage({ ...base, ai_looking: true })).toBe("");
  });

  it("incomplete product ONLY -> the incomplete-product warning", () => {
    expect(
      freePreviewMessage({ ...base, full_product_visible: false })
    ).toContain("uploading a photo that shows the complete product.");
  });

  it("nothing flagged -> the neutral honest message", () => {
    expect(freePreviewMessage(base)).toBe(NEUTRAL_PREVIEW_MESSAGE);
  });

  it("drift + ai_looking together -> still empty (both silenced, no conflict)", () => {
    expect(
      freePreviewMessage({
        ...base,
        text_or_pattern_drift: true,
        ai_looking: true,
      })
    ).toBe("");
  });

  it("invented details + incomplete product -> incomplete-product still shows (only non-silenced flag)", () => {
    expect(
      freePreviewMessage({
        ...base,
        invented_or_missing_details: true,
        full_product_visible: false,
      })
    ).toContain("uploading a photo that shows the complete product.");
  });

  it("ai_looking + incomplete product -> incomplete-product still shows (ai_looking is silent, not suppressive)", () => {
    expect(
      freePreviewMessage({
        ...base,
        ai_looking: true,
        full_product_visible: false,
      })
    ).toContain("uploading a photo that shows the complete product.");
  });

  it("all flags at once, including incomplete product -> the one non-silenced warning still shows", () => {
    expect(
      freePreviewMessage({
        ...base,
        text_or_pattern_drift: true,
        invented_or_missing_details: true,
        ai_looking: true,
        full_product_visible: false,
      })
    ).toContain("uploading a photo that shows the complete product.");
  });
});
