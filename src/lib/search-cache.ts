import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { searchActiveListingsWithCount, type EtsyListing } from "@/lib/etsy";

/**
 * Shared daily Etsy search cache (north star 11.12 step 3). SERVER ONLY,
 * service-role client. Completed searches are shared for the UTC day. A
 * database lease coalesces concurrent misses; failed/expired owners may retry.
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
  while (Date.now() < deadlineAt - 2_000) {
    const { data, error } = await admin
      .from("etsy_search_cache")
      .select("result_count, results, ready")
      .eq("keyword", key)
      .eq("search_date", today)
      .maybeSingle();
    if (error) throw new Error("search_cache_read_failed");
    const row = data as { result_count: number; results: StoredListing[]; ready: boolean } | null;
    if (row?.ready && Array.isArray(row.results)) {
      return { count: row.result_count, results: row.results.map(fromStored), cached: true };
    }
    const token = randomUUID();
    const claim = await admin.rpc("claim_etsy_search", { p_keyword: key, p_date: today, p_token: token });
    if (claim.error) throw new Error("search_cache_claim_failed");
    if (claim.data !== true) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    try {
      // Provider work cannot outlive the 45-second claim.
      const fresh = await searchActiveListingsWithCount(key, 100, Math.min(deadlineAt, Date.now() + 20_000));
      const saved = await admin.from("etsy_search_cache")
        .update({ result_count: fresh.count, results: fresh.results.map(toStored), ready: true, lease_until: null })
        .eq("keyword", key).eq("search_date", today).eq("claim_token", token).eq("ready", false)
        .select("keyword");
      if (saved.error || !saved.data?.length) throw new Error("search_cache_write_failed");
      return { count: fresh.count, results: fresh.results, cached: false };
    } catch (err) {
      // Never release a replacement owner's lease or delete a completed result.
      await admin.from("etsy_search_cache").delete()
        .eq("keyword", key).eq("search_date", today).eq("claim_token", token).eq("ready", false);
      throw err;
    }
  }
  throw new Error("search_cache_deadline");
}
