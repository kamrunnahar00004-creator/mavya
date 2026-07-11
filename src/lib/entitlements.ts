import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/errors";

/**
 * Server-side subscription entitlement. The ONLY source of truth is the
 * `subscriptions` row maintained by the Stripe webhook (service role). The
 * browser never supplies plan, status, or period fields.
 *
 * Policy (founder decisions, paid beta):
 *  - Active or trialing subscription -> AI access.
 *  - Cancel-at-period-end keeps Stripe status 'active' until the period ends,
 *    so access naturally remains until the paid period is over.
 *  - past_due -> new AI usage BLOCKED (no provider spend on unpaid state);
 *    saved results stay visible (read paths are not entitlement-gated).
 *  - Anything else (no row, incomplete, canceled, unpaid) -> no AI access.
 */

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export type Entitlement = {
  active: boolean;
  reason: "ok" | "no_subscription" | "past_due" | "inactive" | "wrong_plan" | "expired";
  status: string | null;
  /** Allowance period key: the billing period start. Null when not active. */
  periodKey: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/** Pure policy: derive an entitlement from a subscription row (null = none). */
export function entitlementFromRow(
  row: SubscriptionRow | null,
  expectedPriceId?: string,
  now = new Date()
): Entitlement {
  if (!row) {
    return {
      active: false,
      reason: "no_subscription",
      status: null,
      periodKey: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      stripeCustomerId: null,
    };
  }
  const base = {
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end,
    stripeCustomerId: row.stripe_customer_id,
  };
  if (!expectedPriceId || row.price_id !== expectedPriceId) {
    return { ...base, active: false, reason: "wrong_plan", periodKey: null };
  }
  if (
    row.current_period_end &&
    Number.isFinite(new Date(row.current_period_end).getTime()) &&
    new Date(row.current_period_end) <= now
  ) {
    return { ...base, active: false, reason: "expired", periodKey: null };
  }
  if (ACTIVE_STATUSES.has(row.status) && row.current_period_start) {
    return {
      ...base,
      active: true,
      reason: "ok",
      periodKey: row.current_period_start,
    };
  }
  if (row.status === "past_due") {
    return { ...base, active: false, reason: "past_due", periodKey: null };
  }
  return { ...base, active: false, reason: "inactive", periodKey: null };
}

/** Load the entitlement for a user (server-only; service role read). */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("subscriptions")
      .select(
        "user_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_start, current_period_end, cancel_at_period_end"
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return entitlementFromRow(
      (data as SubscriptionRow | null) ?? null,
      process.env.STRIPE_PRICE_ID
    );
  } catch (err) {
    logEvent("entitlement.lookup_failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail CLOSED: a billing-store failure must never grant free AI access.
    return entitlementFromRow(null);
  }
}
