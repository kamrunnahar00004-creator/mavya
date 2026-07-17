import { describe, expect, it } from "vitest";
import {
  computeOverall,
  computeSupportingOverall,
  isRubricJson,
  INVALID_RESPONSE,
} from "@/lib/rubric";
import { calibrateScore } from "@/lib/calibration";

const strongPillars = { thumbnail: 9, lighting: 9, background: 8, click_appeal: 9 };

describe("deterministic trust verdict gate", () => {
  it("evidenced HIGH trust risk caps the raw overall at 5.4 (weak band)", () => {
    // 9/9/8/9 weighs to 8.8 — the trucker-mug case: magnetic image, fake
    // product. Founder decision 2026-07-17: an untrustworthy listing is at
    // best a 5, no matter how clickable the render is.
    expect(computeOverall(strongPillars)).toBe(8.8);
    expect(computeOverall(strongPillars, "high")).toBe(5.4);
    expect(computeSupportingOverall(strongPillars, "high")).toBe(5.4);
  });

  it("a trust-capped score is never promoted by calibration", () => {
    expect(calibrateScore(computeOverall(strongPillars, "high"))).toBe(5.4);
  });

  it("none/moderate/absent trust risk never caps", () => {
    expect(computeOverall(strongPillars, "none")).toBe(8.8);
    expect(computeOverall(strongPillars, "moderate")).toBe(8.8);
    expect(computeOverall(strongPillars, undefined)).toBe(8.8);
  });

  it("the cap only lowers, never raises, a weak score", () => {
    const weak = { thumbnail: 4, lighting: 5, background: 3, click_appeal: 3 };
    expect(computeOverall(weak, "high")).toBe(computeOverall(weak));
  });

  it("isRubricJson accepts legacy rubrics without trust fields and valid new ones", () => {
    expect(isRubricJson(INVALID_RESPONSE)).toBe(true);
    expect(
      isRubricJson({ ...INVALID_RESPONSE, trust_risk: "high", trust_evidence: "warped lettering" })
    ).toBe(true);
    const legacy = { ...INVALID_RESPONSE } as Record<string, unknown>;
    delete legacy.trust_risk;
    delete legacy.trust_evidence;
    expect(isRubricJson(legacy)).toBe(true);
  });

  it("isRubricJson rejects invalid trust values", () => {
    expect(isRubricJson({ ...INVALID_RESPONSE, trust_risk: "extreme" })).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, trust_evidence: 42 })).toBe(false);
  });
});
