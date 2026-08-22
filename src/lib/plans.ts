/**
 * Server-only subscription plan registry (build slice 1 of the multi-tier
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
 * Deliberately NOT wired into checkout, entitlements, allowances, webhooks,
 * or the portal yet -- this slice is the registry itself, reviewed on its
 * own before anything depends on it. No checkout is created here; the
 * numeric prices below are policy assertions and validation metadata, not a
 * charging mechanism -- the actual Stripe price id remains the charging
 * authority.
 *
 * Built by a pure function (`buildPlanRegistry`) that takes explicit config,
 * not by reading `process.env` directly -- fully unit-testable with fake
 * config, no env mocking required. The thin `getPlanRegistry()` adapter at
 * the bottom is the only piece that touches `process.env`, matching this
 * codebase's existing convention in stripe.ts (plain functions, no external
 * "server-only" package dependency -- none is installed in this repo).
 * Nothing here executes at import time; every check happens lazily inside a
 * function call, so a deploy with unset future-tier variables cannot break
 * unrelated imports or build routes.
 *
 * Required environment (all server-only, never exposed to client components):
 *  - STRIPE_PRICE_ID                the OLD $19/month price. Kept, hidden,
 *                                    recognized only -- never offered at new
 *                                    checkout, no listing allowance assigned
 *                                    to it in this slice. STRIPE_PRICE_FOUNDING
 *                                    does not exist and must not be added.
 *  - STRIPE_PRICE_STARTER_MONTHLY / _ANNUAL
 *  - STRIPE_PRICE_SHOP_MONTHLY / _ANNUAL
 *  - STRIPE_PRICE_POWER_MONTHLY / _ANNUAL
 */

export type PlanKey = "legacy" | "starter" | "shop" | "power";
export type BillingCadence = "monthly" | "annual";

export type PriceRegistryEntry = Readonly<{ planKey: PlanKey; cadence: BillingCadence }>;
/** priceId -> {planKey, cadence}. Built once per call, read-only after construction. */
export type PriceRegistry = ReadonlyMap<string, PriceRegistryEntry>;

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
const PLAN_POLICIES: readonly PlanPolicy[] = [
  { planKey: "starter", cadence: "monthly", activeListingLimit: 5, priceCents: 2900, currency: "usd", availableForNewCheckout: true },
  { planKey: "starter", cadence: "annual", activeListingLimit: 5, priceCents: 29000, currency: "usd", availableForNewCheckout: true },
  { planKey: "shop", cadence: "monthly", activeListingLimit: 15, priceCents: 5900, currency: "usd", availableForNewCheckout: true },
  { planKey: "shop", cadence: "annual", activeListingLimit: 15, priceCents: 59000, currency: "usd", availableForNewCheckout: true },
  { planKey: "power", cadence: "monthly", activeListingLimit: 40, priceCents: 9900, currency: "usd", availableForNewCheckout: true },
  { planKey: "power", cadence: "annual", activeListingLimit: 40, priceCents: 99000, currency: "usd", availableForNewCheckout: true },
];

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
  const registry = new Map<string, PriceRegistryEntry>();
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
    registry.set(id, { planKey, cadence });
  }

  claim(config.legacyPriceId, "legacy", "monthly");
  claim(config.starterMonthlyPriceId, "starter", "monthly");
  claim(config.starterAnnualPriceId, "starter", "annual");
  claim(config.shopMonthlyPriceId, "shop", "monthly");
  claim(config.shopAnnualPriceId, "shop", "annual");
  claim(config.powerMonthlyPriceId, "power", "monthly");
  claim(config.powerAnnualPriceId, "power", "annual");

  return registry;
}

/** Fail-closed lookup: an unrecognized or empty price id resolves to null,
 *  never to a guessed plan. */
export function resolvePlan(
  registry: PriceRegistry,
  priceId: string | null | undefined
): PriceRegistryEntry | null {
  const id = normalize(priceId ?? undefined);
  if (!id) return null;
  return registry.get(id) ?? null;
}

/** Reads live environment variables. The ONLY function in this module that
 *  touches `process.env`, and it only reads -- never assigns back to it.
 *  Never call this from client-bundled code; every caller must be
 *  server-only (API route, RSC, or another server-only lib), same
 *  discipline already required of stripe.ts in this codebase. */
export function getPlanRegistry(): PriceRegistry {
  return buildPlanRegistry({
    legacyPriceId: process.env.STRIPE_PRICE_ID,
    starterMonthlyPriceId: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    starterAnnualPriceId: process.env.STRIPE_PRICE_STARTER_ANNUAL,
    shopMonthlyPriceId: process.env.STRIPE_PRICE_SHOP_MONTHLY,
    shopAnnualPriceId: process.env.STRIPE_PRICE_SHOP_ANNUAL,
    powerMonthlyPriceId: process.env.STRIPE_PRICE_POWER_MONTHLY,
    powerAnnualPriceId: process.env.STRIPE_PRICE_POWER_ANNUAL,
  });
}
