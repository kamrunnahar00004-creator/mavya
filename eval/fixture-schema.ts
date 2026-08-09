/**
 * Golden-set fixture schema + validator for the scoring eval harness.
 *
 * Fixtures live in eval/golden-set.json (reviewable data, not code). Ground
 * truth comes from founder-locked calibration entries (docs/CALIBRATION_LOG.md)
 * or explicitly-labeled softer expectations — the `strictness` field says which.
 */

import {
  ISSUE_FAMILIES,
  SUPPORTING_PHOTO_ROLES,
  type IssueFamily,
} from "@/lib/rubric";
import { DETECTED_CATEGORY_VALUES } from "@/lib/taxonomy";

export type ScoreBand = "invalid" | "weak" | "mid" | "strong";
export type PillarKeyName = "thumbnail" | "lighting" | "background" | "click_appeal";

export type GoldenFixture = {
  /** Stable fixture id, e.g. "candle-02-main". */
  id: string;
  /** Path relative to the repository root. */
  image: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  /** Scoring mode. */
  role: "main" | "supporting";
  /** For supporting fixtures: the listing context passed to the rubric. */
  main_product_context?: string;
  expected: {
    upload_kind: "physical_product" | "digital_product" | "invalid";
    /** Canonical taxonomy id (legacy-compatible values allowed). */
    category?: string;
    band?: ScoreBand;
    /** Inclusive acceptable overall range. */
    score_range?: [number, number];
    /** Expected priority/weakest pillar. */
    priority_pillar?: PillarKeyName;
    /** Expected issue family of priority_action. */
    priority_issue_family?: IssueFamily;
    /** Regexes that must NOT appear in any advice text (case-insensitive). */
    must_not_claim?: string[];
    generation_risk?: "standard" | "review_text" | "unsupported";
    supporting_role?: string;
    /** Expected is_marketing_graphic flag (detection gate for one-click). */
    is_marketing_graphic?: boolean;
  };
  /**
   * hard  = founder-locked gold (calibration log) — failures are regressions.
   * soft  = reasonable expectation without locked gold — failures are warnings.
   */
  strictness: "hard" | "soft";
  /** Include in the repeat-run consistency subset. */
  consistency?: boolean;
  /**
   * Explicit opt-in to persist this fixture's generated advice text into
   * committed eval reports (see isReportSafe in harness.ts). Not needed for
   * fixtures already under public/assets/ (safe by path); use this only to
   * override a non-public-assets path you've deliberately confirmed is safe
   * to commit. Never set this for a real customer's fixture.
   */
  reportSafe?: boolean;
  /** Human explanation of the expected judgment + provenance. */
  notes: string;
};

export type GoldenSet = {
  schema_version: 1;
  taxonomy_version: number;
  fixtures: GoldenFixture[];
};

export function validateFixture(f: unknown, index: number): string[] {
  const errs: string[] = [];
  const fx = f as Partial<GoldenFixture>;
  const where = `fixtures[${index}]${fx?.id ? ` (${fx.id})` : ""}`;

  if (!fx || typeof fx !== "object") return [`${where}: not an object`];
  if (!fx.id || typeof fx.id !== "string") errs.push(`${where}: missing id`);
  if (!fx.image || typeof fx.image !== "string") errs.push(`${where}: missing image path`);
  if (!["image/png", "image/jpeg", "image/webp"].includes(fx.mime ?? ""))
    errs.push(`${where}: bad mime`);
  if (!["main", "supporting"].includes(fx.role ?? "")) errs.push(`${where}: bad role`);
  if (!["hard", "soft"].includes(fx.strictness ?? "")) errs.push(`${where}: bad strictness`);
  if (!fx.notes || typeof fx.notes !== "string") errs.push(`${where}: notes required`);

  const e = fx.expected;
  if (!e || typeof e !== "object") {
    errs.push(`${where}: missing expected`);
    return errs;
  }
  if (!["physical_product", "digital_product", "invalid"].includes(e.upload_kind ?? ""))
    errs.push(`${where}: bad expected.upload_kind`);
  if (e.category !== undefined && !DETECTED_CATEGORY_VALUES.includes(e.category))
    errs.push(`${where}: unknown expected.category "${e.category}"`);
  if (e.band !== undefined && !["invalid", "weak", "mid", "strong"].includes(e.band))
    errs.push(`${where}: bad expected.band`);
  if (e.score_range !== undefined) {
    const [lo, hi] = e.score_range;
    if (
      !Array.isArray(e.score_range) ||
      e.score_range.length !== 2 ||
      typeof lo !== "number" ||
      typeof hi !== "number" ||
      lo > hi ||
      lo < 0 ||
      hi > 10
    )
      errs.push(`${where}: bad expected.score_range`);
    // band/range coherence
    if (e.band) {
      const bandRange: Record<ScoreBand, [number, number]> = {
        invalid: [0, 0],
        weak: [0.1, 5.9],
        mid: [6.0, 7.9],
        strong: [8.0, 10],
      };
      const [blo, bhi] = bandRange[e.band];
      if (hi < blo || lo > bhi)
        errs.push(`${where}: score_range does not overlap expected band`);
    }
  }
  if (
    e.priority_pillar !== undefined &&
    !["thumbnail", "lighting", "background", "click_appeal"].includes(e.priority_pillar)
  )
    errs.push(`${where}: bad expected.priority_pillar`);
  if (
    e.priority_issue_family !== undefined &&
    !(ISSUE_FAMILIES as readonly string[]).includes(e.priority_issue_family)
  )
    errs.push(`${where}: bad expected.priority_issue_family`);
  if (
    e.generation_risk !== undefined &&
    !["standard", "review_text", "unsupported"].includes(e.generation_risk)
  )
    errs.push(`${where}: bad expected.generation_risk`);
  if (
    e.supporting_role !== undefined &&
    !(SUPPORTING_PHOTO_ROLES as readonly string[]).includes(e.supporting_role)
  )
    errs.push(`${where}: bad expected.supporting_role`);
  if (
    e.is_marketing_graphic !== undefined &&
    typeof e.is_marketing_graphic !== "boolean"
  )
    errs.push(`${where}: bad expected.is_marketing_graphic`);
  if (e.must_not_claim !== undefined) {
    if (!Array.isArray(e.must_not_claim) || e.must_not_claim.some((m) => typeof m !== "string"))
      errs.push(`${where}: bad expected.must_not_claim`);
  }
  if (fx.role === "supporting" && !fx.main_product_context)
    errs.push(`${where}: supporting fixtures need main_product_context`);
  if (fx.reportSafe !== undefined && typeof fx.reportSafe !== "boolean")
    errs.push(`${where}: bad reportSafe (must be boolean)`);
  return errs;
}

export function validateGoldenSet(data: unknown): { errors: string[]; set?: GoldenSet } {
  const errors: string[] = [];
  const d = data as Partial<GoldenSet>;
  if (!d || typeof d !== "object") return { errors: ["golden set is not an object"] };
  if (d.schema_version !== 1) errors.push("schema_version must be 1");
  if (typeof d.taxonomy_version !== "number") errors.push("taxonomy_version required");
  if (!Array.isArray(d.fixtures) || d.fixtures.length === 0)
    errors.push("fixtures array required");
  else {
    const ids = new Set<string>();
    d.fixtures.forEach((f, i) => {
      errors.push(...validateFixture(f, i));
      const id = (f as GoldenFixture).id;
      if (id) {
        if (ids.has(id)) errors.push(`duplicate fixture id "${id}"`);
        ids.add(id);
      }
    });
  }
  return { errors, set: errors.length === 0 ? (d as GoldenSet) : undefined };
}

export function bandOf(score: number): ScoreBand {
  if (score <= 0) return "invalid";
  if (score >= 8) return "strong";
  if (score >= 6) return "mid";
  return "weak";
}

/** Coverage axes we want the golden set to eventually span. */
export const DESIRED_COVERAGE: readonly string[] = [
  ...DETECTED_CATEGORY_VALUES.filter((c) => c !== "other"),
  "supporting:scale_reference",
  "supporting:detail_closeup",
  "supporting:packaging",
  "supporting:size_chart",
  "supporting:wrong_product",
  "condition:dark",
  "condition:blurry",
  "condition:busy_background",
  "condition:product_too_small",
  "condition:crop_touching_edge",
  "condition:text_heavy",
  "condition:lifestyle",
  "condition:white_background",
  "invalid_upload",
];
