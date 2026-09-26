import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsViewModel } from "@/components/dashboard/listing-analytics-view";
import { addDays } from "@/lib/listing-analytics";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client, getProtectedPageIdentity: async () => ({ id: "owner" }) }));
vi.mock("@/lib/entitlements", () => ({ getEntitlement: async () => ({ active: true }) }));
vi.mock("@/lib/listing-monitor", () => ({ todayUtc: () => "2026-10-01" }));
vi.mock("@/components/dashboard/listing-analytics-view", () => ({ ListingAnalyticsView: () => null }));
vi.mock("@/components/dashboard/product-view-switch", () => ({ ProductViewSwitch: () => null }));
import ProductAnalyticsPage from "@/app/(app)/dashboard/product/[id]/analytics/page";

function database(keywords: string[]) {
  const snapshots = Array.from({ length: 31 }, (_, d) => ({
    product_id: "p", listing_revision: "listing", control_revision: d >= 26 ? "current" : "old",
    snapshot_date: addDays("2026-09-01", d), etsy_listing_id: 1, state: "active",
    views: 100 + Math.min(d, 10) * 10 + Math.max(0, d - 10) * 20, favorites: 10, title: "Soy candle old phrase new phrase", tags: [], description: "", main_image_id: d < 10 ? 1 : 2, main_image_url: null, image_count: 5,
  }));
  const keywordRows = snapshots.flatMap((s, d) => d >= 26 && !keywords.length ? [] : [{
    product_id: "p", listing_revision: "listing", revision: d < 26 ? "old" : "current",
    snapshot_date: s.snapshot_date, keyword: d < 26 ? "old phrase" : "new phrase", position: 4, depth: 100,
    top: [10, 20, 30, 40, 50].map((id) => ({ id, title: id < 40 ? "Soy candle" : "Candle mold", tags: [], views: 1000 + d * 10, favorites: 10, imageCount: 5, mainImageId: id, mainImageUrl: null, url: null })),
  }]);
  const filters: { table: string; key: string; value: unknown }[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    products: [{ id: "p", name: "Listing" }],
    listing_monitors: [{ product_id: "p", etsy_listing_id: 1, keywords, revision: "current", listing_revision: "listing", enabled: true, last_checked_on: "2026-10-01", last_error: null }],
    listing_snapshots: snapshots, listing_keyword_snapshots: keywordRows, etsy_image_scores: [],
  };
  return {
    filters,
    from: (table: string) => {
      let rows = tables[table];
      let single = false;
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => { filters.push({ table, key, value }); rows = rows.filter((r) => r[key] === value); return q; },
        gte: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) >= value); return q; },
        in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return q; },
        order: () => q,
        range: (start: number, end: number) => { rows = rows.slice(start, end + 1); return q; },
        maybeSingle: () => { single = true; return q; },
        then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve),
      };
      return q;
    },
  };
}
beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("analytics page history wiring", () => {
  it.each([["new phrase"], []])("keeps completed tests with original controls after editing or clearing keywords: %j", async (...keywords) => {
    const current = keywords.flat() as string[];
    const db = database(current);
    mocks.client.mockResolvedValue(db);
    const rendered = await ProductAnalyticsPage({ params: Promise.resolve({ id: "p" }) });
    const vm = (rendered.props as { children: { props: { vm: AnalyticsViewModel } }[] }).children[1].props.vm;
    expect(vm.series).toHaveLength(30);
    expect(vm.tests).toHaveLength(1);
    // Doubled (10 -> 20 a day) against a flat comparison group: a clear Better.
    expect(vm.tests[0].verdict).toBe("better");
    expect(vm.tests[0].beforeViewsPerDay).toBe(10);
    expect(vm.tests[0].afterViewsPerDay).toBe(20);
    expect(vm.keywords.map((k) => k.keyword)).toEqual(current);
    for (const keyword of vm.keywords) expect(keyword.top.map(peer => peer.id)).toEqual([10, 20, 30]);
    expect(db.filters).toContainEqual({ table: "listing_keyword_snapshots", key: "listing_revision", value: "listing" });
    expect(db.filters.some((f) => f.table === "listing_keyword_snapshots" && f.key === "revision")).toBe(false);
  });
});
