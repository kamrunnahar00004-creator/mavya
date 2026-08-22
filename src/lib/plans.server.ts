import process from "node:process";
import {
  buildPlanRegistry,
  type PriceRegistry,
  type PlanRegistryConfig,
} from "./plans";

/** Keep all environment-name knowledge on the server side. */
export function planRegistryConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>
): PlanRegistryConfig {
  return {
    legacyPriceId: env.STRIPE_PRICE_ID,
    starterMonthlyPriceId: env.STRIPE_PRICE_STARTER_MONTHLY,
    starterAnnualPriceId: env.STRIPE_PRICE_STARTER_ANNUAL,
    shopMonthlyPriceId: env.STRIPE_PRICE_SHOP_MONTHLY,
    shopAnnualPriceId: env.STRIPE_PRICE_SHOP_ANNUAL,
    powerMonthlyPriceId: env.STRIPE_PRICE_POWER_MONTHLY,
    powerAnnualPriceId: env.STRIPE_PRICE_POWER_ANNUAL,
  };
}

export function getPlanRegistry(): PriceRegistry {
  return buildPlanRegistry(planRegistryConfigFromEnv(process.env));
}
