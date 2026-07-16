import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("0015 reversible edit selection", () => {
  const sql = readFileSync(
    path.resolve("supabase/migrations/0015_reversible_edit_selection.sql"),
    "utf8"
  );

  it("stores a nullable alternate with an explicit presence flag", () => {
    expect(sql).toContain("alternate_generation_job_id uuid");
    expect(sql).toContain("has_alternate_generation boolean not null default false");
    expect(sql).toContain("selection_is_reverted boolean not null default false");
  });

  it("an edit snapshots the exact current selection before becoming visible", () => {
    expect(sql).toMatch(
      /if p_operation = 'edit' then[\s\S]*alternate_generation_job_id = v_photo\.selected_generation_job_id[\s\S]*selected_generation_job_id = p_job/
    );
  });

  it("swaps both sides under a row lock and toggles the saved label state", () => {
    expect(sql).toMatch(/select \* into v_photo from photos where id = p_photo for update/);
    expect(sql).toMatch(
      /selected_generation_job_id = v_photo\.alternate_generation_job_id,[\s\S]*alternate_generation_job_id = v_photo\.selected_generation_job_id/
    );
    expect(sql).toContain("selection_is_reverted = not v_photo.selection_is_reverted");
  });

  it("keeps ownership, completed-job validation, and legacy score fallback", () => {
    expect(sql.match(/pr\.user_id = p_user|user_id = p_user/g)?.length).toBeGreaterThan(3);
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("candidate_rubric->>'raw_overall_score'");
    expect(sql).toContain("candidate_rubric->>'overall_score'");
  });

  it("keeps both functions service-role only", () => {
    expect(sql.match(/from public, anon, authenticated/g)).toHaveLength(2);
    expect(sql.match(/to service_role/g)).toHaveLength(2);
  });
});

describe("reversible edit hydration", () => {
  const page = readFileSync(
    path.resolve("src/app/(app)/dashboard/product/[id]/page.tsx"),
    "utf8"
  );
  const workspace = readFileSync(
    path.resolve("src/components/dashboard/product-workspace.tsx"),
    "utf8"
  );

  it("loads and signs the saved alternate job", () => {
    expect(page).toContain("alternate_generation_job_id");
    expect(page).toContain("metadata.alternateRow.result_storage_path");
    expect(page).toContain("hasAlternateGeneration: row.has_alternate_generation");
  });

  it("rehydrates the durable pre-edit snapshot", () => {
    expect(workspace).toContain("if (p.hasAlternateGeneration)");
  });

  it("the version picker persists picks through select-version (last five, Original included)", () => {
    // The swap toggle UI was superseded (founder decision, 2026-07-16) by a
    // single version picker; the 0015 swap endpoint remains server-side.
    expect(workspace).toContain(
      "body: JSON.stringify({ photoId: photo.id, jobId })"
    );
    expect(workspace).toContain("versionOptions");
    expect(workspace).toContain(".slice(-5)");
    expect(workspace).toContain('label: "Original"');
  });
});
