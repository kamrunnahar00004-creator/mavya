/**
 * Scoring-eval harness. Runs golden-set fixtures through the REAL scoring
 * implementation (src/lib/score-photo.ts — no HTTP, no auth, no score cache, so
 * variance is visible), evaluates expectations with hard/soft tolerances, and
 * writes reports + baseline comparisons.
 *
 * Cost: every fixture run is a live vision call against whatever
 * OPENAI_VISION_MODEL resolves to (gpt-5.6-sol by default as of 2026-08-23).
 * Only invoked through the env-gated live runner (eval/live-eval.test.ts) or
 * explicitly.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { scorePhoto } from "@/lib/score-photo";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { issueFamilyOf } from "@/lib/improve-photo";
import { getVisionModel } from "@/lib/openai";
import { RUBRIC_VERSION, SUPPORTING_RUBRIC_VERSION } from "@/lib/versions";
import type { RubricJson } from "@/lib/rubric";
import {
  bandOf,
  validateGoldenSet,
  type GoldenFixture,
  type GoldenSet,
} from "./fixture-schema";
import {
  findAmbiguousProp,
  findDecorativeProp,
  findJargon,
  hasConcreteSpecific,
} from "./advice-quality";

const ROOT = path.resolve(__dirname, "..");
export const REPORTS_DIR = path.join(ROOT, "eval", "reports");
const BASELINE_PATH = path.join(REPORTS_DIR, "baseline.json");

export type CheckLevel = "hard" | "soft";
export type Check = { name: string; level: CheckLevel; pass: boolean; detail: string };

/**
 * The actual generated advice text for a fixture — golden-set fixtures are
 * our own test assets (public/assets/*.png), never a real customer's photo
 * or account, so this text is safe to persist. Lets a reviewer see WHY a
 * checker passed or failed directly from the report instead of trusting a
 * paraphrase. Never populate this from anything but golden-set fixtures.
 */
export type AdviceSnapshot = {
  priorityExplanation: string;
  nextSteps: { observation: string; action: string }[];
};

export type FixtureResult = {
  id: string;
  ok: boolean; // no hard failures
  warnings: number;
  checks: Check[];
  score: number;
  band: string;
  category: string;
  uploadKind: string;
  priorityPillar: string;
  priorityFamily: string;
  isMarketingGraphic: boolean;
  latencyMs: number;
  adviceSnapshot?: AdviceSnapshot;
  /**
   * Present when this result was chosen by pickMedianResult() instead of a
   * single live draw — the score_range gate (and every other check on this
   * result) reflects the MEDIAN of 3 fresh repeats, not one stochastic call.
   */
  medianOf3?: { scores: number[]; chosen: number };
  error?: string;
};

export type EvalRun = {
  at: string;
  model: string;
  rubricVersions: { main: string; supporting: string };
  results: FixtureResult[];
  consistency?: ConsistencyResult[];
};

export type ConsistencyResult = {
  id: string;
  runs: number;
  scores: number[];
  spread: number;
  bands: string[];
  bandCrossing: boolean;
  categoryDisagreement: boolean;
  pillarDisagreement: boolean;
  familyDisagreement: boolean;
};

export function loadGoldenSet(): GoldenSet {
  const raw = JSON.parse(
    readFileSync(path.join(ROOT, "eval", "golden-set.json"), "utf8")
  );
  const { errors, set } = validateGoldenSet(raw);
  if (errors.length || !set) {
    throw new Error(`golden-set.json invalid:\n${errors.join("\n")}`);
  }
  return set;
}

function weakestPillar(rubric: RubricJson): string {
  const entries = Object.entries(rubric.pillars) as [string, number][];
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}

function priorityPillarOf(rubric: RubricJson): string {
  const explicit = (rubric as Record<string, unknown>).priority_pillar;
  return typeof explicit === "string" && explicit.length > 0
    ? explicit
    : weakestPillar(rubric);
}

function priorityFamilyOf(rubric: RubricJson): string {
  const explicit = (rubric as Record<string, unknown>).priority_issue_family;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return issueFamilyOf(`${rubric.priority_action} ${rubric.priority_explanation}`);
}

function adviceText(rubric: RubricJson): string {
  return [
    rubric.priority_action,
    rubric.priority_explanation,
    ...rubric.next_steps.flatMap((s) => [s.observation, s.action]),
    rubric.share_headline,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Mirror production preprocessing: the client (src/lib/client-image.ts)
 * downscales uploads to ~1024px JPEG before /api/score sees them. Raw repo PNGs
 * are 1-2MB and blow past provider token rate limits, and would also test an
 * input production never receives.
 */
async function preprocess(buffer: Buffer): Promise<{ buffer: Buffer; mime: string }> {
  const out = await sharp(buffer)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buffer: out, mime: "image/jpeg" };
}

/**
 * Whether a fixture's generated advice text may be persisted into a
 * committed eval report (Codex review, 2026-08-09: real customer fixtures
 * live under eval/fixtures/customer1/, and nothing previously stopped their
 * advice text from being written into a committed report if that path ever
 * got exercised through persistRun — it hadn't happened yet only because of
 * fixture ordering + the default MAX_LIVE_EVAL_FIXTURES budget, not because
 * of any actual guardrail). Safe by default only for fixtures shipped in
 * this repo under public/assets/ (our own test images, not anyone's
 * account), or a fixture explicitly opted in via reportSafe: true.
 */
export function isReportSafe(fixture: GoldenFixture): boolean {
  return fixture.reportSafe === true || fixture.image.startsWith("public/assets/");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runFixture(fixture: GoldenFixture): Promise<FixtureResult> {
  const started = Date.now();
  const checks: Check[] = [];
  try {
    const raw = readFileSync(path.join(ROOT, fixture.image));
    const img = await preprocess(raw);
    const attempt = async () =>
      scorePhoto({
        imageBuffer: img.buffer,
        imageMimeType: img.mime,
        systemPrompt: fixture.role === "supporting" ? GENERAL_RUBRIC_PROMPT : undefined,
        mainProductContext: fixture.main_product_context,
      });
    let rubric;
    try {
      rubric = await attempt();
    } catch (err) {
      // Provider failures (incl. rate limits) get ONE backoff retry in the
      // harness; parse failures are already retried inside scorePhoto.
      const code = (err as { code?: string })?.code;
      if (code === "vision_failed") {
        await sleep(25_000);
        rubric = await attempt();
      } else {
        throw err;
      }
    }
    const latencyMs = Date.now() - started;
    // Golds are honest raw scores: compare against the pre-calibration score so
    // the temporary near-eight presentation rule never distorts eval results.
    const score = rubric.raw_overall_score ?? rubric.overall_score;
    const band = bandOf(score);
    const e = fixture.expected;
    const strict = fixture.strictness;

    checks.push({
      name: "schema_valid",
      level: "hard",
      pass: true,
      detail: "validated by scorePhoto",
    });
    checks.push({
      name: "upload_kind",
      level: strict,
      pass: rubric.upload_kind === e.upload_kind,
      detail: `expected ${e.upload_kind}, got ${rubric.upload_kind}`,
    });
    if (e.category !== undefined) {
      checks.push({
        name: "category",
        level: strict,
        pass: rubric.detected_category === e.category,
        detail: `expected ${e.category}, got ${rubric.detected_category}`,
      });
    }
    if (e.band !== undefined) {
      checks.push({
        name: "band",
        level: strict,
        pass: band === e.band,
        detail: `expected ${e.band}, got ${band} (${score.toFixed(1)})`,
      });
    }
    if (e.score_range !== undefined) {
      const [lo, hi] = e.score_range;
      checks.push({
        name: "score_range",
        level: strict,
        pass: score >= lo && score <= hi,
        detail: `expected [${lo}, ${hi}], got ${score.toFixed(1)}`,
      });
    }
    if (e.priority_pillar !== undefined) {
      const got = priorityPillarOf(rubric);
      // Priority agreement is soft by design: a probabilistic model legitimately
      // disagrees at the margins even on locked fixtures.
      checks.push({
        name: "priority_pillar",
        level: "soft",
        pass: got === e.priority_pillar,
        detail: `expected ${e.priority_pillar}, got ${got}`,
      });
    }
    if (e.priority_issue_family !== undefined) {
      const got = priorityFamilyOf(rubric);
      checks.push({
        name: "priority_issue_family",
        level: "soft",
        pass: got === e.priority_issue_family,
        detail: `expected ${e.priority_issue_family}, got ${got}`,
      });
    }
    if (e.must_not_claim?.length) {
      const text = adviceText(rubric);
      const offenders = e.must_not_claim.filter((m) =>
        new RegExp(m, "i").test(text)
      );
      checks.push({
        name: "forbidden_claims",
        level: "hard",
        pass: offenders.length === 0,
        detail: offenders.length ? `claimed: ${offenders.join(", ")}` : "clean",
      });
    }
    if (e.generation_risk !== undefined) {
      checks.push({
        name: "generation_risk",
        level: "soft",
        pass: rubric.generation_risk === e.generation_risk,
        detail: `expected ${e.generation_risk}, got ${rubric.generation_risk}`,
      });
    }
    if (e.supporting_role !== undefined) {
      checks.push({
        name: "supporting_role",
        level: strict,
        pass: rubric.supporting_photo_role === e.supporting_role,
        detail: `expected ${e.supporting_role}, got ${rubric.supporting_photo_role}`,
      });
    }
    if (e.is_marketing_graphic !== undefined) {
      const got = rubric.is_marketing_graphic === true;
      checks.push({
        name: "is_marketing_graphic",
        level: strict,
        pass: got === e.is_marketing_graphic,
        detail: `expected ${e.is_marketing_graphic}, got ${got}`,
      });
    }

    // Advice-quality heuristics (main-v17/supporting-v12): applies to every
    // weak/mid-band result (score < 7.5), unconditional on fixture-declared
    // expectations, since the concreteness/reading-level/prop rules are
    // supposed to apply universally to weak/mid advice. Deliberately
    // approximate keyword heuristics (see eval/advice-quality.ts) — soft
    // except the jargon ban, which is unambiguous.
    if (rubric.upload_kind !== "invalid" && score < 7.5) {
      const adviceFields: Array<[string, string]> = [
        ["priority_explanation", rubric.priority_explanation],
        ...rubric.next_steps.map(
          (s, i): [string, string] => [`next_steps[${i}].observation`, s.observation]
        ),
      ];
      const jargonHits: string[] = [];
      const vagueFields: string[] = [];
      const decorativeHits: string[] = [];
      const ambiguousHits: string[] = [];
      for (const [field, text] of adviceFields) {
        const jargon = findJargon(text);
        if (jargon.length) jargonHits.push(`${field}: ${jargon.join(", ")}`);
        if (!hasConcreteSpecific(text)) vagueFields.push(field);
        const decorative = findDecorativeProp(text);
        if (decorative.length) decorativeHits.push(`${field}: ${decorative.join(", ")}`);
        const ambiguous = findAmbiguousProp(text);
        if (ambiguous.length) ambiguousHits.push(`${field}: ${ambiguous.join(", ")}`);
      }
      // Hard: exact banned-word contract, unambiguous.
      checks.push({
        name: "advice_no_jargon",
        level: "hard",
        pass: jargonHits.length === 0,
        detail: jargonHits.length ? jargonHits.join("; ") : "clean",
      });
      // Soft: keyword-heuristic proxy for "names a specific" — approximate by
      // design, never a release gate on its own. See eval/advice-quality.ts.
      checks.push({
        name: "advice_concrete",
        level: "soft",
        pass: vagueFields.length === 0,
        detail: vagueFields.length
          ? `no number/tool/surface/color found in: ${vagueFields.join(", ")}`
          : "every field names a specific",
      });
      // Soft: keyword-heuristic proxy for "no decorative prop" — approximate
      // by design, never a release gate on its own.
      checks.push({
        name: "advice_no_decorative_prop",
        level: "soft",
        pass: decorativeHits.length === 0,
        detail: decorativeHits.length ? decorativeHits.join("; ") : "clean",
      });
      // Informational only: category-ambiguous props (e.g. "spoon") that this
      // heuristic cannot resolve without knowing the product. Never fails.
      if (ambiguousHits.length) {
        checks.push({
          name: "advice_ambiguous_prop",
          level: "soft",
          pass: true,
          detail: `for review, not a failure: ${ambiguousHits.join("; ")}`,
        });
      }
    }

    return {
      id: fixture.id,
      ok: checks.every((c) => c.level !== "hard" || c.pass),
      warnings: checks.filter((c) => c.level === "soft" && !c.pass).length,
      checks,
      score,
      band,
      category: rubric.detected_category,
      uploadKind: rubric.upload_kind,
      priorityPillar: priorityPillarOf(rubric),
      priorityFamily: priorityFamilyOf(rubric),
      isMarketingGraphic: rubric.is_marketing_graphic === true,
      latencyMs,
      adviceSnapshot:
        rubric.upload_kind === "invalid" || !isReportSafe(fixture)
          ? undefined
          : {
              priorityExplanation: rubric.priority_explanation,
              nextSteps: rubric.next_steps.map((s) => ({
                observation: s.observation,
                action: s.action,
              })),
            },
    };
  } catch (err) {
    return {
      id: fixture.id,
      ok: false,
      warnings: 0,
      checks: [
        {
          name: "run",
          level: "hard",
          pass: false,
          detail: err instanceof Error ? err.message : String(err),
        },
      ],
      score: -1,
      band: "error",
      category: "error",
      uploadKind: "error",
      priorityPillar: "error",
      priorityFamily: "error",
      isMarketingGraphic: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runConsistency(
  fixtures: GoldenFixture[],
  repeats: number
): Promise<ConsistencyResult[]> {
  const out: ConsistencyResult[] = [];
  for (const f of fixtures) {
    const runs: FixtureResult[] = [];
    for (let i = 0; i < repeats; i++) {
      runs.push(await runFixture(f));
      await sleep(3000); // provider pacing
    }
    const scores = runs.map((r) => r.score);
    const bands = [...new Set(runs.map((r) => r.band))];
    out.push({
      id: f.id,
      runs: repeats,
      scores,
      spread: Math.max(...scores) - Math.min(...scores),
      bands,
      bandCrossing: bands.length > 1,
      categoryDisagreement: new Set(runs.map((r) => r.category)).size > 1,
      pillarDisagreement: new Set(runs.map((r) => r.priorityPillar)).size > 1,
      familyDisagreement: new Set(runs.map((r) => r.priorityFamily)).size > 1,
    });
  }
  return out;
}

/**
 * Checks whose value is a direct function of THIS run's own score, so it's
 * correct (and required) for them to follow the median run specifically —
 * evaluating them against a union of all 3 runs would be incoherent (e.g.
 * "band" mismatches would fire just because a differently-scored run landed
 * in a different band, not because of any real defect). Every OTHER check
 * name is independent of score and must be unioned across all 3 runs — see
 * pickMedianResult below.
 */
const SCORE_DERIVED_CHECK_NAMES = new Set(["score_range", "band"]);

/**
 * Deterministic median-of-3 aggregation, pure (no I/O) so it's unit-testable
 * without a live call.
 *
 * Codex review, 2026-08-09 (real bug, not hypothetical): the first version
 * of this function returned `{ ...median }` wholesale, which discarded the
 * OTHER two runs' checks entirely. A model draw is a full independent
 * generation each time — if run A (say, the lowest-scoring of the 3) had a
 * genuine hard failure unrelated to score (wrong category, wrong
 * upload_kind, a jargon word slipping back in, a busted schema), and the
 * MEDIAN run happened to be clean, the whole gate would silently report
 * "pass" and that real failure would vanish. Fixed: score-derived checks
 * (score_range, band) still come from the median run specifically — that's
 * the whole point of gating on the median instead of one draw. Every other
 * check name is unioned: if ANY of the 3 runs has a failing check (hard OR
 * soft) that the median run's own check list doesn't already flag under the
 * same name, it's appended so it can't be silently lost. `ok` and
 * `warnings` are recomputed from the resulting aggregated check list, not
 * copied from the median run alone.
 */
export function pickMedianResult(
  runs: [FixtureResult, FixtureResult, FixtureResult]
): FixtureResult {
  const sorted = [...runs].sort((a, b) => a.score - b.score);
  const median = sorted[1];

  const aggregatedChecks: Check[] = [...median.checks];
  for (const run of runs) {
    for (const check of run.checks) {
      if (SCORE_DERIVED_CHECK_NAMES.has(check.name)) continue;
      if (check.pass) continue;
      const alreadyFlagged = aggregatedChecks.some(
        (c) => c.name === check.name && !c.pass
      );
      if (alreadyFlagged) continue;
      const fromOtherRun = run !== median;
      aggregatedChecks.push(
        fromOtherRun
          ? { ...check, detail: `[from a non-median run, score=${run.score}] ${check.detail}` }
          : check
      );
    }
  }

  return {
    ...median,
    checks: aggregatedChecks,
    ok: aggregatedChecks.every((c) => c.level !== "hard" || c.pass),
    warnings: aggregatedChecks.filter((c) => c.level === "soft" && !c.pass).length,
    medianOf3: { scores: runs.map((r) => r.score), chosen: median.score },
  };
}

/**
 * The release gate for a fixture. Score-range checks are evaluated against a
 * SINGLE live draw by default, which produces exactly the "hard gate that
 * gets manually waived on a bad draw" problem Codex flagged (candle-pink-
 * improved-01 at 7.3 vs a 7.5 threshold, when the fixture's own history
 * swings 7.1-8.4). Fixtures the golden set already flags as stochastic
 * (`consistency: true` — the same flag `runConsistency` above uses for its
 * separate reporting pass) run 3 fresh times here and gate on the MEDIAN
 * score instead of one draw, so a single unlucky call can no longer flip a
 * hard pass/fail on its own. Stable fixtures (no known variance) stay a
 * single call — tripling cost on fixtures with no evidence of wobble buys
 * nothing.
 */
export async function runFixtureForGate(fixture: GoldenFixture): Promise<FixtureResult> {
  if (!fixture.consistency) return runFixture(fixture);
  const runs = [await runFixture(fixture)];
  await sleep(3000);
  runs.push(await runFixture(fixture));
  await sleep(3000);
  runs.push(await runFixture(fixture));
  return pickMedianResult(runs as [FixtureResult, FixtureResult, FixtureResult]);
}

// ---------------------------------------------------------------------------
// Baseline comparison + reporting
// ---------------------------------------------------------------------------

export type Comparison = {
  regressions: string[];
  improvements: string[];
};

export function compareToBaseline(run: EvalRun, baseline: EvalRun): Comparison {
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const cur of run.results) {
    const prev = baseline.results.find((r) => r.id === cur.id);
    if (!prev) continue;
    for (const check of cur.checks) {
      const prevCheck = prev.checks.find((c) => c.name === check.name);
      if (!prevCheck) continue;
      if (prevCheck.pass && !check.pass) {
        regressions.push(
          `${cur.id} :: ${check.name} [${check.level}] — ${check.detail}`
        );
      } else if (!prevCheck.pass && check.pass) {
        improvements.push(`${cur.id} :: ${check.name}`);
      }
    }
  }
  return { regressions, improvements };
}

export function loadBaseline(): EvalRun | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as EvalRun;
}

export function buildReportMd(run: EvalRun, comparison: Comparison | null): string {
  const total = run.results.length;
  const passed = run.results.filter((r) => r.ok).length;
  const lines: string[] = [];
  lines.push(`# Scoring eval — ${run.at}`);
  lines.push("");
  lines.push(`Model: ${run.model} · rubric ${run.rubricVersions.main} / ${run.rubricVersions.supporting}`);
  lines.push("");
  lines.push(`**${passed}/${total} fixtures pass (hard checks).** Soft warnings: ${run.results.reduce((a, r) => a + r.warnings, 0)}.`);
  lines.push("");
  lines.push("| Fixture | OK | Score | Band | Category | Priority | Family | ms |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of run.results) {
    lines.push(
      `| ${r.id} | ${r.ok ? "✅" : "❌"}${r.warnings ? ` (${r.warnings}⚠)` : ""} | ${r.score.toFixed(1)} | ${r.band} | ${r.category} | ${r.priorityPillar} | ${r.priorityFamily} | ${r.latencyMs} |`
    );
  }
  lines.push("");
  const failing = run.results.filter((r) => !r.ok || r.warnings > 0);
  if (failing.length) {
    lines.push("## Failing / warning checks");
    for (const r of failing) {
      for (const c of r.checks.filter((c) => !c.pass)) {
        lines.push(`- ${r.id} :: ${c.name} [${c.level}] — ${c.detail}`);
      }
    }
    lines.push("");
  }
  // Auditability: the actual generated text for every fixture with any
  // failing/warning check, so a reviewer can see exactly why a checker
  // passed or failed instead of trusting a paraphrase. Golden-set fixtures
  // only — never real customer photos or accounts — so this is safe to
  // persist in the report.
  const failingWithAdvice = failing.filter((r) => r.adviceSnapshot);
  if (failingWithAdvice.length) {
    lines.push("## Advice text (for review — golden-set fixtures only, no customer data)");
    for (const r of failingWithAdvice) {
      const snap = r.adviceSnapshot!;
      lines.push(`### ${r.id}`);
      lines.push(`priority_explanation: ${JSON.stringify(snap.priorityExplanation)}`);
      snap.nextSteps.forEach((s, i) => {
        lines.push(`next_steps[${i}].observation: ${JSON.stringify(s.observation)}`);
        lines.push(`next_steps[${i}].action: ${JSON.stringify(s.action)}`);
      });
      lines.push("");
    }
  }
  const medianGated = run.results.filter((r) => r.medianOf3);
  if (medianGated.length) {
    lines.push("## Median-of-3 gated fixtures (score_range evaluated on the median, not one draw)");
    lines.push("| Fixture | 3 scores | Median (used for the gate) |");
    lines.push("|---|---|---|");
    for (const r of medianGated) {
      lines.push(
        `| ${r.id} | ${r.medianOf3!.scores.map((s) => s.toFixed(1)).join(", ")} | ${r.medianOf3!.chosen.toFixed(1)} |`
      );
    }
    lines.push("");
  }
  if (run.consistency?.length) {
    lines.push("## Repeat-run consistency");
    lines.push("| Fixture | Runs | Scores | Spread | Band crossing | Pillar/Family/Category disagreement |");
    lines.push("|---|---|---|---|---|---|");
    for (const c of run.consistency) {
      lines.push(
        `| ${c.id} | ${c.runs} | ${c.scores.map((s) => s.toFixed(1)).join(", ")} | ${c.spread.toFixed(1)} | ${c.bandCrossing ? "YES" : "no"} | ${[c.pillarDisagreement, c.familyDisagreement, c.categoryDisagreement].map((d) => (d ? "Y" : "n")).join("/")} |`
      );
    }
    lines.push("");
  }
  if (comparison) {
    lines.push("## Versus baseline");
    lines.push(`Regressions: ${comparison.regressions.length}`);
    for (const r of comparison.regressions) lines.push(`- REGRESSION: ${r}`);
    lines.push(`Improvements: ${comparison.improvements.length}`);
    for (const i of comparison.improvements) lines.push(`- improved: ${i}`);
    lines.push("");
  }
  lines.push("## Known dataset gaps");
  lines.push(
    "Only candle-family + invalid + wrong-product fixtures have real images (see eval/golden-set.json notes). Apparel, wall art, home decor, vintage, bags, personalized, jewelry, soap, mugs, plush, all digital categories, and most supporting roles are UNCOVERED — scoring quality for those is not validated. See the acquisition plan in docs/PHOTO_AUDIT_RUBRIC.md eval section."
  );
  return lines.join("\n");
}

export function persistRun(run: EvalRun, comparison: Comparison | null): {
  savedAsBaseline: boolean;
  jsonPath: string;
  mdPath: string;
} {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = run.at.replace(/[:.]/g, "-");
  const jsonPath = path.join(REPORTS_DIR, `run-${stamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `run-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  writeFileSync(mdPath, buildReportMd(run, comparison));
  let savedAsBaseline = false;
  if (!existsSync(BASELINE_PATH)) {
    // Never silently overwritten: creating the baseline only happens when none
    // exists. Replacing it is a deliberate manual delete/rename.
    writeFileSync(BASELINE_PATH, JSON.stringify(run, null, 2));
    writeFileSync(path.join(REPORTS_DIR, "baseline.md"), buildReportMd(run, null));
    savedAsBaseline = true;
  }
  return { savedAsBaseline, jsonPath, mdPath };
}

export function runMeta(): Pick<EvalRun, "at" | "model" | "rubricVersions"> {
  return {
    at: new Date().toISOString(),
    model: getVisionModel(),
    rubricVersions: { main: RUBRIC_VERSION, supporting: SUPPORTING_RUBRIC_VERSION },
  };
}
