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

  it("keeps the legacy credits payload for now, transitionally", () => {
    expect(statusRoute).toContain("credits:");
    expect(statusRoute).toContain("CREDITS_PER_PERIOD");
  });

  it("still requires authentication before returning anything", () => {
    expect(statusRoute).toContain('apiError("unauthenticated", "Log in first.")');
  });
});

describe("portal availability does not depend on the new tier prices", () => {
  it("stripeConfigured() checks only the secret key and the legacy price, not any new tier variable", () => {
    expect(stripeLib).toContain("STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID");
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
