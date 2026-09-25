import type { SupabaseClient } from "@supabase/supabase-js";
import { searchActiveListingsWithCount, type EtsyListing } from "@/lib/etsy";

/**
 * Shared daily Etsy search cache (north star 11.12 step 3). SERVER ONLY,
 * service-role client. Each keyword is searched at most once per UTC day for
 * ALL sellers, which keeps keyword tracking inside the 5,000 calls/day quota.
 *
 * Stored results drop descriptions (size) and keep what callers need: rank
 * order, id, shop, title, tags, views, favorites. Images are not part of
 * search results; callers batch-fetch details for the few they display.
 */

export type CachedSearch = { count: number; results: EtsyListing[]; cached: boolean };

type StoredListing = Pick<EtsyListing, "listingId" | "shopId" | "title" | "tags" | "views" | "favorites" | "url">;

const keyOf = (keyword: string) => keyword.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);

function toStored(l: EtsyListing): StoredListing {
  return { listingId: l.listingId, shopId: l.shopId, title: l.title.slice(0, 200), tags: l.tags.slice(0, 13), views: l.views, favorites: l.favorites, url: l.url };
}

function fromStored(s: StoredListing): EtsyListing {
  return {
    listingId: s.listingId,
    shopId: s.shopId ?? null,
    state: "active",
    title: s.title ?? "",
    description: "",
    tags: Array.isArray(s.tags) ? s.tags : [],
    views: s.views ?? null,
    favorites: s.favorites ?? null,
    priceCents: null,
    currency: null,
    url: s.url ?? null,
    createdAt: null,
    images: [],
  };
}

export async function getSearchCached(
  admin: SupabaseClient,
  keyword: string,
  today: string,
  deadlineAt = Date.now() + 30_000
): Promise<CachedSearch> {
  const key = keyOf(keyword);
  const { data } = await admin
    .from("etsy_search_cache")
    .select("result_count, results")
    .eq("keyword", key)
    .eq("search_date", today)
    .maybeSingle();
  const row = data as { result_count: number; results: StoredListing[] } | null;
  if (row && Array.isArray(row.results)) {
    return { count: row.result_count, results: row.results.map(fromStored), cached: true };
  }
  const fresh = await searchActiveListingsWithCount(key, 100, deadlineAt);
  // Best effort: a failed cache write must never fail the caller's check.
  await admin
    .from("etsy_search_cache")
    .upsert(
      { keyword: key, search_date: today, result_count: fresh.count, results: fresh.results.map(toStored) },
      { onConflict: "keyword,search_date", ignoreDuplicates: true }
    );
  return { count: fresh.count, results: fresh.results, cached: false };
}
