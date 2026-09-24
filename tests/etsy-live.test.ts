import { describe, expect, it } from "vitest";
import { fetchListingsBatch, searchActiveListings } from "@/lib/etsy";
import { listingChecks, suggestKeywords, type KeywordSnapshot } from "@/lib/listing-analytics";

/**
 * LIVE Etsy API check for the Listing Coach client. Skipped unless
 * RUN_LIVE_ETSY=true and ETSY_API_KEYSTRING / ETSY_SHARED_SECRET are set.
 * Uses ~4 of the app's 5,000 daily requests.
 */
const live = process.env.RUN_LIVE_ETSY === "true";

describe.skipIf(!live)("Etsy live", () => {
  it("fetches a real listing with views, tags, and ranked images, then searches its keyword", async () => {
    const search = await searchActiveListings("crochet bunny", 100);
    expect(search.length).toBeGreaterThan(10);
    const top = await fetchListingsBatch(search.slice(0, 10).map((l) => l.listingId));
    expect(top.size).toBeGreaterThan(5);
    const first = top.get(search[0].listingId)!;
    expect(first.images.length).toBeGreaterThan(0);
    expect(first.images[0].rank).toBe(1);
    expect(typeof first.views).toBe("number");

    const keywords = suggestKeywords(first.title, first.tags);
    expect(keywords.length).toBeGreaterThan(0);

    const kw: KeywordSnapshot = {
      snapshot_date: "2026-09-24",
      keyword: "crochet bunny",
      position: 1,
      depth: search.length,
      top: search.slice(0, 10).map((l) => {
        const d = top.get(l.listingId) ?? l;
        return {
          id: d.listingId,
          title: d.title,
          tags: d.tags,
          views: d.views,
          favorites: d.favorites,
          imageCount: d.images.length,
          mainImageId: d.images[0]?.id ?? null,
          mainImageUrl: d.images[0]?.url570 ?? null,
          url: d.url,
        };
      }),
    };
    const issues = listingChecks({
      latest: {
        snapshot_date: "2026-09-24",
        etsy_listing_id: first.listingId,
        state: first.state,
        views: first.views,
        favorites: first.favorites,
        title: first.title,
        tags: first.tags,
        description: first.description,
        main_image_id: first.images[0]?.id ?? null,
        main_image_url: first.images[0]?.url570 ?? null,
        image_count: first.images.length,
      },
      keywords,
      latestKeywords: [kw],
    });
    console.log(JSON.stringify({ title: first.title, views: first.views, keywords, issues: issues.map((i) => i.title) }, null, 2));
  }, 60_000);

  it("skips an unknown listing id instead of failing the whole batch", async () => {
    const search = await searchActiveListings("soy candle", 5);
    const good = search[0].listingId;
    const result = await fetchListingsBatch([good, 1]);
    expect(result.has(good)).toBe(true);
    expect(result.has(1)).toBe(false);
  }, 60_000);
});
