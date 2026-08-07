import { describe, expect, it } from "vitest";
import {
  computeOverall,
  computeSupportingOverall,
  isRubricJson,
  INVALID_RESPONSE,
} from "@/lib/rubric";

describe("score computation (server-owned)", () => {
  it("applies the locked 40/25/20/15 weights", () => {
    expect(computeOverall({ thumbnail: 10, lighting: 10, background: 10, click_appeal: 10 })).toBe(10);
    expect(computeOverall({ thumbnail: 8, lighting: 6, background: 6, click_appeal: 6 })).toBe(6.8);
  });

  it("caps at 6.9 when click_appeal < 5 (authenticity ceiling)", () => {
    const capped = computeOverall({ thumbnail: 10, lighting: 10, background: 10, click_appeal: 4 });
    expect(capped).toBeLessThanOrEqual(6.9);
  });

  it("supporting weights are 35/30/20/15 with no click-appeal cap", () => {
    expect(
      computeSupportingOverall({ thumbnail: 10, lighting: 10, background: 10, click_appeal: 4 })
    ).toBeGreaterThan(6.9);
  });

  it("Accuracy gate: background <= 3 caps the supporting overall into the weak band", () => {
    // Strong Buyer Confidence / Clarity / Presentation but Accuracy 3 (misleading
    // graphic). Un-gated this averages to ~6.0; the gate pulls it to <= 4.9.
    const capped = computeSupportingOverall({
      thumbnail: 7,
      lighting: 7,
      background: 3,
      click_appeal: 6,
    });
    expect(capped).toBeLessThanOrEqual(4.9);
  });

  it("Marketing-graphic gate: is_marketing_graphic caps into the weak band even with high pillars", () => {
    const pillars = { thumbnail: 8, lighting: 8, background: 7, click_appeal: 7 };
    // Same pillars, not flagged -> strong/usable.
    expect(computeSupportingOverall(pillars, undefined, false)).toBeGreaterThan(6);
    // Flagged as a composed sales graphic -> weak regardless of pillar values.
    expect(computeSupportingOverall(pillars, undefined, true)).toBeLessThanOrEqual(4.9);
  });

  it("Accuracy gate leaves honest supporting photos untouched (background >= 4)", () => {
    const ok = computeSupportingOverall({
      thumbnail: 8,
      lighting: 8,
      background: 8,
      click_appeal: 8,
    });
    expect(ok).toBeCloseTo(8, 1);
  });

  it("validates the canonical invalid response", () => {
    expect(isRubricJson(INVALID_RESPONSE)).toBe(true);
  });

  it("rejects malformed rubric JSON", () => {
    expect(isRubricJson({})).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, pillars: { thumbnail: 11 } })).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, supporting_photo_role: "nonsense" })).toBe(false);
  });
});
