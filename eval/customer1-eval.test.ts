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
import { loadGoldenSet, runFixture, runMeta } from "./harness";

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
      expect(fixtures.length, "customer1 fixtures present").toBe(6);

      // Repeated runs measure is_marketing_graphic stability (false positives on
      // ordinary photos, false negatives on graphics). EVAL_REPEATS=3 recommended.
      const repeats = Math.max(1, Number(process.env.EVAL_REPEATS || 1));
      const meta = runMeta();
      console.log(
        `\n[customer1-eval] model ${meta.model} · main ${meta.rubricVersions.main} / ${meta.rubricVersions.supporting} · repeats=${repeats}`
      );

      const flagGot: Record<string, boolean[]> = {};
      let anyError = false;
      for (const f of fixtures) {
        const expected = f.expected.is_marketing_graphic;
        flagGot[f.id] = [];
        for (let i = 0; i < repeats; i++) {
          const r = await runFixture(f);
          if (r.band === "error") anyError = true;
          flagGot[f.id].push(r.isMarketingGraphic);
          const flagBad =
            expected !== undefined && r.isMarketingGraphic !== expected;
          console.log(
            `[customer1-eval] ${f.id.padEnd(30)} run${i + 1} score=${r.score.toFixed(1)} band=${r.band.padEnd(6)} kind=${r.uploadKind} graphic=${r.isMarketingGraphic}${expected !== undefined ? ` (want ${expected})` : ""}${flagBad ? " <-- FLAG MISMATCH" : ""}`
          );
          await new Promise((res) => setTimeout(res, 3000));
        }
      }

      // False-positive / false-negative tally for the graphic flag.
      let fp = 0;
      let fn = 0;
      let n = 0;
      for (const f of fixtures) {
        const expected = f.expected.is_marketing_graphic;
        if (expected === undefined) continue;
        for (const got of flagGot[f.id]) {
          n++;
          if (expected === false && got === true) fp++;
          if (expected === true && got === false) fn++;
        }
      }
      console.log(
        `[customer1-eval] is_marketing_graphic over ${n} runs -> false positives (ordinary flagged graphic): ${fp}, false negatives (graphic missed): ${fn}`
      );

      expect(anyError, "no run errors").toBe(false);
    },
    20 * 60_000
  );
});
