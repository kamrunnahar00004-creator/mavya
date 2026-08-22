import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const migration = read("supabase/migrations/0012_durable_rating_jobs.sql");
const route = read("src/app/api/score/jobs/route.ts");
const photoPersistence = read("src/lib/photo-persistence.ts");
const worker = read("src/app/api/generate/worker/route.ts");
const ratingJobs = read("src/lib/rating-jobs.ts");
const landing = read("src/app/page.tsx");
const addProduct = read("src/components/dashboard/add-product.tsx");
const workspace = read("src/components/dashboard/product-workspace.tsx");
const dashboard = read("src/app/(app)/dashboard/page.tsx");
const productCard = read("src/components/dashboard/product-card.tsx");

describe("durable rating jobs", () => {
  it("stores server-owned jobs with user-only read access", () => {
    expect(migration).toContain("create table if not exists public.rating_jobs");
    expect(migration).toContain("check (status in ('queued', 'scoring', 'completed', 'failed', 'cancelled'))");
    expect(migration).toContain('create policy "rating_jobs_select_own"');
    expect(migration).toContain("for select using (user_id = auth.uid())");
    expect(migration).not.toMatch(/policy[^\n]+rating_jobs[^\n]+for (insert|update|delete)/i);
  });

  it("persists product and photo before queuing server scoring", () => {
    // Codex review, 2026-08-22: this insert-order logic moved out of
    // route.ts into a shared helper (photo-persistence.ts) so the batch
    // upload route can reuse the exact same persistence code instead of
    // duplicating it. The order guarantee this test protects still holds --
    // it's just enforced in the new location now.
    const productInsert = photoPersistence.indexOf('.from("products")');
    const photoInsert = photoPersistence.indexOf('.from("photos").insert');
    const jobInsert = photoPersistence.indexOf('.from("rating_jobs")', photoInsert);
    expect(productInsert).toBeGreaterThan(-1);
    expect(photoInsert).toBeGreaterThan(productInsert);
    expect(jobInsert).toBeGreaterThan(photoInsert);
    expect(route).toContain("persistPhotoAndQueueRating");
    expect(route).toContain("kickRatingWorker");
    // GET's refresh-safe poll trigger still lives in route.ts, unchanged.
    expect(route).toContain("after(async () =>");
    expect(route).toContain("runQueuedRatingOnce(job.id)");
  });

  it("routes every browser rating entry point through the durable API", () => {
    expect(landing).toContain('fetch("/api/score/jobs"');
    expect(addProduct).toContain('fetch("/api/score/jobs"');
    expect(workspace).toContain('fetch("/api/score/jobs"');
    expect(addProduct).not.toContain('fetch("/api/score"');
  });

  it("shows a persisted Rating state and refreshes when the job finishes", () => {
    // Phase A: the dashboard hydrates rating state through the compact
    // dashboard_overview() RPC (SECURITY INVOKER, RLS-scoped) instead of a
    // direct rating_jobs query; RPC failure falls back to legacy hydration.
    const overviewLib = read("src/lib/dashboard-overview.ts");
    expect(dashboard).toContain("loadDashboardOverview");
    expect(dashboard).toContain("rating_status");
    expect(overviewLib).toContain('rpc("dashboard_overview")');
    expect(overviewLib).toContain("legacyDashboardOverview");
    expect(productCard).toContain("Rating…");
    expect(productCard).toContain("window.setInterval");
    expect(productCard).toContain("router.refresh()");
  });

  it("recovers stale work and keeps expensive worker operations bounded", () => {
    expect(ratingJobs).toContain("recoverStaleRatingJobs");
    expect(ratingJobs).toContain('status: "queued"');
    expect(ratingJobs).toContain("attempt_count");
    expect(worker).toContain("recoverStaleRatingJobs");
    expect(worker).toContain("runQueuedRatingOnce");
    // One expensive AI operation per tick: rating first, then a queued
    // attempt-1 generation, then background refinement.
    expect(worker).toContain("ratingJobId ? null : await runQueuedGenerationOnce()");
    expect(worker).toContain(
      "ratingJobId || genJobId ? null : await runQueuedRefinementOnce()"
    );
  });

  it("makes cache and audit persistence idempotent across worker retries", () => {
    // score_cache idempotency (raw JS lookup) is unchanged.
    expect(ratingJobs).toContain('.eq("context_hash", contextHash)');
    // Audit persistence idempotency moved into the atomic RPC (0024): it is
    // idempotent on (photo_id, score_cache_id) inside the SQL function itself.
    expect(ratingJobs).toContain("persist_audit_and_advance_current");
    expect(ratingJobs).toContain("allowanceKey");
    expect(ratingJobs).toContain("refundAllowance(job.allowance_key)");
  });
});
