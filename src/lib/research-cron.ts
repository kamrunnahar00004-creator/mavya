import type { SupabaseClient } from "@supabase/supabase-js";
import { EtsyApiError, fetchShopPublic } from "@/lib/etsy";
import { recordShops, syncKeywordHistory } from "@/lib/research-store";
import { getSearchCached } from "@/lib/search-cache";

/**
 * Daily check of saved shops (part of the daily cron). One Etsy call per
 * shop, once a day, only for shops saved by at least one account with an
 * active plan; each account can save at most 20. Each check stores that day's
 * lifetime sales count, so sales a day is a real difference, not a guess.
 * Shops already checked today (by the cron or by a seller opening the shop)
 * are skipped.
 */
export async function runSavedShopChecks(
  admin: SupabaseClient,
  today: string,
  deadlineAt: number,
  isActive: (userId: string) => Promise<boolean>
): Promise<{ due: number; checked: number; errors: number }> {
  const out = { due: 0, checked: 0, errors: 0 };
  const { data } = await admin.from("research_saved").select("user_id, ref").eq("kind", "shop").limit(5000);
  const owners = new Map<string, string[]>();
  for (const r of (data as { user_id: string; ref: string }[] | null) ?? []) owners.set(r.ref, [...(owners.get(r.ref) ?? []), r.user_id]);
  if (!owners.size) return out;

  const ids = [...owners.keys()];
  const done = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: days } = await admin.from("research_shop_days").select("shop_id").eq("checked_on", today).in("shop_id", ids.slice(i, i + 200));
    for (const d of (days as { shop_id: number }[] | null) ?? []) done.add(String(d.shop_id));
  }

  for (const [ref, users] of owners) {
    if (done.has(ref)) continue;
    if (Date.now() >= deadlineAt) break;
    let active = false;
    for (const u of users) {
      if (await isActive(u)) {
        active = true;
        break;
      }
    }
    if (!active) continue;
    out.due += 1;
    try {
      const shop = await fetchShopPublic(Number(ref), deadlineAt);
      if (shop) {
        await recordShops([shop], today, true);
        out.checked += 1;
      }
    } catch (err) {
      if (err instanceof EtsyApiError && err.code === "not_found") continue;
      out.errors += 1;
      if (err instanceof EtsyApiError && err.code === "rate_limited") break;
    }
  }
  return out;
}

/** Saved keywords refreshed daily per account (one shared search each; repeats across accounts are free). */
export const SAVED_KEYWORDS_CHECKED_DAILY = 30;

/**
 * Daily check of saved keywords so their trend line grows: one shared,
 * cached Etsy search per keyword per day, for accounts with an active plan,
 * newest 30 per account. Then turn every stored search into keyword history
 * (this also covers keywords sellers track for their own listings).
 */
export async function runKeywordResearchDaily(
  admin: SupabaseClient,
  today: string,
  deadlineAt: number,
  isActive: (userId: string) => Promise<boolean>
): Promise<{ searched: number; history: number; errors: number }> {
  const out = { searched: 0, history: 0, errors: 0 };
  const { data } = await admin
    .from("research_saved")
    .select("user_id, ref, created_at")
    .eq("kind", "keyword")
    .order("created_at", { ascending: false })
    .limit(20_000);
  const perUser = new Map<string, string[]>();
  for (const r of (data as { user_id: string; ref: string }[] | null) ?? []) {
    const list = perUser.get(r.user_id) ?? [];
    if (list.length < SAVED_KEYWORDS_CHECKED_DAILY) perUser.set(r.user_id, [...list, r.ref]);
  }
  const keywords = new Set<string>();
  for (const [userId, refs] of perUser) {
    if (Date.now() >= deadlineAt) break;
    if (await isActive(userId)) for (const k of refs) keywords.add(k);
  }
  for (const k of keywords) {
    if (Date.now() >= deadlineAt - 15_000) break;
    try {
      await getSearchCached(admin, k, today, Math.min(deadlineAt, Date.now() + 25_000));
      out.searched += 1;
    } catch (err) {
      out.errors += 1;
      if (err instanceof EtsyApiError && err.code === "rate_limited") break;
    }
  }
  if (Date.now() < deadlineAt - 5_000) {
    try {
      out.history = (await syncKeywordHistory(today, { limit: 3000, deadlineAt })).added;
    } catch {
      out.errors += 1;
    }
  }
  return out;
}
