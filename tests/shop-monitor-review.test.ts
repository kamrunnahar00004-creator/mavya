import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const fetchShop = vi.hoisted(() => vi.fn());
vi.mock("@/lib/etsy", async (original) => ({ ...await original<typeof import("@/lib/etsy")>(), fetchShopActiveListings: fetchShop }));
vi.mock("@/lib/errors", () => ({ logEvent: vi.fn() }));
import { loadShopHome, runShopMonitor } from "@/lib/shop-monitor";

function database(monitor: Record<string, unknown>, rows: Record<string, unknown>[] = [], failSnapshots = false) {
  const updates: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let selected = [...rows];
    let error: unknown = null;
    const q = {
      select: () => q, eq: () => q, order: () => q,
      gte: (key: string, value: string) => { selected = selected.filter((r) => String(r[key]) >= value); return q; },
      lte: (key: string, value: string) => { selected = selected.filter((r) => String(r[key]) <= value); return q; },
      range: (from: number, to: number) => { selected = selected.slice(from, to + 1); return q; },
      maybeSingle: async () => ({ data: monitor, error: null }),
      update: (patch: Record<string, unknown>) => { updates.push(patch); return q; },
      upsert: () => { error = failSnapshots ? { message: "failed" } : null; return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "shop_listing_snapshots" ? selected : [], error }).then(resolve),
    };
    return q;
  };
  return { admin: { from } as unknown as SupabaseClient, updates };
}
const shop = { user_id: "u", etsy_shop_id: 7, shop_name: "Shop" };
const snapshot = (id: number, date: string) => ({ listing_id: id, snapshot_date: date, views: 100, favorites: 5, image_count: 8, main_image_id: 1, main_image_url: null, title: "Listing", tags: [] });
beforeEach(() => fetchShop.mockReset());

it("publishes an empty membership after a successfully empty shop scan", async () => {
  fetchShop.mockResolvedValue([]);
  const { admin, updates } = database({});
  expect(await runShopMonitor(admin, shop, 100, "2026-09-25")).toEqual({ listings: 0 });
  expect(updates).toContainEqual(expect.objectContaining({ current_listing_ids: [], last_checked_on: "2026-09-25" }));
});

it("never publishes current membership if any snapshot batch fails", async () => {
  fetchShop.mockResolvedValue([{ listingId: 1, title: "Listing", tags: [], images: [], views: 10 }]);
  const { admin, updates } = database({}, [], true);
  await expect(runShopMonitor(admin, shop, 100, "2026-09-25")).rejects.toThrow("shop snapshot upsert failed");
  expect(updates.every((p) => !("current_listing_ids" in p))).toBe(true);
  expect(updates).toContainEqual(expect.objectContaining({ last_error: "check_failed" }));
});

it("a completed empty shop stays empty despite old historical rows", async () => {
  const { admin } = database({ ...shop, last_checked_on: "2026-09-25", current_listing_ids: [], active_listing_count: 0 }, [snapshot(1, "2026-09-24")]);
  expect((await loadShopHome(admin, "2026-09-25")).view?.listings).toEqual([]);
});

it("failed newer scan rows cannot change the current completed shop", async () => {
  const { admin } = database({ ...shop, last_checked_on: "2026-09-24", current_listing_ids: [1] }, [snapshot(1, "2026-09-24"), snapshot(2, "2026-09-25")]);
  expect((await loadShopHome(admin, "2026-09-25")).view?.listings.map((r) => r.listingId)).toEqual([1]);
});

it("an unfinished first scan is pending, not an empty healthy shop", async () => {
  const { admin } = database({ ...shop, last_checked_on: null, current_listing_ids: null }, [snapshot(1, "2026-09-25")]);
  expect((await loadShopHome(admin, "2026-09-25")).view).toBeNull();
});
