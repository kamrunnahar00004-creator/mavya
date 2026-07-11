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

  it("validates the canonical invalid response", () => {
    expect(isRubricJson(INVALID_RESPONSE)).toBe(true);
  });

  it("rejects malformed rubric JSON", () => {
    expect(isRubricJson({})).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, pillars: { thumbnail: 11 } })).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, supporting_photo_role: "nonsense" })).toBe(false);
  });
});
