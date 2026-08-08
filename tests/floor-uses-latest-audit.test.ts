import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0023 supersedes 0021's "nothing selected" floor source. Real bug: a photo
 * re-scored under a NEW rubric version after an improve was requested but
 * before it completed left generation_jobs.source_audit_id pointing at a
 * stale, no-longer-displayed audit — so the seller could see "candidate 7.1
 * vs original 5.7" while the floor silently compared against a hidden,
 * higher-scoring frozen snapshot and rejected a genuinely better candidate.
 * Fix: always float against the LATEST audit for the photo, matching exactly
 * what the UI displays as "original".
 */
describe("0023 floor uses the latest audit, not a frozen source_audit_id", () => {
  const sql = readFileSync(
    path.resolve("supabase/migrations/0023_floor_uses_latest_audit.sql"),
    "utf8"
  );

  it("the 'nothing selected' branch selects the LATEST audit for the photo", () => {
    expect(sql).toMatch(
      /else[\s\S]*from audits[\s\S]*where photo_id = p_photo[\s\S]*order by created_at desc[\s\S]*limit 1/
    );
  });

  it("no longer floors on the frozen source_audit_id snapshot", () => {
    expect(sql).not.toContain("v_candidate.source_audit_id");
  });

  it("still rejects a candidate that does not strictly beat the floor", () => {
    expect(sql).toContain("v_candidate.raw_score <= v_current_raw");
    expect(sql).toContain("return false");
  });

  it("the already-selected branch (compare against the selected job) is unchanged", () => {
    expect(sql).toMatch(
      /if v_photo\.selected_generation_job_id is not null then[\s\S]*from generation_jobs[\s\S]*where id = v_photo\.selected_generation_job_id/
    );
  });

  it("keeps ownership check and stays service-role only", () => {
    expect(sql).toContain("user_id = p_user");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });
});
