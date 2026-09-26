import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDailySeries,
  buildMarketSeries,
  detectChanges,
  diagnose,
  evaluateAllTests,
  comparablePeers,
  keywordIsRelevant,
  stripStatus,
  suggestKeywords,
  type KeywordSnapshot,
  type ListingSnapshot,
  type TopEntry,
} from "@/lib/listing-analytics";
import { buildShopView, type ShopSnapshotRow } from "@/lib/shop-analytics";
import { tagReasons } from "@/lib/listing-writer";

/**
 * Regressions for the outside review of 2026-09-26 (docs/MAVYA_REVIEW_BRIEF).
 * The headline bug: "PRE-ORDER | Roblox Arg - Brandon Works Keychain" made
 * "pre-order" the tracked keyword, so rank, top listings (yarn, stockings),
 * comparisons, tests, and the rewrite were all built on unrelated listings.
 */

const TODAY = "2026-09-25";
const t = (title: string, tags: string[] = []): Pick<TopEntry, "title" | "tags"> => ({ title, tags });

describe("keyword picking skips status words", () => {
  it("never picks pre-order / ready to ship as a keyword", () => {
    expect(suggestKeywords("PRE-ORDER | Roblox Arg - Brandon Works Keychain - Brandon", [])).toEqual(["roblox arg", "brandon works keychain", "brandon"]);
    expect(suggestKeywords("some READY TO SHIP | Roblox Forsaken - Chance & Mafioso / Don Sonnellino", [])).toEqual(["roblox forsaken", "chance mafioso", "don sonnellino"]);
    expect(suggestKeywords("PREORDER | Sale | New", [])).toEqual([]);
  });

  it("does not end a phrase on a dangling joiner", () => {
    expect(suggestKeywords("Lavender soy candle gift for her, hand poured amber jar candle", [])[0]).toBe("lavender soy candle gift");
  });

  it("strips status phrases wherever they appear", () => {
    expect(stripStatus("Epoxy charm PRE-ORDER ready to ship")).toBe("epoxy charm");
  });
});

describe("keyword relevance", () => {
  const listing = { title: "PRE-ORDER | Roblox Arg - Brandon Works Keychain", tags: [] };
  it("a keyword that returns unrelated listings is not relevant", () => {
    expect(keywordIsRelevant(listing, "pre-order", [t("Chunky yarn preorder"), t("Halloween stocking"), t("Doll eyes 12mm"), t("Fantasy book")])).toBe(false);
  });
  // Relevance (does the keyword describe the product) is separate from peers
  // (which results are fair to compare): a correct franchise keyword stays
  // tracked, but only same-type results are compared against.
  it("a shared franchise keeps the keyword but does not make different products comparable", () => {
    const mixed = [t("Roblox shirt"), t("roblox arg poster"), t("Brandon works charm"), t("Anime pin")];
    expect(keywordIsRelevant(listing, "roblox arg", mixed)).toBe(true);
    expect(comparablePeers(listing, mixed)).toEqual([]);
    const keychains = [t("Roblox keychain"), t("roblox arg keyring"), t("Brandon works keychains")];
    expect(comparablePeers(listing, keychains)).toHaveLength(3);
  });
  it("no search results: keyword still describes the product, but there are no peers", () => {
    expect(keywordIsRelevant(listing, "roblox arg", [])).toBe(true);
    expect(comparablePeers(listing, [])).toEqual([]);
  });
  it("the Forsaken keychain keeps 'roblox forsaken' (live 2026-09-26: 1 keychain among 25 results)", () => {
    const own = { title: "some READY TO SHIP | Roblox Forsaken - Chance & Mafioso / Don Sonnellino | Acrylic Ice cream Keychain", tags: [] };
    expect(keywordIsRelevant(own, "roblox forsaken")).toBe(true);
  });
  it("unrecognized product types compare against results sharing 2+ product words", () => {
    const towel = { title: "Linen tea towel, natural", tags: [] };
    expect(comparablePeers(towel, [t("Kitchen tea towel set"), t("Ceramic tea set"), t("Linen napkins")]).map((x) => x.title)).toEqual(["Kitchen tea towel set"]);
  });
});

describe("findability advice respects real traffic", () => {
  const notFound: KeywordSnapshot = { snapshot_date: TODAY, keyword: "roblox arg", position: null, depth: 100, top: [] };
  const base = { linked: true, series: [], market: [], tests: [], today: TODAY, ownPhotoScore: null, winnerPhotoScore: null, lastCheckedOn: TODAY };
  it("a busy listing is not told buyers may not be finding it", () => {
    const d = diagnose({ ...base, latestKeywords: [notFound], totalViews: 2940 });
    expect(d.headline).toBe("Your listing has views, but not a top position for these searches");
    expect(d.detail).toContain("We cannot tell where those views came from");
  });
  it("a quiet listing still gets the findability warning", () => {
    const d = diagnose({ ...base, latestKeywords: [notFound], totalViews: 40 });
    expect(d.headline).toBe("Buyers may not be finding this listing");
  });
});

describe("shop trends and patterns", () => {
  const row = (id: number, date: string, views: number, tags: string[] = Array.from({ length: 13 }, (_, i) => `tag ${i}`)): ShopSnapshotRow => ({
    listing_id: id, snapshot_date: date, views, favorites: 5, image_count: 8, main_image_id: 1, main_image_url: null,
    title: `Listing ${id} handmade soy candle gift for her, lavender scented jar candle`, tags,
  });

  it("a tiny rise (0.7 to 1.1 views a day) is not called Rising", () => {
    const rows: ShopSnapshotRow[] = [];
    let v = 100;
    for (let n = 40; n >= 0; n--) {
      // ~0.7/day before, 8 views (1.14/day) last week: 1.6x, which would be
      // "Rising" without the 20-views-a-week noise floor.
      v += n < 7 ? (n === 3 ? 2 : 1) : n % 10 < 7 ? 1 : 0;
      rows.push(row(1, addDays(TODAY, -n), v));
    }
    const l = buildShopView(rows, TODAY).listings[0];
    expect(l.trendRatio).toBeGreaterThan(1.5);
    expect(l.status).not.toBe("rising");
  });

  it("a shop-wide tag gap is said once, and Fix-first moves on to other problems", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((id) => ({ ...row(id, TODAY, 1000 * id, id === 6 ? undefined : []), image_count: id === 2 ? 2 : 8 }));
    const v = buildShopView(rows, TODAY);
    expect(v.shopWide).toMatchObject({ kind: "tags", count: 5, none: 5, total: 6 });
    expect(v.shopWide!.start[0].listingId).toBe(5);
    expect(v.fixQueue.some((f) => /tag/i.test(f.todo))).toBe(false);
    expect(v.fixQueue[0]).toMatchObject({ listingId: 2, button: "Add photos" });
  });
});

describe("honest before/after", () => {
  // A busy listing's steady doubling is a clear Better. A tiny listing
  // (2 views a day, 20 vs 40 views) gets a much wider range even though its
  // few views look perfectly steady, so it honestly reads "too close to call".
  const widths: Record<number, number> = {};
  it.each([40, 2])("a steady doubling is judged with counting noise in mind (%i views/day)", (rate) => {
    const snaps: ListingSnapshot[] = Array.from({ length: 25 }, (_, d) => ({
      snapshot_date: addDays("2026-09-01", d), etsy_listing_id: 1, state: "active",
      views: 100 + Math.min(d, 10) * rate + Math.max(0, d - 10) * rate * 2,
      favorites: 5, title: d >= 10 ? "New title" : "Old title", tags: [],
      description: null, main_image_id: 1, main_image_url: null, image_count: 5,
    }));
    const series = buildDailySeries(snaps);
    const market = series.map(p => ({ date: p.date, winnerViewsPerDay: 10 }));
    const result = evaluateAllTests(detectChanges(snaps), series, market, addDays("2026-09-01", 24))[0];
    expect(result.verdict).toBe(rate === 40 ? "better" : "no_clear_change");
    expect(result.lift).toBeCloseTo(2, 0);
    if (rate === 40) expect(result.liftLow).toBeGreaterThan(1);
    widths[rate] = (result.liftHigh as number) / (result.liftLow as number);
    if (rate === 2) expect(widths[2]).toBeGreaterThan(widths[40] * 2);
  });

  it("reports search position before vs after a title change", () => {
    const START = "2026-09-01";
    const snaps: ListingSnapshot[] = Array.from({ length: 21 }, (_, d) => ({
      snapshot_date: addDays(START, d), etsy_listing_id: 1, state: "active", views: 1000 + d * 10, favorites: 50,
      title: d >= 10 ? "New title" : "Old title", tags: [], description: null, main_image_id: 1, main_image_url: null, image_count: 5,
    }));
    const tops: TopEntry[] = [1, 2, 3].map((i) => ({ id: 100 + i, title: "w", tags: [], views: 1000, favorites: 10, imageCount: 5, mainImageId: null, mainImageUrl: null, url: null }));
    const kws: KeywordSnapshot[] = Array.from({ length: 21 }, (_, d) => ({
      snapshot_date: addDays(START, d), keyword: "soy candle", position: d >= 12 ? 12 : 40, depth: 100,
      top: tops.map((x) => ({ ...x, views: 1000 + d * 30 })),
    }));
    const [test] = evaluateAllTests(detectChanges(snaps), buildDailySeries(snaps), buildMarketSeries(kws), addDays(START, 20), kws);
    expect(test.rank).toEqual([{ keyword: "soy candle", before: 40, after: 12 }]);
  });
});

describe("wording and migration", () => {
  it("tag reasons show the count, never 'Low competition'", () => {
    const ctx = { current: { title: "", tags: [], description: "" }, keywords: [], winnerTags: [], ideas: [{ keyword: "pre order charm", label: "add" as const, competition: 39_600, interest: 200, position: null, inTags: false }] };
    expect(tagReasons(["pre order charm"], ctx)[0].reason).toBe("39.6K matching listings");
  });

  it("migration 0036 remaps only while the old limits are in place (safe to rerun)", () => {
    const sql = readFileSync("supabase/migrations/0036_keyword_limits_30_75_150.sql", "utf8");
    expect(sql).toContain("pg_get_constraintdef(oid) like '%100]%'");
    expect(sql).toContain("check (keyword_limit in (0, 30, 75, 150))");
    expect(sql).toContain("set default 30");
  });
});
