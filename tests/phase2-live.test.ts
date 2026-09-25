import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchListingsBatch, fetchShopActiveListings, fetchShopByName, searchActiveListings } from "@/lib/etsy";
import { findKeywordIdeas } from "@/lib/keyword-finder-server";
import { writerCall } from "@/lib/openai";
import { winnerTagFrequency, type KeywordSnapshot } from "@/lib/listing-analytics";
import { WRITER_RESPONSE_SCHEMA, WRITER_SYSTEM_PROMPT, buildWriterMessage, finalizeWriterOutput, parseWriterOutput, type WriterContext } from "@/lib/listing-writer";

/**
 * LIVE Phase 2 check: real Etsy data (and one AI call when RUN_LIVE_WRITER is
 * also set). Skipped unless RUN_LIVE_ETSY=true. Uses an in-memory stand-in for
 * the search-cache table (no database).
 */
function memoryAdmin(): SupabaseClient {
  const store = new Map<string, unknown>();
  const from = () => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      maybeSingle: async () => ({ data: store.get(`${filters.keyword}|${filters.search_date}`) ?? null, error: null }),
      upsert: async (row: { keyword: string; search_date: string }) => { store.set(`${row.keyword}|${row.search_date}`, row); return { error: null }; },
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

describe.skipIf(process.env.RUN_LIVE_ETSY !== "true")("Phase 2 live", () => {
  it("reads a whole shop by name (public data)", async () => {
    const shop = await fetchShopByName("WisdomHouseCo");
    expect(shop?.shopId).toBeGreaterThan(0);
    const t = Date.now();
    const listings = await fetchShopActiveListings(shop!.shopId, 100);
    console.log(JSON.stringify({ shop: shop!.shopName, active: shop!.activeListings, fetched: listings.length, ms: Date.now() - t, withImages: listings.filter((l) => l.images.length).length }));
    expect(listings.length).toBeGreaterThan(50);
    expect(listings.filter((l) => l.images.length > 0).length).toBeGreaterThan(40);
  }, 120_000);

  it("finds labeled keyword ideas, then writes with them", async () => {
    const admin = memoryAdmin();
    const search = await searchActiveListings("coraline doll crochet pattern", 25);
    const own = (await fetchListingsBatch([search[0].listingId])).get(search[0].listingId)!;
    const ideas = await findKeywordIdeas(admin, { listingId: own.listingId, title: own.title, tags: own.tags }, "coraline doll crochet pattern", "2026-09-25");
    console.log(JSON.stringify(ideas.map((i) => `${i.label.padEnd(8)} ${i.keyword} | ${i.competition} | ${i.interest} | ${i.position ?? "-"}`), null, 1));
    expect(ideas.length).toBeGreaterThan(3);
    expect(ideas[0].label).toBe("winning");

    if (process.env.RUN_LIVE_WRITER !== "true") return;
    const details = await fetchListingsBatch(search.slice(1, 25).map((l) => l.listingId));
    const top: KeywordSnapshot = {
      snapshot_date: "2026-09-25", keyword: "coraline doll crochet pattern", position: 1, depth: 100,
      top: search.slice(1, 25).map((l) => { const d = details.get(l.listingId) ?? l; return { id: d.listingId, title: d.title, tags: d.tags, views: d.views, favorites: d.favorites, imageCount: d.images.length, mainImageId: null, mainImageUrl: null, url: null }; }),
    };
    const ctx: WriterContext = {
      current: { title: own.title, tags: own.tags, description: own.description },
      photo: { productSummary: null, category: null },
      keywords: [{ keyword: "coraline doll crochet pattern", position: 1, depth: 100 }],
      winnerTags: winnerTagFrequency([top], 24).filter((w) => w.count >= 2),
      ideas,
      isDigital: true,
      facts: {},
    };
    const raw = await writerCall({ systemPrompt: WRITER_SYSTEM_PROMPT, userMessage: buildWriterMessage(ctx), schema: WRITER_RESPONSE_SCHEMA });
    const out = finalizeWriterOutput(parseWriterOutput(raw), ctx);
    console.log(JSON.stringify({ titles: out.titles, tags: out.tags.map((t) => `${t.tag} :: ${t.reason}`) }, null, 1));
    const avoided = ideas.filter((i) => i.label === "crowded" || i.label === "quiet").map((i) => i.keyword);
    expect(out.tags.filter((t) => t.isNew && avoided.includes(t.tag.toLowerCase()))).toEqual([]);
  }, 180_000);
});
