import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// NOTE: the "nothing selected" floor SOURCE (source_audit_id vs latest audit)
// described below was superseded by 0023 (floor-uses-latest-audit.test.ts) —
// source_audit_id was a frozen snapshot that could go stale after a rubric
// version bump re-scored the photo. This file still accurately describes what
// 0021's own migration text says; it is not the live function definition.
describe("0021 first-attempt keep-better floor (SQL)", () => {
  const sql = readFileSync(
    path.resolve(
      "supabase/migrations/0021_first_attempt_keep_better_floor.sql"
    ),
    "utf8"
  );

  it("uses the ORIGINAL audit as the floor when nothing is selected yet", () => {
    // The bug: the score check only ran when a generation was already selected.
    // Fix: fall back to the source audit's raw/overall score.
    expect(sql).toContain("v_photo.selected_generation_job_id is not null");
    expect(sql).toMatch(/else[\s\S]*from audits[\s\S]*v_candidate\.source_audit_id/);
    expect(sql).toContain("rubric->>'raw_overall_score'");
  });

  it("binds the source audit to THIS photo (defense vs stale job metadata)", () => {
    expect(sql).toMatch(
      /from audits[\s\S]*where id = v_candidate\.source_audit_id and photo_id = p_photo/
    );
  });

  it("rejects a candidate that scored at or below the floor", () => {
    expect(sql).toContain("v_candidate.raw_score <= v_current_raw");
    expect(sql).toContain("return false");
  });

  it("keeps ownership check and stays service-role only", () => {
    expect(sql).toContain("user_id = p_user");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });
});

describe("worse-first-improve never displays (client wiring)", () => {
  const workspace = readFileSync(
    path.resolve("src/components/dashboard/product-workspace.tsx"),
    "utf8"
  );

  it("hydration gates the shown preview on candidateBeatsKept", () => {
    expect(workspace).toContain("candidateBeatsKept(candScore, origScore)");
  });

  it("keeps the current version for ANY kept attempt, not just retry", () => {
    // Regression guard: the branch used to be `operation === \"retry\" && ...`,
    // so a worse FIRST improve fell through and displayed. It must key only on
    // the server's keptPrevious verdict (now: EXPLICIT === false required to
    // apply a non-edit result; see current-audit-pointer.test.ts for the
    // undefined/unknown-must-not-apply follow-up fix).
    expect(workspace).toContain("if (!isEditResult && payload.keptPrevious !== false)");
    expect(workspace).not.toContain('operation === "retry" && payload.keptPrevious');
  });

  it("gates One-click generation through oneClickGenerationAllowed", () => {
    expect(workspace).toContain(
      "oneClickGenerationAllowed({ wrongProduct, digital, graphic })"
    );
  });

  it("treats a detected marketing graphic as a graphic for gating + banner", () => {
    expect(workspace).toContain("active.isMarketingGraphic === true");
  });

  it("applies the keep-better floor in the refinement path too (no rejected resurface)", () => {
    // Regression guard for the mid-refinement refresh: the newest completed
    // attempt must clear candidateBeatsKept before it becomes the shown view.
    expect(workspace).toContain("candidateBeatsKept(newestScore, origScore)");
  });
});

describe("server enforces generation gates (never trust the browser)", () => {
  // Slice 4b (2026-08-23) moved these gates into the shared
  // generation-queue.ts primitive so /api/generate/bulk shares them too.
  const route = readFileSync(
    path.resolve("src/lib/generation-queue.ts"),
    "utf8"
  );

  it("refuses one-click/retry generation on a marketing graphic, from the audit", () => {
    expect(route).toContain(
      "originalAudit.is_marketing_graphic === true"
    );
    expect(route).toContain('operation !== "edit" && auditIsGraphic');
    expect(route).toContain("unsupported_graphic_generation");
  });

  it("refuses one-click/retry generation on a digital asset but still permits edit", () => {
    expect(route).toContain('operation !== "edit" && auditIsDigital');
  });
});
