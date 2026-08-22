import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/billing/checkout/route.ts", "utf8");

/**
 * Structural/contract checks for the plan-aware checkout route (slice 2,
 * 2026-08-22). This repo has no request-mocking harness for Next.js route
 * handlers, so route-level guarantees are verified the same way the rest of
 * this codebase already does it (durable-rating-jobs.test.ts,
 * photo-batch-routes.test.ts): proving the mechanism exists in source, not
 * mocking a live request. Pure logic (plan resolution itself) is covered
 * directly in tests/plans.test.ts.
 */
describe("billing checkout route contract", () => {
  it("parses only planKey and cadence from the request body", () => {
    expect(route).toContain("b.planKey");
    expect(route).toContain("b.cadence");
  });

  it("never reads a client-supplied priceId, priceCents, activeListingLimit, or status", () => {
    for (const forbidden of ["b.priceId", "b.priceCents", "b.activeListingLimit", "b.status", "body.priceId"]) {
      expect(route).not.toContain(forbidden);
    }
  });

  it("restricts planKey to the three purchasable plans, never legacy", () => {
    expect(route).toContain('new Set<string>(["starter", "shop", "power"])');
    expect(route).not.toMatch(/PURCHASABLE_PLAN_KEYS[^\n]*legacy/);
  });

  it("restricts cadence to monthly and annual", () => {
    expect(route).toContain('new Set<string>(["monthly", "annual"])');
  });

  it("returns bad_request for invalid JSON and for a malformed/unrecognized choice", () => {
    expect(route).toContain('return apiError("bad_request", "Invalid request body.")');
    expect(route).toContain('return apiError("bad_request", "Choose a valid plan and billing cadence.")');
  });

  it("resolves the real price server-side via resolveCheckoutPlan, never a raw env price directly", () => {
    expect(route).toContain("resolveCheckoutPlan(getPlanRegistry(), choice.planKey, choice.cadence)");
    expect(route).not.toContain("getStripePriceId");
  });

  it("fails closed without leaking configuration details when a plan cannot resolve", () => {
    const resolveIndex = route.indexOf("resolveCheckoutPlan(getPlanRegistry()");
    const failClosedIndex = route.indexOf("if (!resolved)", resolveIndex);
    const errorIndex = route.indexOf('apiError("billing_unavailable", "That plan is not available right now.")', failClosedIndex);
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(failClosedIndex).toBeGreaterThan(resolveIndex);
    expect(errorIndex).toBeGreaterThan(failClosedIndex);
  });

  it("uses the resolved price id for the actual Stripe line item, not a client value", () => {
    expect(route).toContain("line_items: [{ price: priceId, quantity: 1 }]");
    const resolvedAssignment = route.indexOf("const priceId = resolved.priceId;");
    const lineItemsIndex = route.indexOf("line_items: [{ price: priceId");
    expect(resolvedAssignment).toBeGreaterThan(-1);
    expect(lineItemsIndex).toBeGreaterThan(resolvedAssignment);
  });

  it("reuses an open checkout session only when it targets the same resolved price", () => {
    expect(route).toContain("session.metadata?.price_id === priceId");
  });

  it("records plan_key, cadence, and the resolved price_id in checkout metadata", () => {
    expect(route).toMatch(/metadata:\s*\{[^}]*plan_key:\s*choice\.planKey/s);
    expect(route).toMatch(/metadata:\s*\{[^}]*cadence:\s*choice\.cadence/s);
    expect(route).toMatch(/metadata:\s*\{[^}]*price_id:\s*priceId/s);
  });

  it("still checks entitlement.active before touching checkout at all (unchanged from before)", () => {
    expect(route).toContain("if (entitlement.active)");
    expect(route).toContain("alreadySubscribed: true");
  });

  it("still rate-limits and requires authentication (unchanged from before)", () => {
    expect(route).toContain('rateLimit(`checkout:u:${user.id}`, 5, 60_000)');
    expect(route).toContain('apiError("unauthenticated", "Log in to subscribe.")');
  });
});
