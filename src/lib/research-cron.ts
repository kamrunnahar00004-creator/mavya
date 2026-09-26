import type { SupabaseClient } from "@supabase/supabase-js";
import { EtsyApiError, fetchShopPublic } from "@/lib/etsy";
import { recordShops } from "@/lib/research-store";

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
