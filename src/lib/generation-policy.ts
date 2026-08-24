import type { PlanKey } from "@/lib/plans";

/**
 * Shared, client-safe generation limits. Keep this module dependency-light so
 * pricing UI and server enforcement read the same policy without importing
 * Redis, generation workers, or other server-only machinery into the browser.
 */
const GENERATION_DAILY_MAX_BY_PLAN: Readonly<Record<PlanKey, number>> =
  Object.freeze({
    legacy: 25,
    starter: 25,
    shop: 80,
    power: 200,
  });

export function generationDailyMax(planKey: PlanKey): number {
  return GENERATION_DAILY_MAX_BY_PLAN[planKey];
}
