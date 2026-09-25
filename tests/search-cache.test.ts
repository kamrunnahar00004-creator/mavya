import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/lib/etsy", () => ({ searchActiveListingsWithCount: search }));
import { getSearchCached } from "@/lib/search-cache";

function db(row: unknown) {
  const writes: unknown[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  q.upsert = vi.fn(async (v: unknown) => { writes.push(v); return { error: null }; });
  return { admin: { from: vi.fn(() => q) } as unknown as SupabaseClient, writes };
}

const listing = { listingId: 1, shopId: 2, state: "active", title: "Soy candle", description: "long text", tags: ["soy candle"], views: 10, favorites: 1, priceCents: 1000, currency: "USD", url: "u", createdAt: 1, images: [] };

beforeEach(() => search.mockReset());

describe("shared daily search cache", () => {
  it("serves today's cached result without calling Etsy", async () => {
    const { admin } = db({ result_count: 42, results: [{ listingId: 1, shopId: 2, title: "Soy candle", tags: [], views: 10, favorites: 1, url: "u" }] });
    const r = await getSearchCached(admin, "Soy  Candle", "2026-09-25");
    expect(search).not.toHaveBeenCalled();
    expect(r).toMatchObject({ count: 42, cached: true });
    expect(r.results[0].listingId).toBe(1);
  });
  it("fetches once on a miss, normalizes the key, and stores a slim copy", async () => {
    search.mockResolvedValue({ count: 7, results: [listing] });
    const { admin, writes } = db(null);
    const r = await getSearchCached(admin, "  Soy  Candle ", "2026-09-25");
    expect(search).toHaveBeenCalledWith("soy candle", 100, expect.any(Number));
    expect(r).toMatchObject({ count: 7, cached: false });
    const stored = writes[0] as { keyword: string; results: Record<string, unknown>[] };
    expect(stored.keyword).toBe("soy candle");
    expect(stored.results[0]).not.toHaveProperty("description");
  });
});
