import { describe, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchListingsBatch, searchActiveListings } from "@/lib/etsy";
import { findKeywordIdeas } from "@/lib/keyword-finder-server";
import { writerCall } from "@/lib/openai";
import { winnerTagFrequency, type KeywordSnapshot } from "@/lib/listing-analytics";
import { WRITER_RESPONSE_SCHEMA, WRITER_SYSTEM_PROMPT, buildWriterMessage, finalizeWriterOutput, parseWriterOutput, type WriterContext } from "@/lib/listing-writer";

/**
 * LIVE reliability probe for the strict writer (2 titles + 13 usable tags).
 * Skipped unless RUN_LIVE_WRITER=true. Makes WRITER_RUNS real AI calls per
 * listing and reports how many first attempts would need a repair.
 */
function memoryAdmin(): SupabaseClient {
  const store = new Map<string, Record<string, unknown>>();
  return {
    from: () => {
      const f: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q, eq: (k: string, v: unknown) => { f[k] = v; return q; },
        maybeSingle: async () => ({ data: store.get(`${f.keyword}`) ?? null, error: null }),
        update: (row: Record<string, unknown>) => { const k = String(f.keyword ?? ""); void k; return { eq: (_a: string, v: unknown) => { const key = String(v); return { eq: () => ({ eq: () => ({ eq: () => ({ select: async () => { store.set(key, { ...(store.get(key) ?? {}), ...row }); return { data: [{ keyword: key }], error: null }; } }) }) }) }; } }; },
        delete: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }),
      };
      return q;
    },
    rpc: async (_n: string, args: { p_keyword: string }) => { store.set(args.p_keyword, { ready: false }); return { data: true, error: null }; },
  } as unknown as SupabaseClient;
}

describe.skipIf(process.env.RUN_LIVE_WRITER !== "true")("writer reliability (live)", () => {
  it("counts first-attempt failures", async () => {
    const runs = Number(process.env.WRITER_RUNS ?? 2);
    const summary: string[] = [];
    for (const kw of ["coraline doll crochet pattern", "soy candle gift"]) {
      const search = await searchActiveListings(kw, 25);
      const own = (await fetchListingsBatch([search[0].listingId])).get(search[0].listingId)!;
      const details = await fetchListingsBatch(search.slice(1, 25).map((l) => l.listingId));
      const top: KeywordSnapshot = { snapshot_date: "2026-09-25", keyword: kw, position: 1, depth: 100, top: search.slice(1, 25).map((l) => { const d = details.get(l.listingId) ?? l; return { id: d.listingId, title: d.title, tags: d.tags, views: d.views, favorites: d.favorites, imageCount: d.images.length, mainImageId: null, mainImageUrl: null, url: null }; }) };
      let ideas: WriterContext["ideas"];
      try { ideas = await findKeywordIdeas(memoryAdmin(), { listingId: own.listingId, title: own.title, tags: own.tags }, kw, "2026-09-25"); } catch { ideas = []; }
      const ctx: WriterContext = { current: { title: own.title, tags: own.tags, description: own.description }, photo: { productSummary: null, category: null }, keywords: [{ keyword: kw, position: 1, depth: 100 }], winnerTags: winnerTagFrequency([top], 24).filter((w) => w.count >= 2), ideas, isDigital: null, facts: {} };
      for (let i = 0; i < runs; i++) {
        const raw = await writerCall({ systemPrompt: WRITER_SYSTEM_PROMPT, userMessage: buildWriterMessage(ctx), schema: WRITER_RESPONSE_SCHEMA });
        const parsed = parseWriterOutput(raw);
        try {
          const out = finalizeWriterOutput(parsed, ctx);
          summary.push(`${kw} #${i + 1}: OK (${out.tags.length} tags, raw ${parsed.tags.length})`);
        } catch (e) {
          const long = parsed.tags.filter((t) => t.length > 20);
          summary.push(`${kw} #${i + 1}: FAIL ${(e as Error).message} raw titles=${parsed.titles.length} raw tags=${parsed.tags.length} over20=${JSON.stringify(long)}`);
        }
      }
    }
    console.log(summary.join("\n"));
  }, 300_000);
});
