import type { SupabaseClient } from "@supabase/supabase-js";
import { EtsyApiError, fetchShopActiveListings } from "@/lib/etsy";
import { addDays } from "@/lib/listing-analytics";
import { logEvent } from "@/lib/errors";
import { buildShopView, type ShopSnapshotRow, type ShopView } from "@/lib/shop-analytics";

/**
 * Daily snapshot of every tracked active listing in a seller's shop (public
 * data only). SERVER ONLY, service-role client; callers check ownership and
 * entitlement first. Cost: all shop pages plus selected-listing detail pages. Idempotent per
 * day: the first complete observation is kept (ignoreDuplicates).
 */

export type ShopMonitorRow = { user_id: string; etsy_shop_id: number; shop_name: string };

export async function runShopMonitor(
  admin: SupabaseClient,
  shop: ShopMonitorRow,
  listingLimit: number,
  today: string,
  deadlineAt = Date.now() + 60_000
): Promise<{ listings: number }> {
  try {
    const listings = await fetchShopActiveListings(Number(shop.etsy_shop_id), listingLimit, deadlineAt);
    const rows = listings.map((l) => {
      const main = l.images[0] ?? null;
      return {
        user_id: shop.user_id,
        etsy_shop_id: Number(shop.etsy_shop_id),
        listing_id: l.listingId,
        snapshot_date: today,
        state: l.state,
        views: l.views,
        favorites: l.favorites,
        price_cents: l.priceCents,
        image_count: l.images.length || null,
        main_image_id: main?.id ?? null,
        main_image_url: main?.url570 ?? null,
        title: l.title.slice(0, 300),
        tags: l.tags.slice(0, 13),
        created_on: l.createdAt ? new Date(l.createdAt * 1000).toISOString().slice(0, 10) : null,
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin
        .from("shop_listing_snapshots")
        .upsert(rows.slice(i, i + 500), { onConflict: "user_id,etsy_shop_id,listing_id,snapshot_date", ignoreDuplicates: true });
      if (error) throw new Error(`shop snapshot upsert failed: ${error.message}`);
    }
    const completed = await admin
      .from("shop_monitors")
      .update({ last_checked_on: today, current_listing_ids: listings.map((l) => l.listingId), last_error: null, updated_at: new Date().toISOString() })
      .eq("user_id", shop.user_id)
      .eq("etsy_shop_id", shop.etsy_shop_id);
    if (completed.error) throw new Error("shop_completion_failed");
    return { listings: rows.length };
  } catch (err) {
    logEvent("shop_monitor.failed", { code: err instanceof EtsyApiError ? err.code : "unknown" });
    await admin
      .from("shop_monitors")
      .update({ last_error: "check_failed", updated_at: new Date().toISOString() })
      .eq("user_id", shop.user_id)
      .eq("etsy_shop_id", shop.etsy_shop_id);
    throw err;
  }
}

export type ShopHomeData = {
  shop: { name: string; lastCheckedOn: string | null; lastError: string | null; activeListings?: number | null } | null;
  view: ShopView | null;
  /** Etsy listing id -> Mavya product id, for listings already opened. */
  opened: Record<number, string>;
};

/**
 * Load the Shop home under the caller's RLS client. History window covers the
 * last 7 days plus the previous 4 weeks (35 days), paged 1,000 rows at a time.
 */
export async function loadShopHome(supabase: SupabaseClient, today: string): Promise<ShopHomeData> {
  const { data: monitor, error: monitorError } = await supabase
    .from("shop_monitors")
    .select("etsy_shop_id, shop_name, last_checked_on, last_error, current_listing_ids, active_listing_count")
    .maybeSingle();
  if (monitorError) throw new Error("shop_hydration_failed");
  if (!monitor) return { shop: null, view: null, opened: {} };
  const rows: ShopSnapshotRow[] = [];
  for (let page = 0; monitor.last_checked_on; page++) {
    const { data, error } = await supabase
      .from("shop_listing_snapshots")
      .select("listing_id, snapshot_date, views, favorites, image_count, main_image_id, main_image_url, title, tags, created_on")
      .eq("etsy_shop_id", monitor.etsy_shop_id)
      .gte("snapshot_date", addDays(today, -35))
      .lte("snapshot_date", monitor.last_checked_on)
      .order("snapshot_date", { ascending: true })
      .order("listing_id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error("shop_hydration_failed");
    rows.push(...((data as ShopSnapshotRow[] | null) ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: links } = await supabase.from("listing_monitors").select("product_id, etsy_listing_id");
  const opened: Record<number, string> = {};
  for (const l of (links as { product_id: string; etsy_listing_id: number | string }[] | null) ?? []) {
    opened[Number(l.etsy_listing_id)] = l.product_id;
  }
  return {
    shop: { name: monitor.shop_name, lastCheckedOn: monitor.last_checked_on, lastError: monitor.last_error, activeListings: monitor.active_listing_count },
    view: monitor.last_checked_on ? buildShopView(rows, today, monitor.current_listing_ids?.map(Number)) : null,
    opened,
  };
}
