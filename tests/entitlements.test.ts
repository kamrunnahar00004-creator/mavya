import { describe, expect, it } from "vitest";
import { entitlementFromRow, type SubscriptionRow } from "@/lib/entitlements";

function row(overrides: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    user_id: "u1",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    status: "active",
    price_id: "price_1",
    current_period_start: "2026-07-01T00:00:00.000Z",
    current_period_end: "2026-08-01T00:00:00.000Z",
    cancel_at_period_end: false,
    ...overrides,
  };
}

describe("entitlementFromRow (server-side subscription policy)", () => {
  it("no subscription row -> no AI access", () => {
    const e = entitlementFromRow(null);
    expect(e.active).toBe(false);
    expect(e.reason).toBe("no_subscription");
    expect(e.periodKey).toBeNull();
  });

  it("active subscription -> access with the billing period as allowance key", () => {
    const e = entitlementFromRow(row({}));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("ok");
    expect(e.periodKey).toBe("2026-07-01T00:00:00.000Z");
  });

  it("trialing counts as active", () => {
    expect(entitlementFromRow(row({ status: "trialing" })).active).toBe(true);
  });

  it("cancel-at-period-end keeps access until the paid period ends", () => {
    // Stripe keeps status 'active' until the period actually ends.
    const e = entitlementFromRow(row({ cancel_at_period_end: true }));
    expect(e.active).toBe(true);
    expect(e.cancelAtPeriodEnd).toBe(true);
  });

  it("past_due blocks NEW AI work with its own reason (saved data stays readable)", () => {
    const e = entitlementFromRow(row({ status: "past_due" }));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("past_due");
    expect(e.periodKey).toBeNull();
  });

  it("canceled/incomplete/unpaid/inactive -> no AI access", () => {
    for (const status of ["canceled", "incomplete", "incomplete_expired", "unpaid", "inactive"]) {
      const e = entitlementFromRow(row({ status }));
      expect(e.active).toBe(false);
      expect(e.reason).toBe("inactive");
    }
  });

  it("an 'active' row without a period start cannot mint an allowance period", () => {
    const e = entitlementFromRow(row({ current_period_start: null }));
    expect(e.active).toBe(false);
  });
});
