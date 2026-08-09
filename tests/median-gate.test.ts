import { describe, expect, it } from "vitest";
import { pickMedianResult, type Check, type FixtureResult } from "../eval/harness";

/**
 * pickMedianResult (Codex review, 2026-08-09): score_range was a hard gate
 * that got manually waived on a single unlucky draw (candle-pink-improved-01
 * at 7.3 vs a 7.5 threshold, when its own history swings 7.1-8.4). The fix:
 * fixtures flagged consistency:true run 3 fresh times and gate on the MEDIAN
 * score, not one draw. These tests cover the pure aggregation rule only
 * (no live API calls) — see runFixtureForGate for the live-call wiring.
 *
 * Round 2 (Codex review): the first version of pickMedianResult returned the
 * median run's full result wholesale, silently discarding the other two
 * runs' checks entirely — including genuine non-score hard failures (wrong
 * category, wrong upload_kind, jargon leaking back in, a busted schema) that
 * happened to land on a non-median draw. Fixed: score-derived checks
 * (score_range, band) follow the median run specifically; every other check
 * name is unioned across all 3 runs, so a real failure on ANY draw survives
 * into the aggregate.
 */

function fakeResult(
  score: number,
  overrides: Partial<FixtureResult> = {},
  extraChecks: Check[] = []
): FixtureResult {
  const scoreCheck: Check = {
    name: "score_range",
    level: "hard",
    pass: score >= 7.5,
    detail: score >= 7.5 ? "in range" : `expected [7.5, 10], got ${score}`,
  };
  return {
    id: "fixture-x",
    ok: score >= 7.5 && extraChecks.every((c) => c.level !== "hard" || c.pass),
    warnings: 0,
    checks: [scoreCheck, ...extraChecks],
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

describe("pickMedianResult — score-derived checks (score_range, band) follow the median", () => {
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

  it("real case: candle-label-improved-01-shaped history (two under threshold, one over) -- median fails", () => {
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

  it("a genuine median pass (2 of 3 over threshold) makes the gate pass when nothing else fails", () => {
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

describe("pickMedianResult — non-score hard failures on ANY run survive into the aggregate (Codex review round 2, real bug)", () => {
  it("a wrong-category failure on the LOW-scoring run still fails the aggregate, even though the median run is clean", () => {
    const lowRunWithCategoryFail = fakeResult(7.1, {}, [
      { name: "category", level: "hard", pass: false, detail: "expected candles, got jewelry" },
    ]);
    const cleanMedian = fakeResult(8.0);
    const cleanHigh = fakeResult(8.4);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      lowRunWithCategoryFail,
      cleanMedian,
      cleanHigh,
    ];
    const result = pickMedianResult(runs);
    expect(result.score).toBe(8.0); // median run's own score, used for display/score_range
    expect(result.ok).toBe(false); // but the category failure from the low run must still fail the gate
    expect(result.checks.some((c) => c.name === "category" && !c.pass)).toBe(true);
  });

  it("a wrong upload_kind (schema-adjacent) failure on the HIGH-scoring run still fails the aggregate", () => {
    const cleanLow = fakeResult(7.1);
    const cleanMedian = fakeResult(7.3);
    const highRunWithUploadKindFail = fakeResult(8.4, {}, [
      { name: "upload_kind", level: "hard", pass: false, detail: "expected physical_product, got invalid" },
    ]);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      cleanLow,
      cleanMedian,
      highRunWithUploadKindFail,
    ];
    const result = pickMedianResult(runs);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.name === "upload_kind" && !c.pass)).toBe(true);
  });

  it("a busted schema_valid failure on any run still fails the aggregate", () => {
    const median = fakeResult(7.3);
    const brokenRun = fakeResult(7.2, {}, [
      { name: "schema_valid", level: "hard", pass: false, detail: "AI scoring returned an invalid response" },
    ]);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [brokenRun, median, fakeResult(8.0)];
    const result = pickMedianResult(runs);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.name === "schema_valid" && !c.pass)).toBe(true);
  });

  it("a wrong is_marketing_graphic detection on a non-median run still fails the aggregate", () => {
    const median = fakeResult(7.3);
    const graphicMisdetect = fakeResult(7.9, {}, [
      { name: "is_marketing_graphic", level: "hard", pass: false, detail: "expected true, got false" },
    ]);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [fakeResult(7.1), median, graphicMisdetect];
    const result = pickMedianResult(runs);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.name === "is_marketing_graphic" && !c.pass)).toBe(true);
  });

  it("an advice_no_jargon failure on a non-median run still fails the aggregate", () => {
    const median = fakeResult(6.8);
    const jargonRun = fakeResult(6.5, {}, [
      { name: "advice_no_jargon", level: "hard", pass: false, detail: "next_steps[0].observation: diffuse" },
    ]);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [jargonRun, median, fakeResult(7.0)];
    const result = pickMedianResult(runs);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.name === "advice_no_jargon" && !c.pass)).toBe(true);
  });

  it("a soft warning on a non-median run is preserved for auditability (not just hard failures)", () => {
    const median = fakeResult(6.8);
    const softWarnRun = fakeResult(6.5, {}, [
      { name: "advice_concrete", level: "soft", pass: false, detail: "no number/tool/surface/color found in: next_steps[2]" },
    ]);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [softWarnRun, median, fakeResult(7.0)];
    const result = pickMedianResult(runs);
    // Soft failures never flip ok, but must still be visible in the aggregate.
    expect(result.checks.some((c) => c.name === "advice_concrete" && !c.pass)).toBe(true);
    expect(result.warnings).toBeGreaterThan(0);
  });

  it("does NOT union score_range or band across runs -- only the median run's own value governs those", () => {
    // The low run's own score_range failure is EXPECTED and must not be
    // treated as a generic "non-score" failure to union in under a
    // different guise -- it's already exactly what the median's own score
    // determines. This just confirms no double-counting/duplicate checks.
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(7.1),
      fakeResult(7.3),
      fakeResult(8.4),
    ];
    const result = pickMedianResult(runs);
    const scoreRangeChecks = result.checks.filter((c) => c.name === "score_range");
    expect(scoreRangeChecks.length).toBe(1);
    expect(scoreRangeChecks[0].pass).toBe(false); // median (7.3) is under threshold
  });

  it("a failure already flagged under the same name by the median run is not duplicated", () => {
    const median = fakeResult(7.3, {}, [
      { name: "advice_no_jargon", level: "hard", pass: false, detail: "median's own diffuse" },
    ]);
    const alsoFailing = fakeResult(7.1, {}, [
      { name: "advice_no_jargon", level: "hard", pass: false, detail: "other run's diffuse" },
    ]);
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [alsoFailing, median, fakeResult(8.4)];
    const result = pickMedianResult(runs);
    const jargonFailures = result.checks.filter((c) => c.name === "advice_no_jargon" && !c.pass);
    expect(jargonFailures.length).toBe(1);
    expect(jargonFailures[0].detail).toBe("median's own diffuse"); // median's own detail wins, not overwritten
  });

  it("when everything is clean across all 3 runs, the aggregate passes", () => {
    const runs: [FixtureResult, FixtureResult, FixtureResult] = [
      fakeResult(7.6),
      fakeResult(7.8),
      fakeResult(8.0),
    ];
    const result = pickMedianResult(runs);
    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.pass)).toBe(true);
  });
});
