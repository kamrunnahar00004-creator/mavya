import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const statusRoute = readFileSync("src/app/api/billing/status/route.ts", "utf8");
const stripeLib = readFileSync("src/lib/stripe.ts", "utf8");
const portalRoute = readFileSync("src/app/api/billing/portal/route.ts", "utf8");

describe("billing status route contract", () => {
  it("exposes only server-derived plan fields, never a client-influenced value", () => {
    expect(statusRoute).toContain("planKey: entitlement.planKey");
    expect(statusRoute).toContain("cadence: entitlement.cadence");
    expect(statusRoute).toContain("activeListingLimit: entitlement.activeListingLimit");
  });

  it("does not fetch or expose the retired customer-facing credit meter", () => {
    expect(statusRoute).not.toContain("credits:");
    expect(statusRoute).not.toContain("CREDITS_PER_PERIOD");
    expect(statusRoute).not.toContain("getAllowanceUsage");
  });

  it("still requires authentication before returning anything", () => {
    expect(statusRoute).toContain('apiError("unauthenticated", "Log in first.")');
  });
});

describe("portal availability does not depend on the new tier prices", () => {
  it("stripeConfigured() checks only the secret key, not any price variable", () => {
    expect(stripeLib).toContain("Boolean(process.env.STRIPE_SECRET_KEY)");
    for (const tierVar of [
      "STRIPE_PRICE_STARTER_MONTHLY",
      "STRIPE_PRICE_STARTER_ANNUAL",
      "STRIPE_PRICE_SHOP_MONTHLY",
      "STRIPE_PRICE_SHOP_ANNUAL",
      "STRIPE_PRICE_POWER_MONTHLY",
      "STRIPE_PRICE_POWER_ANNUAL",
    ]) {
      expect(stripeLib).not.toContain(tierVar);
    }
  });

  it("STRIPE_PRICE_ID is preserved as the legacy compatibility variable, STRIPE_PRICE_FOUNDING does not exist", () => {
    expect(stripeLib).toContain("STRIPE_PRICE_ID");
    expect(stripeLib).not.toContain("STRIPE_PRICE_FOUNDING");
  });

  it("the portal route only gates on stripeConfigured(), unaffected by tier rollout state", () => {
    expect(portalRoute).toContain("if (!stripeConfigured())");
  });
});

describe("entitlement lookup fails closed even when registry construction throws", () => {
  const entitlements = readFileSync("src/lib/entitlements.ts", "utf8");

  it("uses an empty registry in the catch instead of rebuilding the failed registry", () => {
    const catchIndex = entitlements.indexOf("} catch (err)");
    const catchBody = entitlements.slice(catchIndex);
    expect(catchBody).toContain("entitlementFromRow(null, EMPTY_PLAN_REGISTRY)");
    expect(catchBody).not.toContain("getPlanRegistry()");
  });
});
