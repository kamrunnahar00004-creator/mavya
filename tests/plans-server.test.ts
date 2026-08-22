import { describe, expect, it } from "vitest";
import { planRegistryConfigFromEnv } from "../src/lib/plans.server";

describe("server plan registry adapter", () => {
  it("maps the exact server environment names without exposing a founding alias", () => {
    const env = {
      STRIPE_PRICE_ID: "price_legacy",
      STRIPE_PRICE_STARTER_MONTHLY: "price_sm",
      STRIPE_PRICE_STARTER_ANNUAL: "price_sa",
      STRIPE_PRICE_SHOP_MONTHLY: "price_hm",
      STRIPE_PRICE_SHOP_ANNUAL: "price_ha",
      STRIPE_PRICE_POWER_MONTHLY: "price_pm",
      STRIPE_PRICE_POWER_ANNUAL: "price_pa",
      STRIPE_PRICE_FOUNDING: "must_not_be_read",
    };

    expect(planRegistryConfigFromEnv(env)).toEqual({
      legacyPriceId: "price_legacy",
      starterMonthlyPriceId: "price_sm",
      starterAnnualPriceId: "price_sa",
      shopMonthlyPriceId: "price_hm",
      shopAnnualPriceId: "price_ha",
      powerMonthlyPriceId: "price_pm",
      powerAnnualPriceId: "price_pa",
    });
  });
});
