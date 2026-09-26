import { expect, it } from "vitest";
import { addDays, comparablePeers, comparableKeywordSnapshots, keywordIsRelevant, type KeywordSnapshot } from "@/lib/listing-analytics";
import { buildShopView, type ShopSnapshotRow } from "@/lib/shop-analytics";

const start = "2026-08-01";
const row = (id: number, d: number, views: number, changed = false): ShopSnapshotRow => ({
  listing_id: id, snapshot_date: addDays(start, d), views, favorites: 5,
  image_count: 8, main_image_id: 1, main_image_url: null, created_on: start,
  title: changed ? "Lavender soy candle in a handmade ceramic jar" : "Vanilla soy candle in a handmade ceramic jar",
  tags: [],
});

it("rejects material-only peers and separates accessories and digital items", () => {
  const listing = { title: "Silver moon stud earrings", tags: [] };
  const peers = Array.from({ length: 25 }, (_, i) => ({ title: i < 3 ? "Silver picture frame" : "Wooden dining table", tags: [] }));
  expect(keywordIsRelevant(listing, "silver earrings", peers)).toBe(false);
  const candle = { title: "Soy candle", tags: [] };
  expect(comparablePeers(candle, ["Candle holder", "Candle mold", "Candle label", "Digital candle", "Soy candles"].map(title => ({ title, tags: [] })))).toEqual([{ title: "Soy candles", tags: [] }]);
  expect(comparablePeers({ title: "Mug", tags: [] }, [{ title: "Mug wrap", tags: [] }])).toEqual([]);
  expect(comparablePeers({ title: "Pillow", tags: [] }, [{ title: "Pillow cover", tags: [] }])).toEqual([]);
  expect(comparablePeers({ title: "Earrings", tags: [] }, [{ title: "Earring supplies", tags: [] }])).toEqual([]);
});

it("supports explicit synonyms and plurals, with unknown for unsupported product types", () => {
  const peers = Array.from({ length: 3 }, () => ({ title: "Wool cushions", tags: [] }));
  expect(keywordIsRelevant({ title: "Pillows", tags: [] }, "pillow", peers)).toBe(true);
  expect(keywordIsRelevant({ title: "Handmade zither", tags: [] }, "zither", peers)).toBeNull();
});

it("keeps only comparable peers, never the other 22 results that passed alongside them", () => {
  const listing = { title: "Soy candle", tags: [] };
  const snapshot = { snapshot_date: start, keyword: "soy candle", position: 5, depth: 100,
    top: Array.from({ length: 25 }, (_, id) => ({ id, title: id < 3 ? "Soy candles" : "Candle mold", tags: [], views: 100, favorites: 1, imageCount: 4, mainImageId: null, mainImageUrl: null, url: null })),
  } satisfies KeywordSnapshot;
  expect(comparableKeywordSnapshots(listing, [snapshot])[0].top.map(t => t.id)).toEqual([0, 1, 2]);
  expect(comparableKeywordSnapshots(listing, [{ ...snapshot, top: snapshot.top.slice(0, 2) }])).toEqual([]);
});

it("honors all dismissals on the shop-wide recommendation, expiry and protection", () => {
  const today = addDays(start, 27);
  const rows = Array.from({ length: 5 }, (_, i) => row(i + 1, 27, 100));
  const dismissed = Object.fromEntries(rows.map(r => [String(r.listing_id), addDays(today, 30)]));
  const view = buildShopView(rows, today, undefined, { dismissed });
  expect(view.fixQueue).toHaveLength(0);
  expect(view.shopWide?.start).toHaveLength(0);
  dismissed["1"] = addDays(today, -1);
  expect(buildShopView(rows, today, undefined, { dismissed }).shopWide?.start.map(l => l.listingId)).toEqual([1]);
  expect(buildShopView(rows, today, undefined, { dismissed, protectedIds: [1] }).shopWide?.start).toHaveLength(0);
});

it("never calls a flat seller better because tiny controls lost a few views", () => {
  const rows: ShopSnapshotRow[] = [];
  for (let id = 1; id <= 4; id++) {
    let views = 1000;
    for (let d = 0; d <= 34; d++) {
      views += id === 1 ? 1000 : d <= 20 || (d - 21) % 7 < 4 ? 1 : 0;
      rows.push(row(id, d, views, id === 1 && d >= 20));
    }
  }
  const early = buildShopView(rows.filter(r => r.snapshot_date <= addDays(start, 27)), addDays(start, 27)).changes[0];
  expect(early.verdict).toBe("measuring");
  const result = buildShopView(rows, addDays(start, 34)).changes[0];
  expect(result.beforePerDay).toBe(1000);
  expect(result.afterPerDay).toBe(1000);
  expect(result.lift).toBeCloseTo(1.75);
  expect(result.verdict).toBe("observed");
  expect(result.liftLow).toBeNull();
  expect(result.liftHigh).toBeNull();
});

it("observed zero traffic does not fall back to lifetime traffic", () => {
  const rows = [1, 2].flatMap(id => Array.from({ length: 31 }, (_, d) => row(id, d, id === 1 ? 100_000 : 100)));
  const view = buildShopView(rows, addDays(start, 30));
  expect(view.listings[0].score).toBe(view.listings[1].score);
  const firstDay = buildShopView([row(1, 0, 100_000), row(2, 0, 1)], start);
  expect(firstDay.listings.find(l => l.listingId === 1)!.score).toBeGreaterThan(firstDay.listings.find(l => l.listingId === 2)!.score);
});
