import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_PERIOD,
  RATING_COST,
  WORKFLOW_COST,
} from "@/lib/allowances";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const migration = read("supabase/migrations/0009_shared_monthly_credits.sql");
const allowances = read("src/lib/allowances.ts");
const scoreRoute = read("src/app/api/score/route.ts");
const generateRoute = read("src/app/api/generate/route.ts");
const billingStatus = read("src/app/api/billing/status/route.ts");
const subscribePage = read("src/app/(app)/subscribe/page.tsx");
const refinement = read("src/lib/refinement.ts");

describe("shared monthly credit policy", () => {
  it("uses one 1,000-credit balance with internal action costs", () => {
    expect(CREDITS_PER_PERIOD).toBe(1000);
    expect(RATING_COST).toBe(10);
    expect(WORKFLOW_COST).toBe(20);
  });

  it("accepts the final valid action and rejects an over-limit action", () => {
    const canSpend = (used: number, cost: number) =>
      used + cost <= CREDITS_PER_PERIOD;

    expect(canSpend(990, RATING_COST)).toBe(true);
    expect(canSpend(991, RATING_COST)).toBe(false);
    expect(canSpend(980, WORKFLOW_COST)).toBe(true);
    expect(canSpend(981, WORKFLOW_COST)).toBe(false);
  });

  it("adds and backfills the shared counter without dropping compatibility counters", () => {
    expect(migration).toContain("add column if not exists credits_used");
    expect(migration).toContain("coalesce(assessments_used, 0) * 10");
    expect(migration).toContain("coalesce(workflows_used, 0) * 20");
    expect(migration).not.toMatch(/drop column\s+(if exists\s+)?assessments_used/i);
    expect(migration).not.toMatch(/drop column\s+(if exists\s+)?workflows_used/i);
  });

  it("keeps shared and compatibility counters in the same atomic charge", () => {
    expect(migration).toContain("credits_used = credits_used + p_cost");
    expect(migration).toContain("then assessments_used+1");
    expect(migration).toContain("then workflows_used+1");
    expect(migration).toContain("(credits_used + p_cost) <= p_limit");
  });

  it("stores exact amounts and refunds both shared and compatibility counters", () => {
    expect(migration).toContain("when kind = 'assessment' then 10");
    expect(migration).toContain("when kind = 'workflow' then 20");
    expect(migration).toContain("credits_used = greatest(credits_used - v_amount, 0)");
    expect(migration).toContain("greatest(assessments_used-1, 0)");
    expect(migration).toContain("greatest(workflows_used-1, 0)");
    expect(migration).toContain("monthly credits usage row missing for refund");
  });

  it("serializes consume and refund and validates every existing key", () => {
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(migration).toContain("v_existing_amount <> p_cost");
    expect(migration).toContain("allowance_ledger.status in ('refunded', 'rejected')");
    expect(migration).toContain("(v_status = 'charged')");
  });

  it("keeps compatibility RPCs while the application calls the new RPCs", () => {
    expect(migration).toContain("create or replace function public.consume_allowance(");
    expect(migration).toContain("create or replace function public.refund_allowance(p_key text)");
    expect(allowances).toContain('admin.rpc("consume_monthly_credits"');
    expect(allowances).toContain('admin.rpc("refund_monthly_credits"');
  });

  it("keeps all credit mutation functions service-role-only", () => {
    for (const signature of [
      "consume_monthly_credits(uuid, text, text, integer, integer, text, uuid)",
      "refund_monthly_credits(text)",
      "consume_allowance(uuid, text, text, integer, text, uuid)",
      "refund_allowance(text)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${signature}`);
      expect(migration).toContain(`grant execute on function public.${signature}`);
    }
  });

  it("returns one unified billing status contract", () => {
    expect(billingStatus).toContain("credits: {");
    expect(billingStatus).toContain("remaining: CREDITS_PER_PERIOD - creditsUsed");
    expect(billingStatus).not.toContain("allowances:");
  });

  it("uses the exact action-specific exhaustion messages", () => {
    expect(scoreRoute).toContain('"Your rating credit ran out"');
    expect(generateRoute).toContain('"Your product improvement credit ran out"');
  });

  it("does not expose internal conversion costs on the pricing page", () => {
    expect(subscribePage).toContain("1,000 AI credits every month");
    expect(subscribePage).not.toMatch(/rating.{0,30}10 credits/i);
    expect(subscribePage).not.toMatch(/improv.{0,30}20 credits/i);
    expect(subscribePage).not.toMatch(/50 ratings|25 improvements/i);
  });

  it("only refunds a stale charged root attempt, never free refinements", () => {
    expect(refinement).toContain("(job.attempt_number ?? 1) === 1");
    expect(refinement).toContain("refundAllowance(job.allowance_key)");
  });
});
