import { redirect } from "next/navigation";
import { getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { logEvent } from "@/lib/errors";
import { EtsyApiError, isEtsyConfigured, withEtsyRequestTier } from "@/lib/etsy";
import { todayUtc } from "@/lib/listing-monitor";
import { chargeResearchSearch } from "@/lib/research-store";
import { PAID_RESEARCH_SEARCHES_PER_DAY, type ResearchKind } from "@/lib/research";

/** Signed-in user, plan state, and today's date for a research page. */
export async function researchContext() {
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");
  const entitlement = await getEntitlement(user.id);
  return { userId: user.id, paid: entitlement.active, today: todayUtc() };
}

export type Guarded<T> = { data: T | null; error: string | null; blocked: boolean };

/**
 * Run one research search for the page: counts it against the account
 * (free: 3 a week, then `blocked` so the page shows the plans popup; paid: a
 * daily cap), tags Etsy calls with the account tier, and turns failures into
 * plain messages. `key` identifies the search so repeats the same day are free.
 */
export async function guardedSearch<T>(
  ctx: { userId: string; paid: boolean; today: string },
  kind: ResearchKind,
  key: string,
  work: () => Promise<T>
): Promise<Guarded<T>> {
  if (!isEtsyConfigured()) return { data: null, error: "Etsy connection is not set up yet.", blocked: false };
  const charge = await chargeResearchSearch(ctx.userId, ctx.paid, kind, key, ctx.today);
  if (charge === "free_limit") return { data: null, error: null, blocked: true };
  if (charge === "daily_limit") return { data: null, error: `You have run ${PAID_RESEARCH_SEARCHES_PER_DAY} searches today. Try again tomorrow.`, blocked: false };
  if (charge === "unavailable") return { data: null, error: "Research is busy right now. Try again in a minute.", blocked: false };
  try {
    return { data: await withEtsyRequestTier(ctx.paid ? "paid" : "free", work), error: null, blocked: false };
  } catch (err) {
    logEvent("research.search_failed", { kind, error: err instanceof Error ? err.message.slice(0, 80) : "unknown" });
    const busy = err instanceof EtsyApiError && err.code === "rate_limited";
    return { data: null, error: busy ? "Etsy is busy right now. Try again in a minute." : "Could not reach Etsy for this search. Try again in a minute.", blocked: false };
  }
}
