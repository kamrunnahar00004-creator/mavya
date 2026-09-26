import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildShopView, type ShopSnapshotRow } from "@/lib/shop-analytics";
import { addDays } from "@/lib/listing-analytics";
import { sanitizeTitle, sanitizeTags, finalizeWriterOutput, buildWriterMessage, type WriterContext } from "@/lib/listing-writer";
import { buildCandidates, labelKeyword } from "@/lib/keyword-finder";
import { keywordsRemaining } from "@/lib/keyword-quota";

const start = "2026-09-01";
const today = addDays(start, 29);
function history(id: number, increment: (day: number) => number, edits: number[] = []): ShopSnapshotRow[] {
  let views = 1000;
  return Array.from({ length: 30 }, (_, day) => {
    views += increment(day);
    return { listing_id: id, snapshot_date: addDays(start, day), views, favorites: 50,
      image_count: 8, main_image_id: 1, main_image_url: null,
      title: `Listing ${id} version ${edits.filter((d) => d <= day).length}`,
      tags: Array.from({ length: 13 }, (_, n) => `tag ${n}`) };
  });
}

it("missing control observations cannot manufacture a win", () => {
  const inc = (d: number) => d === 22 || d === 23 ? 100 : 10;
  const seller = history(1, inc, [15]);
  const complete = [2, 3, 4].flatMap((id) => history(id, inc));
  expect(buildShopView([...seller, ...complete], today).changes[0].verdict).toBe("no_change");
  expect(buildShopView([...seller, ...complete], today).changes[0].lift).toBeCloseTo(1, 1);
  const sparse = complete.filter((r) => r.snapshot_date !== addDays(start, 22));
  expect(buildShopView([...seller, ...sparse], today).changes[0].verdict).toBe("not_enough_data");
});

it("a second edit interrupts the first and cannot reuse its contaminated baseline", () => {
  const seller = history(1, (d) => d > 23 ? 50 : 10, [20, 23]);
  const controls = [2, 3, 4].flatMap((id) => history(id, () => 10));
  const result = buildShopView([...seller, ...controls], today);
  expect(result.changes.map((c) => c.verdict)).toEqual(["not_enough_data", "interrupted"]);
  expect(result.summary.measured).toBe(0);
});

it("retains historical evidence without making absent listings actionable", () => {
  const stale = history(1, () => 10).slice(0, 10).map((r) => ({ ...r, tags: [] }));
  const result = buildShopView([...stale, ...history(2, () => 10)], today);
  expect(result.listings.map((r) => r.listingId)).toEqual([2]);
  expect(result.fixQueue.some((r) => r.listingId === 1)).toBe(false);
});

it("explicitly empty completed membership overrides historical rows", () => {
  expect(buildShopView(history(1, () => 10), today, []).listings).toEqual([]);
});

it("new listings stay collecting even in an established shop", () => {
  const result = buildShopView([...history(1, () => 10), ...history(2, () => 0).slice(-3)], today);
  expect(result.listings.find((r) => r.listingId === 2)?.status).toBe("collecting");
});

it("requires a full observed month before claiming almost no views in 30 days", () => {
  expect(buildShopView(history(1, () => 0).slice(-15), today).counts.dead).toBe(0);
});

it("reserves discovery space even when own tags fill all slots", () => {
  const candidates = buildCandidates({ title: "Soy candle", tags: Array.from({ length: 13 }, (_, n) => `candle type ${n}`), topTags: [["soy gift"], ["soy gift"]] });
  expect(candidates).toHaveLength(12);
  expect(candidates).toContain("soy gift");
});

it("missing interest is unknown, not evidence that nobody is looking", () => {
  expect(labelKeyword({ competition: 100, interest: null, position: null, inTags: false })).toBe("unknown");
});

it("does not turn placeholders into unmarked publishable copy", () => {
  expect(sanitizeTitle("Cotton doll [add size]")).toBe("");
  expect(sanitizeTags(["[add material]"])).toEqual([]);
});

const ctx: WriterContext = { current: { title: "Floral pattern ceramic mug", tags: [], description: "" }, photo: { productSummary: null, category: null }, keywords: [], winnerTags: [], isDigital: null, facts: {} };
it("requires two unique titles and thirteen usable tags after validation", () => {
  const raw = { titles: ["Ceramic floral mug"], tags: Array.from({ length: 13 }, (_, i) => `tag ${i}`), description: "A ceramic mug decorated with a floral pattern." };
  expect(() => finalizeWriterOutput(raw, ctx)).toThrow("writer_unusable");
  expect(() => finalizeWriterOutput({ ...raw, titles: [...raw.titles, "Floral pattern mug"], tags: ["[add material]", ...raw.tags.slice(1)] }, ctx)).toThrow("writer_unusable");
});

it("does not infer a delivery format from the word pattern", () => {
  expect(buildWriterMessage(ctx)).toContain("Digital download: unknown");
  expect(buildWriterMessage({ ...ctx, isDigital: false })).toContain("Digital download: no");
  const loader = readFileSync("src/lib/listing-writer-context.ts", "utf8");
  expect(loader).not.toContain(".test(title)");
  expect(loader).toContain('rubric?.upload_kind === "physical_product" ? false : null');
});

it("fails closed when keyword usage cannot be read", async () => {
  const db = { from: () => ({ select: async () => ({ data: null, error: new Error("unavailable") }) }) } as unknown as SupabaseClient;
  expect(await keywordsRemaining(db, 100, null)).toMatchObject({ remaining: 0, error: true });
});

it("pins cross-process quota and cache protection in the unapplied migration", () => {
  const sql = readFileSync("supabase/migrations/0034_phase2_review_guards.sql", "utf8");
  expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(new.user_id::text, 34))");
  expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(sql.indexOf("sum(cardinality(keywords))"));
  expect(sql).toContain("before insert or update of keywords, keyword_limit");
  expect(sql).toContain("keyword_limit_reached");
  expect(sql).toContain("where not etsy_search_cache.ready and etsy_search_cache.lease_until < clock_timestamp()");
  expect(sql).toContain("returns trigger language plpgsql volatile");
  expect(sql).toContain("from public, anon, authenticated");
});

it("scopes persisted and in-memory drafts to the linked listing revision", () => {
  const component = readFileSync("src/components/dashboard/listing-write-view.tsx", "utf8");
  const page = readFileSync("src/app/(app)/dashboard/product/[id]/write/page.tsx", "utf8");
  expect(component).toContain("mavya:write:${productId}:${listingRevision}");
  expect(page).toContain('key={`${product.id}:${monitor?.listing_revision ?? "unlinked"}`}');
});
