import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const cache = vi.hoisted(() => vi.fn());
vi.mock("@/lib/search-cache", () => ({ getSearchCached: cache }));
import { findKeywordIdeas } from "@/lib/keyword-finder-server";

it("does not turn unrelated results into keyword advice or writer ideas", async () => {
  cache.mockResolvedValue({ count: 500, results: Array.from({ length: 25 }, (_, listingId) => ({ listingId, title: "Silver picture frame", tags: ["silver frame"], views: 10000, createdAt: 1 })) });
  expect(await findKeywordIdeas({} as SupabaseClient, { listingId: 100, title: "Silver earrings", tags: [] }, "silver earrings", "2026-09-26")).toEqual([]);
});

it("calculates interest only from comparable peers and preserves original rank", async () => {
  const createdAt = Date.parse("2026-09-16T00:00:00Z") / 1000;
  cache.mockResolvedValue({ count: 500, results: Array.from({ length: 10 }, (_, listingId) => ({ listingId, title: listingId < 3 ? "Soy candle" : "Candle mold", tags: [], views: listingId < 3 ? 20 : 100000, createdAt })) });
  const ideas = await findKeywordIdeas({} as SupabaseClient, { listingId: 100, title: "Soy candle", tags: [] }, "soy candle", "2026-09-26");
  expect(ideas[0].interest).toBe(2);
  expect(ideas[0].competition).toBe(500);
  expect(ideas[0].position).toBeNull();
});
