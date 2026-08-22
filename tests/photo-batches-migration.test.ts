import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve("supabase/migrations/0025_photo_batches.sql"),
  "utf8"
);

/**
 * Structural checks for the bulk-upload batch coordination tables and
 * functions (Codex review, 2026-08-22). Real concurrency/atomicity behavior
 * needs an integration test against a live Postgres instance to fully
 * verify (advisory locks, partial unique indexes under concurrent writers)
 * -- that is a known, disclosed gap in this stage's test coverage, not
 * something these string checks can cover on their own.
 */
describe("0025_photo_batches migration invariants", () => {
  it("scopes batch idempotency per user, not globally", () => {
    expect(sql).toContain("unique (user_id, idempotency_key)");
    expect(sql).not.toMatch(/idempotency_key\s+text\s+not\s+null\s+unique/);
  });

  it("enables RLS on both tables with zero policies (service-role only access)", () => {
    expect(sql).toContain("alter table public.photo_batches enable row level security");
    expect(sql).toContain("alter table public.photo_batch_items enable row level security");
    expect(sql).not.toMatch(/create policy[^\n]+photo_batch/);
  });

  it("guarantees at most one effective main per batch via a partial unique index", () => {
    expect(sql).toContain("create unique index photo_batch_items_one_main_uidx");
    expect(sql).toContain("where effective_role = 'main'");
  });

  it("keeps role (requested) and effective_role (actually scored) as separate columns", () => {
    expect(sql).toContain("role           text not null check (role in ('main','supporting'))");
    expect(sql).toContain("effective_role text check (effective_role in ('main','supporting'))");
  });

  it("does not duplicate rating state on the batch item -- only upload state", () => {
    expect(sql).toMatch(/status\s+text not null default 'reserved'\s*\n\s*check \(status in \('reserved','uploaded','failed'\)\)/);
    expect(sql).not.toContain("'queued','scoring','completed'");
  });

  it("all four batch functions are service-role only", () => {
    for (const fn of [
      "init_photo_batch(uuid, text, text, jsonb)",
      "ensure_batch_product(uuid, uuid)",
      "resolve_batch_item_role(uuid, uuid, uuid)",
      "finalize_photo_batch(uuid, uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`);
    }
  });

  it("init_photo_batch is idempotent per (user, idempotency_key) and validates 2-10 items with exactly one main", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_idempotency_key, 0))");
    expect(sql).toContain("if found then");
    expect(sql).toContain("if v_count < 2 or v_count > 10 then");
    expect(sql).toContain("if v_main_count <> 1 then");
    expect(sql).toContain("if v_distinct_positions <> v_count then");
    expect(sql).toContain("idempotency payload mismatch");
  });

  it("ensure_batch_product is advisory-locked per batch so concurrent first uploads create exactly one product", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1))");
    expect(sql).toContain("if v_product_id is not null then");
    expect(sql).toContain("return v_product_id;");
  });

  it("resolve_batch_item_role only promotes when no effective main exists and the declared main failed", () => {
    expect(sql).toContain("effective_role = 'main'");
    expect(sql).toContain("if v_main_item is null and (v_role = 'main' or v_main_failed) then");
    expect(sql).toContain("status = 'failed'");
  });

  it("defers product creation until the first real upload and removes an empty failed product", () => {
    const initStart = sql.indexOf("create or replace function public.init_photo_batch");
    const ensureStart = sql.indexOf("create or replace function public.ensure_batch_product");
    const resolverStart = sql.indexOf("create or replace function public.resolve_batch_item_role");
    const initBody = sql.slice(initStart, ensureStart);
    const ensureBody = sql.slice(ensureStart, resolverStart);
    expect(initBody).not.toContain("insert into products");
    expect(ensureBody).toContain("insert into products");
    expect(sql).toContain("delete from products where id = v_batch.product_id and user_id = p_user");
  });

  it("finalizes only terminal batches and distinguishes completed from failed", () => {
    expect(sql).toContain("if v_reserved > 0 then");
    expect(sql).toContain("elsif v_uploaded > 0 and v_main = 1 then");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("status = 'failed'");
  });

  it("photo_batch_items has per-batch uniqueness on request_id, position, and photo_id", () => {
    expect(sql).toContain("unique (batch_id, request_id)");
    expect(sql).toContain("unique (batch_id, position)");
    expect(sql).toContain("unique (batch_id, photo_id)");
  });
});
