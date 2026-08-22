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
const backstopMigration = read("supabase/migrations/0027_allowance_backstop.sql");
const allowances = read("src/lib/allowances.ts");
const scoreRoute = read("src/app/api/score/route.ts");
const generateRoute = read("src/app/api/generate/route.ts");
const billingStatus = read("src/app/api/billing/status/route.ts");
const subscribePage = read("src/app/(app)/subscribe/page.tsx");
const settingsPage = read("src/app/(app)/settings/page.tsx");
const refinement = read("src/lib/refinement.ts");

describe("shared monthly credit policy", () => {
  it("uses one high-ceiling credit balance with internal action costs", () => {
    // 2026-08-22: raised from 1,000 to a practically-unlimited abuse backstop
    // -- the active-listing-slot model (0026) is the real product limit now.
    // No real seller can plausibly reach this; it exists only so the
    // charge/refund/idempotency machinery (stale-job recovery, keep-better
    // floors, the refinement starvation backstop) never needs restructuring.
    expect(CREDITS_PER_PERIOD).toBe(100_000);
    expect(RATING_COST).toBe(10);
    expect(WORKFLOW_COST).toBe(20);
  });

  it("accepts the final valid action and rejects an over-limit action", () => {
    const canSpend = (used: number, cost: number) =>
      used + cost <= CREDITS_PER_PERIOD;

    expect(canSpend(CREDITS_PER_PERIOD - RATING_COST, RATING_COST)).toBe(true);
    expect(canSpend(CREDITS_PER_PERIOD - RATING_COST + 1, RATING_COST)).toBe(false);
    expect(canSpend(CREDITS_PER_PERIOD - WORKFLOW_COST, WORKFLOW_COST)).toBe(true);
    expect(canSpend(CREDITS_PER_PERIOD - WORKFLOW_COST + 1, WORKFLOW_COST)).toBe(false);
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

  it("keeps the internal ledger out of the customer billing-status contract", () => {
    expect(billingStatus).not.toContain("credits: {");
    expect(billingStatus).not.toContain("CREDITS_PER_PERIOD");
    expect(billingStatus).not.toContain("allowances:");
  });

  it("updates the SQL contract before the app sends the high backstop", () => {
    expect(backstopMigration).toContain("p_limit not in (1000, 100000)");
    expect(backstopMigration).toContain("(credits_used + p_cost) <= p_limit");
    expect(backstopMigration).toContain("revoke all on function public.consume_monthly_credits");
    expect(backstopMigration).toContain("grant execute on function public.consume_monthly_credits");
  });

  it("uses the exact action-specific exhaustion messages", () => {
    expect(scoreRoute).toContain('"Your rating credit ran out"');
    expect(generateRoute).toContain('"Your product improvement credit ran out"');
  });

  it("does not expose credits language at all on the pricing page (slice 2, active-listing model)", () => {
    // The page used to describe the shared credit pool in friendly terms
    // ("1,000 AI credits every month"). That copy is deliberately removed
    // now that pricing is framed around active-listing slots -- credits
    // stay a backend concept only, not customer-facing anywhere here.
    expect(subscribePage).not.toMatch(/\bcredits?\b/i);
    expect(subscribePage).not.toMatch(/rating.{0,30}10 credits/i);
    expect(subscribePage).not.toMatch(/improv.{0,30}20 credits/i);
    expect(subscribePage).not.toMatch(/50 ratings|25 improvements/i);
  });

  it("only refunds a stale charged root attempt, never free refinements", () => {
    expect(refinement).toContain("(job.attempt_number ?? 1) === 1");
    expect(refinement).toContain("refundAllowance(job.allowance_key)");
  });

  it("does not expose credits language at all on the settings page (2026-08-22, matches subscribe page)", () => {
    // The settings page pre-dated the active-listing-slot rework and still
    // showed a raw "N of 1000 credits remaining" meter plus a hardcoded
    // "Most Popular - $19/month" label regardless of the customer's real
    // plan. Both were leftovers, never updated when Slices 1-3 shipped.
    expect(settingsPage).not.toMatch(/\bcredits?\b/i);
    expect(settingsPage).not.toContain("Most Popular - $19/month");
    expect(settingsPage).toContain("activeListingLimit");
    expect(settingsPage).toContain("planKey");
  });
});
