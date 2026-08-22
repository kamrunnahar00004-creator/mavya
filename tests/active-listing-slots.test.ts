import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0026_active_listing_slots.sql", "utf8");
const persistence = readFileSync("src/lib/photo-persistence.ts", "utf8");
const scoreJobsRoute = readFileSync("src/app/api/score/jobs/route.ts", "utf8");
const batchUploadRoute = readFileSync("src/app/api/photos/batch/upload/route.ts", "utf8");
const errorsLib = readFileSync("src/lib/errors.ts", "utf8");

/**
 * Structural checks for active-listing-slot enforcement (slice 3,
 * 2026-08-22). This repo has no live-Postgres concurrency harness, so the
 * serialization/race guarantees below are verified structurally -- the
 * advisory lock exists, is keyed correctly, and is taken before the count
 * check and the insert -- not by actually running concurrent transactions.
 * Stated honestly, not claimed as live concurrency testing.
 */
describe("0026_active_listing_slots migration", () => {
  it("does not edit the already-applied 0025 migration file", () => {
    const migration0025 = readFileSync("supabase/migrations/0025_photo_batches.sql", "utf8");
    // 0025 must still define the OLD 2-arg ensure_batch_product signature
    // verbatim -- 0026 only DROPS it via a separate statement, it does not
    // rewrite 0025's own text.
    expect(migration0025).toContain(
      "create or replace function public.ensure_batch_product(\n  p_batch_id uuid,\n  p_user uuid\n)"
    );
  });

  it("create_product_within_active_limit is the single source of truth: no separate slot counter table", () => {
    expect(sql).not.toMatch(/create table[^\n]*slot/i);
    expect(sql).not.toMatch(/create table[^\n]*ledger/i);
    expect(sql).toContain("select count(*) into v_count from products where user_id = p_user");
  });

  it("validates the limit defensively as a positive bounded integer, independent of the caller", () => {
    expect(sql).toContain("if p_limit is null or p_limit <= 0 or p_limit > 100000 then");
    expect(sql).toContain("raise exception 'invalid active listing limit'");
  });

  it("serializes creation per user with an advisory lock, taken before the count check", () => {
    const lockIndex = sql.indexOf(
      "perform pg_advisory_xact_lock(hashtextextended(p_user::text, 4))"
    );
    const countIndex = sql.indexOf("select count(*) into v_count", lockIndex);
    const insertIndex = sql.indexOf("insert into products", countIndex);
    expect(lockIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(countIndex);
  });

  it("uses a stable, greppable error message for slot exhaustion, distinct from any other failure", () => {
    const countIndex = sql.indexOf("select count(*) into v_count");
    const exhaustedCheck = sql.indexOf("if v_count >= p_limit then", countIndex);
    const raiseIndex = sql.indexOf("raise exception 'active_listing_limit_reached'", exhaustedCheck);
    expect(exhaustedCheck).toBeGreaterThan(countIndex);
    expect(raiseIndex).toBeGreaterThan(exhaustedCheck);
  });

  it("drops the old unsafe 2-argument ensure_batch_product before defining the new 3-argument one", () => {
    const dropIndex = sql.indexOf("drop function if exists public.ensure_batch_product(uuid, uuid);");
    const createIndex = sql.indexOf(
      "create or replace function public.ensure_batch_product(\n  p_batch_id uuid,\n  p_user uuid,\n  p_limit integer\n)",
      dropIndex
    );
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(dropIndex);
  });

  it("ensure_batch_product returns an existing product BEFORE ever calling the limit-enforcing function -- retries never re-check or re-consume a slot", () => {
    const functionStart = sql.indexOf("create or replace function public.ensure_batch_product(\n  p_batch_id uuid,\n  p_user uuid,\n  p_limit integer\n)");
    const earlyReturn = sql.indexOf("if v_product_id is not null then", functionStart);
    const createCall = sql.indexOf("create_product_within_active_limit(p_user", functionStart);
    expect(earlyReturn).toBeGreaterThan(functionStart);
    expect(createCall).toBeGreaterThan(earlyReturn);
  });

  it("ensure_batch_product and create_product_within_active_limit share one advisory-lock namespace per user, serializing cross-path races", () => {
    // ensure_batch_product locks per BATCH (seed 1); the actual product
    // creation inside create_product_within_active_limit locks per USER
    // (seed 4) -- so a batch upload and a single-photo upload for the SAME
    // user, racing for the last slot, are still serialized against each
    // other at the point that actually matters (the count+insert), even
    // though their batch-level/request-level locks differ.
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1))");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_user::text, 4))");
  });

  it("both functions are revoked from public/anon/authenticated and granted only to service_role", () => {
    for (const fn of [
      "create_product_within_active_limit(uuid, text, integer)",
      "ensure_batch_product(uuid, uuid, integer)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`);
    }
    expect(sql).toMatch(/revoke all on function[^\n]+\n\s*from public, anon, authenticated/);
  });
});

describe("both product-creation paths use the enforced RPC, never a direct insert", () => {
  it("photo-persistence.ts calls create_product_within_active_limit for a new product, not products.insert", () => {
    const branchStart = persistence.indexOf('} else if (!productId) {');
    const branchEnd = persistence.indexOf("} else {", branchStart);
    const branch = persistence.slice(branchStart, branchEnd);
    expect(branch).toContain('admin.rpc(\n        "create_product_within_active_limit"');
    expect(branch).not.toMatch(/\.from\("products"\)\s*\n?\s*\.insert\(/);
  });

  it("photo-persistence.ts fails closed on a missing/invalid limit before ever calling the RPC", () => {
    expect(persistence).toContain('typeof input.activeListingLimit !== "number" || input.activeListingLimit <= 0');
    expect(persistence).toContain('return fail("bad_request", "Missing active listing limit.", 400);');
  });

  it("photo-persistence.ts maps active_listing_limit_reached to its own distinct code, not persistence_failed", () => {
    const branchStart = persistence.indexOf('} else if (!productId) {');
    const branch = persistence.slice(branchStart, branchStart + 1500);
    expect(branch).toContain('"active_listing_limit_reached"');
    expect(branch).toContain("409");
  });

  it("the batch upload route passes p_limit into ensure_batch_product and maps its exhaustion distinctly", () => {
    expect(batchUploadRoute).toContain("p_limit: entitlement.activeListingLimit");
    expect(batchUploadRoute).toContain('"active_listing_limit_reached"');
  });
});

describe("limits are server-derived from getEntitlement(), never from request data", () => {
  it("score/jobs route passes entitlement.activeListingLimit, never a form/body field, as the limit", () => {
    expect(scoreJobsRoute).toContain("activeListingLimit: entitlement.activeListingLimit");
    expect(scoreJobsRoute).not.toMatch(/form\.get\(["']limit["']\)/);
    expect(scoreJobsRoute).not.toMatch(/form\.get\(["']activeListingLimit["']\)/);
  });

  it("score/jobs route fails closed when the entitlement resolves no plan limit", () => {
    expect(scoreJobsRoute).toContain("entitlement.activeListingLimit == null");
  });

  it("batch upload route fails closed when the entitlement resolves no plan limit", () => {
    expect(batchUploadRoute).toContain("entitlement.activeListingLimit == null");
  });

  it("neither route reads a limit from the client body", () => {
    for (const source of [scoreJobsRoute, batchUploadRoute]) {
      expect(source).not.toMatch(/body\.(limit|activeListingLimit)/);
    }
  });
});

describe("active_listing_limit_reached is a distinct, correctly-mapped API error code", () => {
  it("is declared in the ApiErrorCode union and mapped to 409", () => {
    expect(errorsLib).toContain('"active_listing_limit_reached"');
    expect(errorsLib).toContain("active_listing_limit_reached: 409");
  });
});
