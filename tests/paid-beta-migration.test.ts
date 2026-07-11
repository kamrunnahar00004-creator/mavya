import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve("supabase/migrations/0006_paid_beta.sql"),
  "utf8"
);

/**
 * Structural checks that the paid-beta migration keeps the trust boundaries:
 * the browser can never write billing or allowance state, allowances are
 * atomic + service-role-only, and workflow bounds live in the database.
 */
describe("0006_paid_beta migration invariants", () => {
  it("removes free signup credits", () => {
    expect(sql).toContain(
      "alter table public.profiles alter column credits set default 0"
    );
  });

  it("subscriptions are read-own only (no browser write policies)", () => {
    expect(sql).toContain('create policy "subscriptions_select_own"');
    expect(sql).not.toMatch(/create policy "subscriptions_(insert|update|delete)/);
  });

  it("billing_events has RLS with no policies (webhook replay ledger, server only)", () => {
    expect(sql).toContain("create table if not exists public.billing_events");
    expect(sql).toContain("alter table public.billing_events enable row level security");
    expect(sql).not.toContain('create policy "billing_events');
  });

  it("allowance functions are service-role only", () => {
    expect(sql).toContain(
      "revoke all on function public.consume_allowance(uuid, text, text, integer, text, uuid) from public, anon, authenticated"
    );
    expect(sql).toContain(
      "grant execute on function public.consume_allowance(uuid, text, text, integer, text, uuid) to service_role"
    );
    expect(sql).toContain("grant execute on function public.refund_allowance(text) to service_role");
  });

  it("allowance consumption is idempotent and limit-bounded", () => {
    expect(sql).toContain("idempotency_key text not null unique");
    expect(sql).toContain("assessments_used < p_limit");
    expect(sql).toContain("workflows_used < p_limit");
  });

  it("bounds workflows in the database: max 3 attempts, one active refinement", () => {
    expect(sql).toContain("check (attempt_number between 1 and 3)");
    expect(sql).toContain("generation_jobs_one_active_refinement");
    expect(sql).toContain("where attempt_number > 1");
  });

  it("supports the refine operation and candidate-level records", () => {
    expect(sql).toContain("check (operation in ('improve', 'edit', 'retry', 'refine'))");
    for (const col of [
      "workflow_id",
      "attempt_number",
      "parent_job_id",
      "raw_score",
      "calibrated_score",
      "calibration_rule",
      "provider_request_id",
      "provider_usage",
      "estimated_cost_usd",
      "latency_ms",
      "allowance_key",
      "unresolved_issues",
    ]) {
      expect(sql).toContain(col);
    }
  });

  it("manual selection is a first-class column", () => {
    expect(sql).toContain("selection_source");
    expect(sql).toContain("check (selection_source in ('auto', 'user'))");
  });

  it("evaluation consent is explicit opt-in, default OFF", () => {
    expect(sql).toContain("eval_consent boolean not null default false");
  });

  it("workflow feedback is read-own only (writes via server route)", () => {
    expect(sql).toContain('create policy "workflow_feedback_select_own"');
    expect(sql).not.toMatch(/create policy "workflow_feedback_(insert|update|delete)/);
  });
});
