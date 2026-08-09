/**
 * Scoring-eval harness. Runs golden-set fixtures through the REAL scoring
 * implementation (src/lib/score-photo.ts — no HTTP, no auth, no score cache, so
 * variance is visible), evaluates expectations with hard/soft tolerances, and
 * writes reports + baseline comparisons.
 *
 * Cost: every fixture run is a live gpt-4o vision call. Only invoked through
 * the env-gated live runner (eval/live-eval.test.ts) or explicitly.
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
import { findDecorativeProp, findJargon, hasConcreteSpecific } from "./advice-quality";

const ROOT = path.resolve(__dirname, "..");
export const REPORTS_DIR = path.join(ROOT, "eval", "reports");
const BASELINE_PATH = path.join(REPORTS_DIR, "baseline.json");

export type CheckLevel = "hard" | "soft";
export type Check = { name: string; level: CheckLevel; pass: boolean; detail: string };

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
      for (const [field, text] of adviceFields) {
        const jargon = findJargon(text);
        if (jargon.length) jargonHits.push(`${field}: ${jargon.join(", ")}`);
        if (!hasConcreteSpecific(text)) vagueFields.push(field);
        const decorative = findDecorativeProp(text);
        if (decorative.length) decorativeHits.push(`${field}: ${decorative.join(", ")}`);
      }
      checks.push({
        name: "advice_no_jargon",
        level: "hard",
        pass: jargonHits.length === 0,
        detail: jargonHits.length ? jargonHits.join("; ") : "clean",
      });
      checks.push({
        name: "advice_concrete",
        level: "soft",
        pass: vagueFields.length === 0,
        detail: vagueFields.length
          ? `no number/tool/surface/color found in: ${vagueFields.join(", ")}`
          : "every field names a specific",
      });
      checks.push({
        name: "advice_no_decorative_prop",
        level: "soft",
        pass: decorativeHits.length === 0,
        detail: decorativeHits.length ? decorativeHits.join("; ") : "clean",
      });
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
