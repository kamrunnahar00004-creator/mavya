/**
 * LIVE golden-set evaluation. Costs real OpenAI money — never runs in normal
 * `npm test`. Guards:
 *   RUN_LIVE_AI_EVALS=true            required to run at all
 *   MAX_LIVE_EVAL_FIXTURES=<n>        budget cap (default 20)
 *   EVAL_REPEATS=<n>                  >=2 enables the consistency subset
 *   EVAL_ALLOW_REGRESSIONS=true       report-only mode (no assertion)
 *
 * Command: npm run eval:live
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  compareToBaseline,
  loadBaseline,
  loadGoldenSet,
  persistRun,
  runConsistency,
  runFixtureForGate,
  runMeta,
  type EvalRun,
} from "./harness";

// vitest does not load .env.local; read OPENAI_* from it without logging values.
function loadLocalEnv(): void {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const LIVE = process.env.RUN_LIVE_AI_EVALS === "true";

describe.skipIf(!LIVE)("live golden-set scoring eval", () => {
  it(
    "runs the golden set, persists a report, and blocks hard regressions",
    async () => {
      loadLocalEnv();
      expect(process.env.OPENAI_API_KEY, "OPENAI_API_KEY required").toBeTruthy();

      const set = loadGoldenSet();
      const budget = Number(process.env.MAX_LIVE_EVAL_FIXTURES || 20);
      const fixtures = set.fixtures.slice(0, budget);

      const run: EvalRun = { ...runMeta(), results: [] };
      for (const f of fixtures) {
        // Sequential + paced on purpose: predictable rate-limit + cost behavior.
        // Fixtures flagged consistency:true (known stochastic wobble) run 3x
        // and gate on the median score instead of one draw — see
        // runFixtureForGate in harness.ts. This roughly doubles total run
        // cost/time (13/20 golden fixtures are flagged), traded for a hard
        // gate that no longer flips on a single unlucky call.
        run.results.push(await runFixtureForGate(f));
        await new Promise((r) => setTimeout(r, 3000));
      }

      const repeats = Number(process.env.EVAL_REPEATS || 1);
      if (repeats >= 2) {
        run.consistency = await runConsistency(
          fixtures.filter((f) => f.consistency),
          repeats
        );
      }

      const baseline = loadBaseline();
      const comparison = baseline ? compareToBaseline(run, baseline) : null;
      const saved = persistRun(run, comparison);

      console.log(
        `[eval] ${run.results.filter((r) => r.ok).length}/${run.results.length} pass · report: ${saved.mdPath}${saved.savedAsBaseline ? " · SAVED AS BASELINE" : ""}`
      );
      for (const r of run.results.filter((r) => !r.ok)) {
        console.log(`[eval] FAIL ${r.id}: ${r.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`).join("; ")}`);
      }

      // Two separate gates (Codex review: a baseline-regression-only check can
      // pass green while the CURRENT run still has a real hard failure, as
      // long as that exact failure also existed in the baseline -- that's not
      // a release-safe state). Both are skippable via EVAL_ALLOW_REGRESSIONS
      // for named diagnostic runs, but final release verification must run
      // without it so both are enforced.
      if (process.env.EVAL_ALLOW_REGRESSIONS !== "true") {
        const currentHardFailures = run.results.flatMap((r) =>
          r.checks
            .filter((c) => c.level === "hard" && !c.pass)
            .map((c) => `${r.id} :: ${c.name} — ${c.detail}`)
        );
        expect(currentHardFailures, "current run must have zero hard failures").toEqual([]);

        if (comparison) {
          const hardRegressions = comparison.regressions.filter((r) =>
            r.includes("[hard]")
          );
          expect(hardRegressions, "hard regressions vs baseline").toEqual([]);
        }
      }
    },
    30 * 60_000
  );
});
