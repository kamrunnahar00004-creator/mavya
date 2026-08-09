import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReportSafe, loadGoldenSet, type EvalRun } from "../eval/harness";

/**
 * Report privacy (Codex review, 2026-08-09): eval/fixtures/customer1/* are a
 * real customer's real photos, not our own test assets. Nothing previously
 * stopped their generated advice text from being written into a committed
 * report if that code path ever got exercised — it hadn't leaked only by
 * accident (fixture ordering + the default MAX_LIVE_EVAL_FIXTURES budget),
 * not by any actual guardrail. isReportSafe() is the guardrail; these tests
 * pin its behavior against the real golden set AND scan every already-
 * committed report for a leak, so a regression here fails deterministically
 * without a live API call.
 */

describe("isReportSafe", () => {
  it("every real customer1 fixture is NOT report-safe", () => {
    const set = loadGoldenSet();
    const customerFixtures = set.fixtures.filter((f) => f.id.startsWith("customer1-"));
    expect(customerFixtures.length, "customer1 fixtures present in golden set").toBeGreaterThan(0);
    for (const f of customerFixtures) {
      expect(isReportSafe(f), `${f.id} (${f.image}) must not be report-safe`).toBe(false);
    }
  });

  it("every public/assets fixture is report-safe", () => {
    const set = loadGoldenSet();
    const publicFixtures = set.fixtures.filter((f) => f.image.startsWith("public/assets/"));
    expect(publicFixtures.length).toBeGreaterThan(0);
    for (const f of publicFixtures) {
      expect(isReportSafe(f), `${f.id} (${f.image}) should be report-safe`).toBe(true);
    }
  });

  it("a fixture outside public/assets is unsafe by default, safe only with explicit reportSafe: true", () => {
    expect(isReportSafe({ image: "eval/fixtures/customer1/x.jpg" } as never)).toBe(false);
    expect(
      isReportSafe({ image: "eval/fixtures/customer1/x.jpg", reportSafe: true } as never)
    ).toBe(true);
  });
});

describe("committed report files never contain customer1 advice text (regression guard)", () => {
  const reportsDir = path.resolve(__dirname, "..", "eval", "reports");
  const jsonFiles = readdirSync(reportsDir).filter((f) => f.endsWith(".json"));

  it("scanned at least one committed report", () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it("no committed report has an adviceSnapshot on a customer1-* fixture", () => {
    const offenders: string[] = [];
    for (const file of jsonFiles) {
      const raw = readFileSync(path.join(reportsDir, file), "utf8");
      let run: EvalRun;
      try {
        run = JSON.parse(raw);
      } catch {
        continue; // baseline.json / non-run files, ignore
      }
      for (const r of run.results ?? []) {
        if (r.id?.startsWith("customer1-") && r.adviceSnapshot) {
          offenders.push(`${file} :: ${r.id}`);
        }
      }
    }
    expect(offenders, "customer1 fixtures with persisted advice text").toEqual([]);
  });
});
