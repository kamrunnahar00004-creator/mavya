import { describe, expect, it } from "vitest";
import { pickMedianResult, type FixtureResult } from "../eval/harness";

/**
 * pickMedianResult (Codex review, 2026-08-09): score_range was a hard gate
 * that got manually waived on a single unlucky draw (candle-pink-improved-01
 * at 7.3 vs a 7.5 threshold, when its own history swings 7.1-8.4). The fix:
 * fixtures flagged consistency:true run 3 fresh times and gate on the MEDIAN
 * score, not one draw. These tests cover the pure aggregation rule only
 * (no live API calls) — see runFixtureForGate for the live-call wiring.
 */

function fakeResult(score: number, overrides: Partial<FixtureResult> = {}): FixtureResult {
  return {
    id: "fixture-x",
    ok: score >= 7.5,
    warnings: 0,
    checks: [
      {
        name: "score_range",
        level: "hard",
        pass: score >= 7.5,
        detail: score >= 7.5 ? "in range" : `expected [7.5, 10], got ${score}`,
      },
    ],
    score,
    band: score >= 7.5 ? "strong" : "mid",
    category: "candles",
    uploadKind: "physical_product",
    priorityPillar: "click_appeal",
    priorityFamily: "background",
    isMarketingGraphic: false,
    latencyMs: 1000,
    ...overrides,
  };
}

describe("pickMedianResult", () => {
  it("picks the middle value of 3 distinct scores", () => {
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(7.3),
      fakeResult(7.3),
      fakeResult(8.1),
    ];
    const result = pickMedianResult(runs);
    expect(result.score).toBe(7.3);
    expect(result.medianOf3?.chosen).toBe(7.3);
    expect(result.medianOf3?.scores).toEqual([7.3, 7.3, 8.1]);
  });

  it("is order-independent -- same 3 scores in any order pick the same median", () => {
    const a = pickMedianResult([fakeResult(8.4), fakeResult(7.1), fakeResult(7.1)]);
    const b = pickMedianResult([fakeResult(7.1), fakeResult(7.1), fakeResult(8.4)]);
    const c = pickMedianResult([fakeResult(7.1), fakeResult(8.4), fakeResult(7.1)]);
    expect(a.score).toBe(7.1);
    expect(b.score).toBe(7.1);
    expect(c.score).toBe(7.1);
  });

  it("the median run's own hard checks (computed against its own score) are what the gate sees", () => {
    // Real case: candle-label-improved-01 history includes exactly this
    // pattern -- two runs under threshold, one over. Median must be a
    // failing run here, so the gate correctly still fails overall.
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(7.1),
      fakeResult(8.4),
      fakeResult(7.1),
    ];
    const result = pickMedianResult(runs);
    expect(result.score).toBe(7.1);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "score_range")?.pass).toBe(false);
  });

  it("a genuine median pass (2 of 3 over threshold) makes the gate pass", () => {
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(7.6),
      fakeResult(8.0),
      fakeResult(7.3),
    ];
    const result = pickMedianResult(runs);
    expect(result.score).toBe(7.6);
    expect(result.ok).toBe(true);
  });

  it("records medianOf3 with all 3 raw scores in the ORIGINAL run order, not sorted", () => {
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(8.1),
      fakeResult(7.3),
      fakeResult(7.3),
    ];
    const result = pickMedianResult(runs);
    expect(result.medianOf3?.scores).toEqual([8.1, 7.3, 7.3]);
  });

  it("does not mutate the input array order", () => {
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(8.1),
      fakeResult(7.1),
      fakeResult(7.6),
    ];
    const before = runs.map((r) => r.score);
    pickMedianResult(runs);
    expect(runs.map((r) => r.score)).toEqual(before);
  });
});
