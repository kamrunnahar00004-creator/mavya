import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadKeywordHistory } from "@/lib/listing-history";

describe("loading historical test controls", () => {
  it("paginates all revisions under one owned product and linked-listing scope", async () => {
    const rows = Array.from({ length: 1103 }, (_, i) => ({ revision: i < 500 ? "old" : "current" }));
    const eq = vi.fn();
    const order = vi.fn();
    const range = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    const q = { select: vi.fn(), eq, gte: vi.fn(), order, range };
    q.select.mockReturnValue(q); eq.mockReturnValue(q); q.gte.mockReturnValue(q); order.mockReturnValue(q);
    const client = { from: vi.fn(() => q) } as unknown as SupabaseClient;
    expect(await loadKeywordHistory(client, "product", "linked-listing", "2026-09-01")).toEqual(rows);
    expect(eq.mock.calls).toContainEqual(["product_id", "product"]);
    expect(eq.mock.calls).toContainEqual(["listing_revision", "linked-listing"]);
    expect(eq.mock.calls.some(([column]) => column === "revision")).toBe(false);
    expect(range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(order.mock.calls.slice(0, 3).map(([column]) => column)).toEqual(["snapshot_date", "revision", "keyword"]);
  });
  it("does not silently evaluate tests using partially loaded history", async () => {
    const q = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" } }) };
    for (const fn of [q.select, q.eq, q.gte, q.order]) fn.mockReturnValue(q);
    await expect(loadKeywordHistory({ from: () => q } as unknown as SupabaseClient, "p", "l", "2026-09-01")).rejects.toThrow("comparison history");
  });
});
