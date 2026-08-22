import { describe, expect, it } from "vitest";
import {
  buildPlanRegistry,
  getPlanPolicy,
  isAvailableForNewCheckout,
  resolvePlan,
  type PlanKey,
  type BillingCadence,
  type PlanRegistryConfig,
} from "../src/lib/plans";

const FULL_CONFIG: PlanRegistryConfig = {
  legacyPriceId: "price_legacy_19",
  starterMonthlyPriceId: "price_starter_monthly",
  starterAnnualPriceId: "price_starter_annual",
  shopMonthlyPriceId: "price_shop_monthly",
  shopAnnualPriceId: "price_shop_annual",
  powerMonthlyPriceId: "price_power_monthly",
  powerAnnualPriceId: "price_power_annual",
};

describe("plan registry", () => {
  it("resolves the old STRIPE_PRICE_ID to legacy", () => {
    const registry = buildPlanRegistry(FULL_CONFIG);
    expect(resolvePlan(registry, "price_legacy_19")).toEqual({
      planKey: "legacy",
      cadence: "monthly",
    });
  });

  it("legacy is never available for new checkout, and carries no policy", () => {
    expect(isAvailableForNewCheckout("legacy", "monthly")).toBe(false);
    expect(getPlanPolicy("legacy", "monthly")).toBeNull();
  });

  it("resolves all six new price variables to the correct plan and cadence", () => {
    const registry = buildPlanRegistry(FULL_CONFIG);
    const expectations: [string, PlanKey, BillingCadence][] = [
      ["price_starter_monthly", "starter", "monthly"],
      ["price_starter_annual", "starter", "annual"],
      ["price_shop_monthly", "shop", "monthly"],
      ["price_shop_annual", "shop", "annual"],
      ["price_power_monthly", "power", "monthly"],
      ["price_power_annual", "power", "annual"],
    ];
    for (const [priceId, planKey, cadence] of expectations) {
      expect(resolvePlan(registry, priceId)).toEqual({ planKey, cadence });
    }
  });

  it("asserts the exact approved prices, in cents", () => {
    expect(getPlanPolicy("starter", "monthly")?.priceCents).toBe(2900);
    expect(getPlanPolicy("starter", "annual")?.priceCents).toBe(29000);
    expect(getPlanPolicy("shop", "monthly")?.priceCents).toBe(5900);
    expect(getPlanPolicy("shop", "annual")?.priceCents).toBe(59000);
    expect(getPlanPolicy("power", "monthly")?.priceCents).toBe(9900);
    expect(getPlanPolicy("power", "annual")?.priceCents).toBe(99000);
  });

  it("asserts the exact active-listing limits", () => {
    expect(getPlanPolicy("starter", "monthly")?.activeListingLimit).toBe(5);
    expect(getPlanPolicy("shop", "monthly")?.activeListingLimit).toBe(15);
    expect(getPlanPolicy("power", "monthly")?.activeListingLimit).toBe(40);
  });

  it("annual plans keep the same active-listing limit as their monthly counterpart", () => {
    expect(getPlanPolicy("starter", "annual")?.activeListingLimit).toBe(
      getPlanPolicy("starter", "monthly")?.activeListingLimit
    );
    expect(getPlanPolicy("shop", "annual")?.activeListingLimit).toBe(
      getPlanPolicy("shop", "monthly")?.activeListingLimit
    );
    expect(getPlanPolicy("power", "annual")?.activeListingLimit).toBe(
      getPlanPolicy("power", "monthly")?.activeListingLimit
    );
  });

  it("unknown price ids fail closed (resolve to null, never a guess)", () => {
    const registry = buildPlanRegistry(FULL_CONFIG);
    expect(resolvePlan(registry, "price_never_configured")).toBeNull();
    expect(resolvePlan(registry, "")).toBeNull();
    expect(resolvePlan(registry, null)).toBeNull();
    expect(resolvePlan(registry, undefined)).toBeNull();
  });

  it("empty-string environment values are ignored, same as unset", () => {
    const registry = buildPlanRegistry({
      legacyPriceId: "",
      starterMonthlyPriceId: "   ",
      shopMonthlyPriceId: "price_shop_monthly",
    });
    expect(resolvePlan(registry, "")).toBeNull();
    expect(registry.size).toBe(1);
    expect(resolvePlan(registry, "price_shop_monthly")).toEqual({
      planKey: "shop",
      cadence: "monthly",
    });
  });

  it("duplicate price ids across different plan/cadence slots fail explicitly", () => {
    expect(() =>
      buildPlanRegistry({
        starterMonthlyPriceId: "price_dupe",
        shopMonthlyPriceId: "price_dupe",
      })
    ).toThrow(/misconfiguration/i);
  });

  it("the same price id repeated for the same plan/cadence slot does not throw", () => {
    expect(() =>
      buildPlanRegistry({
        starterMonthlyPriceId: "price_same",
      })
    ).not.toThrow();
  });

  it("no plan policy contains any AI-credit field", () => {
    const forbidden = ["aiCredits", "creditsPerCycle", "credits", "creditPool"];
    const combos: [PlanKey, BillingCadence][] = [
      ["starter", "monthly"],
      ["starter", "annual"],
      ["shop", "monthly"],
      ["shop", "annual"],
      ["power", "monthly"],
      ["power", "annual"],
    ];
    for (const [planKey, cadence] of combos) {
      const policy = getPlanPolicy(planKey, cadence);
      expect(policy).not.toBeNull();
      const keys = Object.keys(policy as object);
      for (const field of forbidden) {
        expect(keys).not.toContain(field);
      }
    }
  });

  it("does not mutate process.env", () => {
    const before = { ...process.env };
    buildPlanRegistry(FULL_CONFIG);
    expect(process.env).toEqual(before);
  });

  it("building with zero configured variables does not throw, returns an empty registry", () => {
    const registry = buildPlanRegistry({});
    expect(registry.size).toBe(0);
    expect(resolvePlan(registry, "anything")).toBeNull();
  });

  it("missing future-tier variables do not prevent already-configured ones from resolving", () => {
    const registry = buildPlanRegistry({
      legacyPriceId: "price_legacy_19",
      // starter/shop/power all left unset -- simulates a deploy mid-rollout.
    });
    expect(resolvePlan(registry, "price_legacy_19")).toEqual({
      planKey: "legacy",
      cadence: "monthly",
    });
    expect(registry.size).toBe(1);
  });
});
