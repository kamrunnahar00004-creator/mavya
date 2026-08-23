/**
 * ONE-OFF: score a single local fixture image N times to measure variance.
 * Run: RUN_ONE_SHOT=true ONE_SHOT_IMAGE=public/assets/candle-02.png \
 *      npx vitest run eval/one-shot-score.test.ts
 */
import { describe, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadLocalEnv(): void {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadLocalEnv();

const RUN = process.env.RUN_ONE_SHOT === "true";
const REPEATS = Number(process.env.ONE_SHOT_REPEATS || 3);

describe.skipIf(!RUN)("one-shot score variance", () => {
  it("scores the image repeatedly", { timeout: 600_000 }, async () => {
    const { scorePhoto } = await import("@/lib/score-photo");
    const rel = process.env.ONE_SHOT_IMAGE!;
    const buf = readFileSync(path.resolve(__dirname, "..", rel));
    const mime = rel.endsWith(".jpg") || rel.endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    for (let i = 1; i <= REPEATS; i++) {
      const r = (await scorePhoto({
        imageBuffer: buf,
        imageMimeType: mime,
        buyerQuestions: { kind: "all" },
      })) as unknown as Record<string, unknown>;
      const p = (r.pillars ?? {}) as Record<string, number>;
      console.log(
        `run ${i}: overall=${r.overall_score} raw=${r.raw_overall_score} ` +
          `thumb=${p.thumbnail} light=${p.lighting} bg=${p.background} click=${p.click_appeal} ` +
          `trust=${r.trust_risk} priority="${r.priority_action}"`
      );
      console.log(`  priority_explanation: ${r.priority_explanation}`);
      const steps = (r.next_steps ?? []) as Array<{ action: string; observation: string }>;
      steps.forEach((s, idx) =>
        console.log(`  next_step[${idx}] action="${s.action}"\n    observation: ${s.observation}`)
      );
      await new Promise((res) => setTimeout(res, 21_000));
    }
  });
});
