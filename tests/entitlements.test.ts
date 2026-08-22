import { describe, expect, it } from "vitest";
import { entitlementFromRow, type SubscriptionRow } from "@/lib/entitlements";
import { buildPlanRegistry } from "@/lib/plans";

const LEGACY_PRICE = "price_legacy_19";
const STARTER_MONTHLY_PRICE = "price_starter_monthly";
const NOW = new Date("2026-07-12T00:00:00.000Z");

const REGISTRY = buildPlanRegistry({
  legacyPriceId: LEGACY_PRICE,
  starterMonthlyPriceId: STARTER_MONTHLY_PRICE,
  starterAnnualPriceId: "price_starter_annual",
  shopMonthlyPriceId: "price_shop_monthly",
  shopAnnualPriceId: "price_shop_annual",
  powerMonthlyPriceId: "price_power_monthly",
  powerAnnualPriceId: "price_power_annual",
});

const entitlement = (value: SubscriptionRow | null) => entitlementFromRow(value, REGISTRY, NOW);

function row(overrides: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    user_id: "u1",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    status: "active",
    price_id: LEGACY_PRICE,
    current_period_start: "2026-07-01T00:00:00.000Z",
    current_period_end: "2026-08-01T00:00:00.000Z",
    cancel_at_period_end: false,
    ...overrides,
  };
}

describe("entitlementFromRow (server-side subscription policy)", () => {
  it("no subscription row -> no AI access", () => {
    const e = entitlement(null);
    expect(e.active).toBe(false);
    expect(e.reason).toBe("no_subscription");
    expect(e.periodKey).toBeNull();
    expect(e.planKey).toBeNull();
    expect(e.activeListingLimit).toBeNull();
  });

  it("active legacy subscription -> access, 5 active-listing slots, no policy lookup needed", () => {
    const e = entitlement(row({}));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("ok");
    expect(e.periodKey).toBe("2026-07-01T00:00:00.000Z");
    expect(e.planKey).toBe("legacy");
    expect(e.cadence).toBe("monthly");
    expect(e.activeListingLimit).toBe(5);
  });

  it("active starter subscription resolves plan, cadence, and the registry's active-listing limit", () => {
    const e = entitlement(row({ price_id: STARTER_MONTHLY_PRICE }));
    expect(e.active).toBe(true);
    expect(e.planKey).toBe("starter");
    expect(e.cadence).toBe("monthly");
    expect(e.activeListingLimit).toBe(5);
  });

  it("active shop/power subscriptions resolve their own active-listing limits", () => {
    expect(entitlement(row({ price_id: "price_shop_monthly" })).activeListingLimit).toBe(15);
    expect(entitlement(row({ price_id: "price_power_monthly" })).activeListingLimit).toBe(40);
  });

  it("trialing counts as active", () => {
    expect(entitlement(row({ status: "trialing" })).active).toBe(true);
  });

  it("cancel-at-period-end keeps access until the paid period ends", () => {
    // Stripe keeps status 'active' until the period actually ends.
    const e = entitlement(row({ cancel_at_period_end: true }));
    expect(e.active).toBe(true);
    expect(e.cancelAtPeriodEnd).toBe(true);
  });

  it("past_due blocks NEW AI work with its own reason (saved data stays readable)", () => {
    const e = entitlement(row({ status: "past_due" }));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("past_due");
    expect(e.periodKey).toBeNull();
    // Plan identity still resolves even while blocked -- useful for UI, harmless.
    expect(e.planKey).toBe("legacy");
  });

  it("canceled/incomplete/unpaid/inactive -> no AI access", () => {
    for (const status of ["canceled", "incomplete", "incomplete_expired", "unpaid", "inactive"]) {
      const e = entitlement(row({ status }));
      expect(e.active).toBe(false);
      expect(e.reason).toBe("inactive");
    }
  });

  it("an 'active' row without a period start cannot mint an allowance period", () => {
    const e = entitlement(row({ current_period_start: null }));
    expect(e.active).toBe(false);
  });

  it("rejects an active subscription for an unrecognized Stripe price (fails closed)", () => {
    const e = entitlement(row({ price_id: "price_never_configured" }));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("wrong_plan");
    expect(e.planKey).toBeNull();
    expect(e.cadence).toBeNull();
    expect(e.activeListingLimit).toBeNull();
  });

  it("rejects a null price_id the same as an unrecognized one", () => {
    const e = entitlement(row({ price_id: null }));
    expect(e.reason).toBe("wrong_plan");
  });

  it("rejects a stale active row after its paid period ended", () => {
    const e = entitlement(row({ current_period_end: "2026-07-11T00:00:00.000Z" }));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("expired");
  });
});
