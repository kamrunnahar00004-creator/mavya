/**
 * LIVE eval of the FIRST real customer's 5 images only (not the whole golden
 * set). Costs real OpenAI money — gated exactly like live-eval.test.ts.
 *
 *   RUN_LIVE_AI_EVALS=true   required to run at all
 *
 * Purpose: prove the supporting-v7 Accuracy gate pulls the misleading listing
 * graphic into the weak band on the REAL image, while the two correct photos
 * (main + strong supporting) and the generated images do NOT regress.
 *
 * Command:
 *   RUN_LIVE_AI_EVALS=true node node_modules/vitest/vitest.mjs run eval/customer1-eval.test.ts
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadGoldenSet, runFixture, runMeta, type EvalRun } from "./harness";

function loadLocalEnv(): void {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const LIVE = process.env.RUN_LIVE_AI_EVALS === "true";

describe.skipIf(!LIVE)("live customer-1 scoring eval", () => {
  it(
    "scores the 5 customer images and prints the table",
    async () => {
      loadLocalEnv();
      expect(process.env.OPENAI_API_KEY, "OPENAI_API_KEY required").toBeTruthy();

      const set = loadGoldenSet();
      const fixtures = set.fixtures.filter((f) => f.id.startsWith("customer1-"));
      expect(fixtures.length, "customer1 fixtures present").toBe(5);

      const run: EvalRun = { ...runMeta(), results: [] };
      for (const f of fixtures) {
        run.results.push(await runFixture(f));
        await new Promise((r) => setTimeout(r, 3000));
      }

      console.log(`\n[customer1-eval] model ${run.model} · ${run.rubricVersions.supporting}`);
      for (const r of run.results) {
        const soft = r.checks.filter((c) => c.level === "soft" && !c.pass);
        console.log(
          `[customer1-eval] ${r.id.padEnd(30)} score=${r.score.toFixed(1)} band=${r.band.padEnd(6)} kind=${r.uploadKind} role=${r.priorityFamily}` +
            (soft.length ? ` · WARN: ${soft.map((c) => `${c.name}(${c.detail})`).join("; ")}` : "")
        );
      }

      // Report-only: soft fixtures never assert. The score table is the artifact.
      expect(run.results.every((r) => r.band !== "error"), "no run errors").toBe(true);
    },
    20 * 60_000
  );
});
