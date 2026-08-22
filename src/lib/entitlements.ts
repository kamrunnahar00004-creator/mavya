import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/errors";
import { getPlanPolicy, resolvePlan, type BillingCadence, type PlanKey, type PriceRegistry } from "@/lib/plans";
import { getPlanRegistry } from "@/lib/plans.server";

/**
 * Server-side subscription entitlement. The ONLY source of truth is the
 * `subscriptions` row maintained by the Stripe webhook (service role). The
 * browser never supplies plan, status, price, or limit fields.
 *
 * Policy (founder decisions, paid beta):
 *  - Active or trialing subscription -> AI access.
 *  - Cancel-at-period-end keeps Stripe status 'active' until the period ends,
 *    so access naturally remains until the paid period is over.
 *  - past_due -> new AI usage BLOCKED (no provider spend on unpaid state);
 *    saved results stay visible (read paths are not entitlement-gated).
 *  - Anything else (no row, incomplete, canceled, unpaid, or an UNKNOWN
 *    price -- one the registry does not recognize) -> no AI access.
 *
 * Plan resolution (slice 2, 2026-08-22): replaced the single hardcoded
 * STRIPE_PRICE_ID comparison with registry-based resolution via
 * resolvePlan(). An unrecognized price_id still resolves to `wrong_plan`,
 * same fail-closed outcome as before -- the registry just now recognizes
 * seven prices (legacy + six new tier/cadence combinations) instead of one.
 *
 * Legacy ($19, existing STRIPE_PRICE_ID) is a special case, not a bug: it
 * has no PlanPolicy in plans.ts by design (preserved only as a compatibility
 * mapping, never offered at new checkout). Its access-only active-listing
 * limit (5) is asserted directly here, not read from a nonexistent policy.
 */

const LEGACY_ACTIVE_LISTING_LIMIT = 5;

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
  /**
   * TRANSITIONAL: the legacy credit system (allowances.ts) still keys its
   * per-period counters off this value. Not used by the new active-listing
   * model at all. Remove once the credit system is migrated or retired --
   * tracked as deferred work from slice 2, not solved here.
   */
  periodKey: string | null;
  /** Server-derived plan identity. Null whenever the price is unrecognized
   *  or there is no subscription -- never guessed, never client-supplied. */
  planKey: PlanKey | null;
  cadence: BillingCadence | null;
  /** Null only alongside planKey === null. Legacy always resolves to 5. */
  activeListingLimit: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function resolveActiveListingLimit(planKey: PlanKey, cadence: BillingCadence): number | null {
  if (planKey === "legacy") return LEGACY_ACTIVE_LISTING_LIMIT;
  return getPlanPolicy(planKey, cadence)?.activeListingLimit ?? null;
}

/** Pure policy: derive an entitlement from a subscription row (null = none). */
export function entitlementFromRow(
  row: SubscriptionRow | null,
  registry: PriceRegistry,
  now = new Date()
): Entitlement {
  if (!row) {
    return {
      active: false,
      reason: "no_subscription",
      status: null,
      periodKey: null,
      planKey: null,
      cadence: null,
      activeListingLimit: null,
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
  const resolved = row.price_id ? resolvePlan(registry, row.price_id) : null;
  if (!resolved) {
    return {
      ...base,
      active: false,
      reason: "wrong_plan",
      periodKey: null,
      planKey: null,
      cadence: null,
      activeListingLimit: null,
    };
  }
  const planFields = {
    planKey: resolved.planKey,
    cadence: resolved.cadence,
    activeListingLimit: resolveActiveListingLimit(resolved.planKey, resolved.cadence),
  };
  if (
    row.current_period_end &&
    Number.isFinite(new Date(row.current_period_end).getTime()) &&
    new Date(row.current_period_end) <= now
  ) {
    return { ...base, ...planFields, active: false, reason: "expired", periodKey: null };
  }
  if (ACTIVE_STATUSES.has(row.status) && row.current_period_start) {
    return {
      ...base,
      ...planFields,
      active: true,
      reason: "ok",
      periodKey: row.current_period_start,
    };
  }
  if (row.status === "past_due") {
    return { ...base, ...planFields, active: false, reason: "past_due", periodKey: null };
  }
  return { ...base, ...planFields, active: false, reason: "inactive", periodKey: null };
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
    return entitlementFromRow((data as SubscriptionRow | null) ?? null, getPlanRegistry());
  } catch (err) {
    logEvent("entitlement.lookup_failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail CLOSED: a billing-store failure must never grant free AI access.
    return entitlementFromRow(null, getPlanRegistry());
  }
}
