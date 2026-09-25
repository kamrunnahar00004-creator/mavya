import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/lib/etsy", () => ({ searchActiveListingsWithCount: search }));
import { getSearchCached } from "@/lib/search-cache";

function db(initial: Record<string, unknown> | null = null) {
  let row = initial;
  const state = { readError: false, writeError: false, writes: [] as Record<string, unknown>[] };
  const rpc = vi.fn(async (_name, args) => {
    if (row?.ready || (row && Number(row.lease) > Date.now())) return { data: false };
    row = { keyword: args.p_keyword, search_date: args.p_date, claim_token: args.p_token, ready: false, lease: Date.now() + 45_000 };
    return { data: true, error: null };
  });
  const from = () => {
    const filters: [string, unknown][] = [];
    let patch: Record<string, unknown> | null = null;
    let deleting = false;
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: async () => ({ data: row, error: state.readError ? new Error("db down") : null }),
      update: (value: Record<string, unknown>) => { patch = value; return q; },
      delete: () => { deleting = true; return q; },
      then: (resolve: (value: unknown) => unknown) => {
        const matches = row && filters.every(([key, value]) => row![key] === value);
        if (patch && state.writeError) return Promise.resolve({ error: new Error("write failed") }).then(resolve);
        if (matches && patch) { state.writes.push(patch); row = { ...row, ...patch }; }
        if (matches && deleting) row = null;
        return Promise.resolve({ data: matches ? [{ keyword: "soy candle" }] : [], error: null }).then(resolve);
      },
    };
    return q;
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, rpc, state };
}

const listing = { listingId: 1, shopId: 2, state: "active", title: "Soy candle", description: "long text", tags: ["soy candle"], views: 10, favorites: 1, priceCents: 1000, currency: "USD", url: "u", createdAt: 1, images: [] };
beforeEach(() => search.mockReset().mockResolvedValue({ count: 7, results: [listing] }));

describe("shared daily search cache", () => {
  it("serves completed results without calling Etsy", async () => {
    const { admin } = db({ ready: true, result_count: 42, results: [listing] });
    expect(await getSearchCached(admin, "Soy Candle", "2026-09-25")).toMatchObject({ count: 42, cached: true });
    expect(search).not.toHaveBeenCalled();
  });
  it("claims a normalized key and stores a slim copy", async () => {
    const { admin, rpc, state } = db();
    expect(await getSearchCached(admin, " Soy  Candle ", "2026-09-25")).toMatchObject({ count: 7, cached: false });
    expect(rpc).toHaveBeenCalledWith("claim_etsy_search", expect.objectContaining({ p_keyword: "soy candle" }));
    expect((state.writes[0].results as object[])[0]).not.toHaveProperty("description");
  });
  it("coalesces two independent concurrent requests through the database claim", async () => {
    const { admin } = db();
    const results = await Promise.all([getSearchCached(admin, "soy candle", "2026-09-25"), getSearchCached(admin, "soy candle", "2026-09-25")]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.cached).sort()).toEqual([false, true]);
  });
  it("fails closed on cache reads instead of spending uncached quota", async () => {
    const { admin, state } = db();
    state.readError = true;
    await expect(getSearchCached(admin, "soy candle", "2026-09-25")).rejects.toThrow("search_cache_read_failed");
    expect(search).not.toHaveBeenCalled();
  });
  it("releases a failed owner's claim so a later request can recover", async () => {
    const { admin } = db();
    search.mockRejectedValueOnce(new Error("provider failed"));
    await expect(getSearchCached(admin, "soy candle", "2026-09-25")).rejects.toThrow("provider failed");
    expect(await getSearchCached(admin, "soy candle", "2026-09-25")).toMatchObject({ cached: false });
  });
  it("takes over an expired lease", async () => {
    const { admin } = db({ ready: false, lease: Date.now() - 1 });
    expect(await getSearchCached(admin, "soy candle", "2026-09-25")).toMatchObject({ cached: false });
  });
  it("reports failed cache persistence rather than claiming a cached success", async () => {
    const { admin, state } = db();
    state.writeError = true;
    await expect(getSearchCached(admin, "soy candle", "2026-09-25")).rejects.toThrow("search_cache_write_failed");
  });
  it("does not fetch when the caller has no time left", async () => {
    const { admin } = db();
    await expect(getSearchCached(admin, "soy candle", "2026-09-25", Date.now())).rejects.toThrow("search_cache_deadline");
    expect(search).not.toHaveBeenCalled();
  });
});
