/**
 * Subscription plan registry (build slice 1 of the multi-tier
 * pricing rework, Codex-reviewed architecture, 2026-08-22 -- corrected
 * revision: Mavya is moving AWAY from AI credits. This module intentionally
 * contains NO credit fields anywhere. The old flat 1,000-credit system stays
 * exactly as it is today, entirely untouched by this file; every code path
 * still coupled to it is reported separately, not modified here.
 *
 * Product model (founder clarification, 2026-08-22): these are ACTIVE
 * listing slots, not a monthly creation allowance. Starter holds up to 5
 * active listings at once, Shop 15, Power 40 -- deleting a listing frees its
 * slot and permits adding another; slots do NOT reset monthly. Monthly vs.
 * annual controls billing cadence only, not the slot count. There is
 * deliberately no monthly-cycle helper in this slice as a result -- that
 * concept does not apply to listing slots (it may still apply later to the
 * separate, still-deferred credit system, which is a different question).
 *
 * Resolves a Stripe price id to a stable {planKey, cadence} pair -- the ONLY
 * thing checkout/entitlements are ever allowed to trust for plan identity,
 * price, cadence, or active-listing limit. Never trust these values if a
 * browser supplies them directly.
 *
 * Checkout and entitlements resolve through this registry. Allowances,
 * webhooks, and the portal retain their existing responsibilities. The
 * numeric prices below are also checked against Stripe before checkout so a
 * misconfigured price id cannot charge an amount or cadence that disagrees
 * with the pricing page.
 *
 * Built by a pure function (`buildPlanRegistry`) that takes explicit config,
 * not by reading `process.env` directly. The environment adapter lives in
 * `plans.server.ts`, keeping this policy module safe to import from tests and
 * shared code without pulling server configuration into a client bundle.
 */

export type PlanKey = "legacy" | "starter" | "shop" | "power";
export type BillingCadence = "monthly" | "annual";

export type PriceRegistryEntry = Readonly<{
  priceId: string;
  planKey: PlanKey;
  cadence: BillingCadence;
}>;
/** Frozen configured entries. Seven entries is the absolute maximum. */
export type PriceRegistry = readonly PriceRegistryEntry[];

/**
 * Policy assertions for a purchasable plan/cadence combination. Deliberately
 * has no entry for "legacy" -- the old plan is recognized (resolvable via
 * the price registry) but carries no listing allowance or price policy in
 * this slice, per explicit instruction: preserve it only as an internal
 * compatibility mapping.
 */
export type PlanPolicy = Readonly<{
  planKey: Exclude<PlanKey, "legacy">;
  cadence: BillingCadence;
  activeListingLimit: number;
  priceCents: number;
  currency: "usd";
  availableForNewCheckout: boolean;
}>;

/**
 * Founder-approved pricing (2026-08-22). Annual cadence carries the SAME
 * active-listing limit as its monthly counterpart -- cadence controls
 * billing only, never the slot count. Slots do not reset on any cycle;
 * deleting a listing frees its slot immediately, regardless of cadence.
 */
const PLAN_POLICY_VALUES = [
  { planKey: "starter", cadence: "monthly", activeListingLimit: 5, priceCents: 2900, currency: "usd", availableForNewCheckout: true },
  { planKey: "starter", cadence: "annual", activeListingLimit: 5, priceCents: 29000, currency: "usd", availableForNewCheckout: true },
  { planKey: "shop", cadence: "monthly", activeListingLimit: 15, priceCents: 5900, currency: "usd", availableForNewCheckout: true },
  { planKey: "shop", cadence: "annual", activeListingLimit: 15, priceCents: 59000, currency: "usd", availableForNewCheckout: true },
  { planKey: "power", cadence: "monthly", activeListingLimit: 40, priceCents: 9900, currency: "usd", availableForNewCheckout: true },
  { planKey: "power", cadence: "annual", activeListingLimit: 40, priceCents: 99000, currency: "usd", availableForNewCheckout: true },
] satisfies readonly PlanPolicy[];

const PLAN_POLICIES: readonly PlanPolicy[] = Object.freeze(
  PLAN_POLICY_VALUES.map((policy) => Object.freeze(policy))
);

/** Null for any plan/cadence with no assigned policy -- always true for
 *  "legacy" in this slice, by design, not by omission. */
export function getPlanPolicy(planKey: PlanKey, cadence: BillingCadence): PlanPolicy | null {
  if (planKey === "legacy") return null;
  return (
    PLAN_POLICIES.find((p) => p.planKey === planKey && p.cadence === cadence) ?? null
  );
}

/** Legacy is never available for new checkout, regardless of anything else --
 *  asserted directly rather than inferred, so this can never silently
 *  regress if PLAN_POLICIES changes shape later. */
export function isAvailableForNewCheckout(planKey: PlanKey, cadence: BillingCadence): boolean {
  if (planKey === "legacy") return false;
  return getPlanPolicy(planKey, cadence)?.availableForNewCheckout ?? false;
}

export type PlanRegistryConfig = {
  legacyPriceId?: string | undefined;
  starterMonthlyPriceId?: string | undefined;
  starterAnnualPriceId?: string | undefined;
  shopMonthlyPriceId?: string | undefined;
  shopAnnualPriceId?: string | undefined;
  powerMonthlyPriceId?: string | undefined;
  powerAnnualPriceId?: string | undefined;
};

/** Empty-string env values are treated as not-set, same as undefined --
 *  some deploy configs can leave a variable present but blank. */
function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Pure registry builder. Never reads or writes `process.env` itself, never
 * mutates its `config` argument. Throws on genuine misconfiguration (two
 * different plan/cadence slots claiming the same price id) -- a deploy-time
 * error that must fail loudly. A missing/empty individual variable is not
 * an error; that slot is simply absent from the resulting registry, so a
 * deploy that hasn't configured every future tier yet does not break.
 */
export function buildPlanRegistry(config: PlanRegistryConfig): PriceRegistry {
  const registry: PriceRegistryEntry[] = [];
  const claimedBy = new Map<string, string>(); // priceId -> "planKey:cadence" label

  function claim(priceId: string | undefined, planKey: PlanKey, cadence: BillingCadence): void {
    const id = normalize(priceId);
    if (!id) return;
    const label = `${planKey}:${cadence}`;
    const existingLabel = claimedBy.get(id);
    if (existingLabel && existingLabel !== label) {
      throw new Error(
        `Plan registry misconfiguration: price id "${id}" is assigned to both ${existingLabel} and ${label}.`
      );
    }
    claimedBy.set(id, label);
    registry.push(Object.freeze({ priceId: id, planKey, cadence }));
  }

  claim(config.legacyPriceId, "legacy", "monthly");
  claim(config.starterMonthlyPriceId, "starter", "monthly");
  claim(config.starterAnnualPriceId, "starter", "annual");
  claim(config.shopMonthlyPriceId, "shop", "monthly");
  claim(config.shopAnnualPriceId, "shop", "annual");
  claim(config.powerMonthlyPriceId, "power", "monthly");
  claim(config.powerAnnualPriceId, "power", "annual");

  return Object.freeze(registry);
}

/** Fail-closed lookup: an unrecognized or empty price id resolves to null,
 *  never to a guessed plan. */
export type ResolvedPlan = Readonly<{
  planKey: PlanKey;
  cadence: BillingCadence;
}>;

export function resolvePlan(
  registry: PriceRegistry,
  priceId: string | null | undefined
): ResolvedPlan | null {
  const id = normalize(priceId ?? undefined);
  if (!id) return null;
  const entry = registry.find((candidate) => candidate.priceId === id);
  return entry ? { planKey: entry.planKey, cadence: entry.cadence } : null;
}

export type CheckoutPlan = Readonly<{
  priceId: string;
  policy: PlanPolicy;
}>;

export type CheckoutPriceDescriptor = Readonly<{
  active: boolean;
  currency: string;
  unitAmount: number | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
}>;

/**
 * Verify that the Stripe Price configured for a checkout choice still matches
 * Mavya's server-owned policy. This catches accidentally swapped, archived,
 * one-time, or incorrectly priced Stripe IDs before a Checkout Session exists.
 */
export function checkoutPriceMatchesPolicy(
  policy: PlanPolicy,
  price: CheckoutPriceDescriptor
): boolean {
  const expectedInterval = policy.cadence === "monthly" ? "month" : "year";
  return (
    price.active &&
    price.currency.toLowerCase() === policy.currency &&
    price.unitAmount === policy.priceCents &&
    price.recurringInterval === expectedInterval &&
    price.recurringIntervalCount === 1
  );
}

/**
 * Resolve a founder-approved checkout choice to a configured Stripe price.
 * Policy availability alone is insufficient: an unset price must fail closed.
 */
export function resolveCheckoutPlan(
  registry: PriceRegistry,
  planKey: PlanKey,
  cadence: BillingCadence
): CheckoutPlan | null {
  if (!isAvailableForNewCheckout(planKey, cadence)) return null;
  const policy = getPlanPolicy(planKey, cadence);
  if (!policy) return null;
  const entry = registry.find(
    (candidate) => candidate.planKey === planKey && candidate.cadence === cadence
  );
  return entry ? Object.freeze({ priceId: entry.priceId, policy }) : null;
}
