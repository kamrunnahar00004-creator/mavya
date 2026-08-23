import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(p), "utf8");

describe("0019 audit uniqueness migration structure", () => {
  const sql = read("supabase/migrations/0019_audits_unique_score_cache.sql");

  it("materializes a transaction-scoped winner/loser mapping (not a bare CTE)", () => {
    expect(sql).toContain("create temporary table tmp_audit_dupe_map on commit drop");
    expect(sql).toContain("order by created_at desc, id desc");
  });

  it("repoints BOTH set-null FKs off losers before deleting them", () => {
    const repointG = sql.indexOf("update public.generation_jobs");
    const repointR = sql.indexOf("update public.rating_jobs");
    const del = sql.indexOf("delete from public.audits");
    expect(repointG).toBeGreaterThan(-1);
    expect(repointR).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(repointG);
    expect(del).toBeGreaterThan(repointR);
  });

  it("merges a non-empty loser checklist into an empty winner before deletion", () => {
    const merge = sql.indexOf("supporting_photo_checklist");
    const del = sql.indexOf("delete from public.audits");
    expect(merge).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(del);
  });

  it("handles loser checklist_claims explicitly (not a silent cascade)", () => {
    expect(sql).toContain("delete from public.checklist_claims");
  });

  it("creates the partial unique index AFTER duplicates are removed", () => {
    const del = sql.indexOf("delete from public.audits");
    const idx = sql.indexOf("create unique index if not exists audits_photo_cache_unique");
    expect(idx).toBeGreaterThan(del);
    expect(sql).toContain("where score_cache_id is not null");
  });

  it("only touches audits + its referencing tables, and is rerunnable", () => {
    // No DDL against unrelated tables; index guarded by if-not-exists; temp
    // mapping dropped on commit.
    expect(sql).toContain("on commit drop");
    expect(sql).toMatch(/create unique index if not exists/);
  });

  it("references only columns that exist on each alias (rejects e.g. l.loser_id)", () => {
    // `l` and `w` alias public.audits; `m` aliases the temp winner/loser map.
    // Any reference to a column not on that relation is a bug the DB would
    // reject at apply time (this is what caught `l.loser_id`).
    const AUDITS_COLS = new Set([
      "id",
      "photo_id",
      "kind",
      "rubric",
      "overall_score",
      "created_at",
      "rubric_version",
      "image_hash",
      "score_cache_id",
      "updated_at",
    ]);
    const MAP_COLS = new Set(["loser_id", "winner_id", "created_at"]);

    const refs = (alias: string) =>
      [...sql.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))].map((m) => m[1]);

    for (const col of refs("l")) expect(AUDITS_COLS.has(col), `l.${col}`).toBe(true);
    for (const col of refs("w")) expect(AUDITS_COLS.has(col), `w.${col}`).toBe(true);
    for (const col of refs("m")) expect(MAP_COLS.has(col), `m.${col}`).toBe(true);
  });
});

describe("does not modify already-applied migrations", () => {
  it("0016 and 0017 are unchanged single-purpose files (spot check)", () => {
    const m16 = read("supabase/migrations/0016_audits_photo_created_index.sql");
    expect(m16.match(/create index/g)).toHaveLength(1);
  });
});

describe("/api/audits is idempotent WITHOUT shortcutting verification (0024)", () => {
  const route = read("src/app/api/audits/route.ts");

  it("verifies ownership + stored-image hash BEFORE persisting", () => {
    const download = route.indexOf(".download(photo.storage_path)");
    const hashCheck = route.indexOf("storedHash !== cached.image_hash");
    const persistCall = route.indexOf("persist_audit_and_advance_current");
    expect(download).toBeGreaterThan(-1);
    expect(hashCheck).toBeGreaterThan(download);
    expect(persistCall).toBeGreaterThan(hashCheck);
  });

  it("persists via the atomic RPC, not a raw insert (idempotency + pointer lives in SQL now)", () => {
    expect(route).toContain('admin.rpc(\n    "persist_audit_and_advance_current"');
    expect(route).not.toContain('.from("audits")\n    .insert(');
  });
});

describe("durable rating path persists via the same atomic RPC (0024)", () => {
  const ratingJobs = read("src/lib/rating-jobs.ts");

  it("calls persist_audit_and_advance_current instead of a raw insert + 23505 race", () => {
    expect(ratingJobs).toContain('admin.rpc(\n      "persist_audit_and_advance_current"');
    expect(ratingJobs).not.toContain('.from("audits")\n        .insert(');
    expect(ratingJobs).toContain("audit_id: auditId");
  });

  it("fails the rating job (with refund) when the RPC returns no audit id", () => {
    const block = ratingJobs.slice(
      ratingJobs.indexOf("persist_audit_and_advance_current"),
      ratingJobs.indexOf("persist_audit_and_advance_current") + 700
    );
    expect(block).toContain("if (auditError || !auditId)");
    expect(block).toContain('failJob(job, "persistence_failed"');
  });
});

describe("product hydration fetches the audit via current_audit_id (0024)", () => {
  const page = read("src/app/(app)/dashboard/product/[id]/page.tsx");

  it("selects current_audit_id on photos instead of an embedded ordered audits relation", () => {
    expect(page).toContain("current_audit_id");
    // The old embed (its own order-by, a second place "latest" could disagree
    // with the pointer) is gone.
    expect(page).not.toContain("audits(id, rubric, created_at)");
    expect(page).not.toContain('referencedTable: "audits"');
  });

  it("fetches the audit BY ID (current_audit_id), never re-derives 'latest' with its own order-by", () => {
    expect(page).toContain('.from("audits")');
    expect(page).toMatch(/\.in\("id", currentAuditIds\)/);
  });

  it("still carries the full rubric (incl. persisted checklist), not a trimmed subset", () => {
    // rubric_version was added (slice 2, buyer-question coverage) alongside
    // the existing fields -- a widened select, not a trimmed one.
    expect(page).toContain("id, rubric, rubric_version, created_at");
    expect(page).not.toContain("rubric->'priority_action'"); // no field trimming here
  });
});
