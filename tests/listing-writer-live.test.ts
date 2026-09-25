import { describe, expect, it } from "vitest";
import { fetchListingsBatch, searchActiveListings } from "@/lib/etsy";
import { writerCall } from "@/lib/openai";
import { winnerTagFrequency, type KeywordSnapshot } from "@/lib/listing-analytics";
import {
  TAG_MAX, WRITER_RESPONSE_SCHEMA, WRITER_SYSTEM_PROMPT, buildWriterMessage, finalizeWriterOutput, parseWriterOutput, type WriterContext,
} from "@/lib/listing-writer";

/**
 * LIVE: real Etsy data + one real text-only model call. Skipped unless
 * RUN_LIVE_WRITER=true with ETSY_* and OPENAI_API_KEY set.
 */
describe.skipIf(process.env.RUN_LIVE_WRITER !== "true")("listing writer live", () => {
  it("writes an Etsy-valid, grounded listing for a real product", async () => {
    const kw = "coraline doll crochet pattern";
    const results = await searchActiveListings(kw, 25);
    const details = await fetchListingsBatch(results.slice(0, 25).map((l) => l.listingId));
    const own = details.get(results[0].listingId)!;
    const top: KeywordSnapshot = {
      snapshot_date: "2026-09-25", keyword: kw, position: 1, depth: 100,
      top: results.slice(1, 25).map((l) => {
        const d = details.get(l.listingId) ?? l;
        return { id: d.listingId, title: d.title, tags: d.tags, views: d.views, favorites: d.favorites, imageCount: d.images.length, mainImageId: null, mainImageUrl: null, url: null };
      }),
    };
    const ctx: WriterContext = {
      current: { title: own.title, tags: own.tags, description: own.description },
      photo: { productSummary: null, category: null },
      keywords: [{ keyword: kw, position: 1, depth: 100 }],
      winnerTags: winnerTagFrequency([top], 24).filter((w) => w.count >= 2),
      isDigital: true,
      facts: {},
    };
    const raw = await writerCall({ systemPrompt: WRITER_SYSTEM_PROMPT, userMessage: buildWriterMessage(ctx), schema: WRITER_RESPONSE_SCHEMA });
    const out = finalizeWriterOutput(parseWriterOutput(raw), ctx);
    console.log(JSON.stringify({ current: ctx.current.title, currentTags: ctx.current.tags, ...out }, null, 2));
    expect(out.titles.every((t) => t.length <= 140)).toBe(true);
    expect(out.tags.every((t) => t.tag.length <= TAG_MAX)).toBe(true);
    expect(out.tags.length).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
