import { describe, expect, it } from "vitest";
import {
  CALIBRATION_RULE,
  applyScoreCalibration,
  calibrateScore,
  rawOverall,
} from "@/lib/calibration";
import { computeOverall, INVALID_RESPONSE, type RubricJson } from "@/lib/rubric";

function rubricWithScore(overall: number): RubricJson {
  return { ...INVALID_RESPONSE, upload_kind: "physical_product", overall_score: overall };
}

describe("near-eight beta calibration (exact founder rule)", () => {
  it("keeps 0.0-7.4 unchanged", () => {
    expect(calibrateScore(0)).toBe(0);
    expect(calibrateScore(4.1)).toBe(4.1);
    expect(calibrateScore(7.2)).toBe(7.2);
    expect(calibrateScore(7.4)).toBe(7.4);
    expect(calibrateScore(7.49)).toBe(7.49);
  });

  it("presents 7.5-7.9 as 8.0", () => {
    expect(calibrateScore(7.5)).toBe(8.0);
    expect(calibrateScore(7.7)).toBe(8.0);
    expect(calibrateScore(7.9)).toBe(8.0);
    expect(calibrateScore(7.99)).toBe(8.0);
  });

  it("keeps 8.0-10.0 unchanged (NOT ordinary rounding)", () => {
    expect(calibrateScore(8.0)).toBe(8.0);
    expect(calibrateScore(8.1)).toBe(8.1);
    expect(calibrateScore(8.4)).toBe(8.4);
    expect(calibrateScore(9.2)).toBe(9.2);
    expect(calibrateScore(10)).toBe(10);
  });

  it("preserves the raw score and records the rule", () => {
    const rubric = applyScoreCalibration(rubricWithScore(7.7));
    expect(rubric.raw_overall_score).toBe(7.7);
    expect(rubric.overall_score).toBe(8.0);
    expect(rubric.calibration_rule).toBe(CALIBRATION_RULE);

    const unchanged = applyScoreCalibration(rubricWithScore(8.4));
    expect(unchanged.raw_overall_score).toBe(8.4);
    expect(unchanged.overall_score).toBe(8.4);
  });

  it("applies the authenticity/trust ceiling BEFORE normalization", () => {
    // Weighted 7.7-class pillars, but click_appeal < 5 triggers the trust
    // ceiling in computeOverall (cap 6.9). 6.9 < 7.5, so calibration must not
    // promote it to 8.0.
    const pillars = { thumbnail: 9, lighting: 9, background: 9, click_appeal: 2 };
    const capped = computeOverall(pillars);
    expect(capped).toBeLessThanOrEqual(6.9);
    const rubric = applyScoreCalibration(rubricWithScore(capped));
    expect(rubric.overall_score).toBe(capped);
    expect(rubric.overall_score).not.toBe(8.0);
  });

  it("weighted 7.7 with no safety problem displays 8.0", () => {
    // 8*0.4 + 8*0.25 + 7*0.2 + 7*0.15 = 7.65 -> raw 7.7 band; click_appeal >= 5
    const pillars = { thumbnail: 8, lighting: 8, background: 7, click_appeal: 7 };
    const raw = computeOverall(pillars);
    expect(raw).toBeGreaterThanOrEqual(7.5);
    expect(raw).toBeLessThan(8.0);
    const rubric = applyScoreCalibration(rubricWithScore(raw));
    expect(rubric.overall_score).toBe(8.0);
    expect(rubric.raw_overall_score).toBe(raw);
  });

  it("rawOverall prefers the preserved raw score and falls back for legacy audits", () => {
    const calibrated = applyScoreCalibration(rubricWithScore(7.8));
    expect(rawOverall(calibrated)).toBe(7.8);
    // Legacy audit persisted before calibration existed: overall IS raw.
    expect(rawOverall({ overall_score: 7.8 })).toBe(7.8);
  });
});
