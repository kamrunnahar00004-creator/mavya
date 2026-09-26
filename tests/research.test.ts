import { describe, expect, it } from "vitest";
import {
  ageInDays,
  compact,
  normalizeSavedRef,
  parseAgeDays,
  parsePage,
  parseSort,
  parseTab,
  researchHref,
  salesPerDay,
} from "@/lib/research";
import { normalizeShop } from "@/lib/etsy";

describe("salesPerDay", () => {
  it("is null until two checks on different days exist", () => {
    expect(salesPerDay([], "2026-09-26")).toBeNull();
    expect(salesPerDay([{ checked_on: "2026-09-26", sold_count: 100 }], "2026-09-26")).toBeNull();
  });

  it("is the real change in Etsy's lifetime count per day", () => {
    const days = [
      { checked_on: "2026-09-24", sold_count: 15_400 },
      { checked_on: "2026-09-25", sold_count: 15_405 },
      { checked_on: "2026-09-26", sold_count: 15_412 },
    ];
    expect(salesPerDay(days, "2026-09-26")).toEqual({ perDay: 6, overDays: 2 });
  });

  it("ignores checks older than 30 days and never goes negative", () => {
    const days = [
      { checked_on: "2026-07-01", sold_count: 1 },
      { checked_on: "2026-09-20", sold_count: 50 },
      { checked_on: "2026-09-26", sold_count: 48 },
    ];
    expect(salesPerDay(days, "2026-09-26")).toEqual({ perDay: 0, overDays: 6 });
  });

  it("skips days without a count", () => {
    const days = [
      { checked_on: "2026-09-24", sold_count: null },
      { checked_on: "2026-09-25", sold_count: 10 },
      { checked_on: "2026-09-26", sold_count: 13 },
    ];
    expect(salesPerDay(days, "2026-09-26")).toEqual({ perDay: 3, overDays: 1 });
  });
});

describe("research params", () => {
  it("parses tabs, pages, ages, and sorts safely", () => {
    expect(parseTab("explore")).toBe("explore");
    expect(parseTab("x")).toBe("search");
    expect(parsePage("3")).toBe(3);
    expect(parsePage("-4")).toBe(1);
    expect(parsePage("9999")).toBe(40);
    expect(parseAgeDays("90")).toBe(90);
    expect(parseAgeDays("3")).toBeNull();
    expect(parseAgeDays("99999")).toBe(3650);
    expect(parseSort("keyword", "competition")).toMatchObject({ column: "competition", ascending: true });
    expect(parseSort("shop", "drop table")).toMatchObject({ key: "sales" });
  });

  it("builds clean URLs", () => {
    expect(researchHref("keyword", {})).toBe("/dashboard/research/keywords");
    expect(researchHref("product", { tab: "explore", age: 90, sort: null, page: "" })).toBe("/dashboard/research/products?tab=explore&age=90");
    expect(researchHref("keyword", { q: "sticker pack" })).toBe("/dashboard/research/keywords?q=sticker+pack");
  });

  it("validates saved refs per kind", () => {
    expect(normalizeSavedRef("keyword", "  Sticker   Pack ")).toBe("sticker pack");
    expect(normalizeSavedRef("keyword", "a")).toBeNull();
    expect(normalizeSavedRef("shop", "12345")).toBe("12345");
    expect(normalizeSavedRef("shop", 12345)).toBe("12345");
    expect(normalizeSavedRef("shop", "12a")).toBeNull();
    expect(normalizeSavedRef("product", "0123")).toBeNull();
    expect(normalizeSavedRef("product", { id: 1 })).toBeNull();
  });
});

describe("formatting", () => {
  it("compacts numbers", () => {
    expect(compact(null)).toBe("–");
    expect(compact(7.25)).toBe("7.3");
    expect(compact(0.05)).toBe("<0.1");
    expect(compact(0)).toBe("0");
    expect(compact(12)).toBe("12");
    expect(compact(1234)).toBe("1.2k");
    expect(compact(15_412)).toBe("15k");
    expect(compact(196_510)).toBe("197k");
    expect(compact(2_500_000)).toBe("2.5M");
  });

  it("computes ages from dates and unix seconds", () => {
    expect(ageInDays("2026-09-16", "2026-09-26")).toBe(10);
    expect(ageInDays(Date.parse("2026-09-25T00:00:00Z") / 1000, "2026-09-26")).toBe(1);
    expect(ageInDays(null, "2026-09-26")).toBeNull();
  });
});

describe("normalizeShop", () => {
  it("reads Etsy's public shop fields", () => {
    const s = normalizeShop({
      shop_id: 123,
      shop_name: "Manorcreationsuk",
      title: "Candles &amp; gifts",
      icon_url_fullxfull: "https://i.etsystatic.com/iusa/abc.jpg",
      transaction_sold_count: 15412,
      review_count: 3372,
      review_average: 4.98,
      num_favorers: 1299,
      listing_active_count: 166,
      create_date: 1500000000,
      shop_location_country_iso: "GB",
    });
    expect(s).toMatchObject({
      shopId: 123,
      shopName: "Manorcreationsuk",
      title: "Candles & gifts",
      soldCount: 15412,
      reviewCount: 3372,
      reviewAverage: 4.98,
      favorers: 1299,
      activeListings: 166,
      createdAt: 1500000000,
      country: "GB",
    });
  });

  it("drops icons that are not Etsy's image host, and junk rows", () => {
    expect(normalizeShop({ shop_id: 1, shop_name: "a", icon_url_fullxfull: "https://evil.example/x.png" })?.iconUrl).toBeNull();
    expect(normalizeShop({ shop_name: "a" })).toBeNull();
    expect(normalizeShop(null)).toBeNull();
  });
});

import { keywordDayMetrics, keywordDifficulty, keywordScore, keywordTrend } from "@/lib/research";

describe("keyword explore columns", () => {
  const day = (id: number, views: number, created = 1_700_000_000) => ({ listingId: id, views, createdAt: created });
  it("counts views the top 25 really gained since the previous day", () => {
    const prev = Array.from({ length: 25 }, (_, i) => day(i + 1, 100));
    const today = Array.from({ length: 25 }, (_, i) => day(i + 1, 104));
    expect(keywordDayMetrics(today, "2026-09-26", { date: "2026-09-25", results: prev }).viewsGained).toBe(100);
    expect(keywordDayMetrics(today, "2026-09-26", { date: "2026-09-24", results: prev }).viewsGained).toBe(50);
  });
  it("gives no gained number without a comparable previous day", () => {
    const today = Array.from({ length: 25 }, (_, i) => day(i + 1, 10));
    expect(keywordDayMetrics(today, "2026-09-26", null).viewsGained).toBeNull();
    const other = Array.from({ length: 25 }, (_, i) => day(i + 100, 5));
    expect(keywordDayMetrics(today, "2026-09-26", { date: "2026-09-25", results: other }).viewsGained).toBeNull();
    expect(keywordDayMetrics(today, "2026-09-26", { date: "2026-09-10", results: today }).viewsGained).toBeNull();
  });
  it("needs listing dates for the since-listed average", () => {
    const noDates = Array.from({ length: 25 }, (_, i) => ({ listingId: i, views: 10 }));
    expect(keywordDayMetrics(noDates, "2026-09-26", null).viewsAvg).toBeNull();
  });
  it("draws the trend from real gained views once two exist", () => {
    const d = (date: string, avg: number | null, gained: number | null) => ({ checked_on: date, competition: 100, views_avg: avg, views_gained: gained });
    expect(keywordTrend([d("2026-09-24", 50, null), d("2026-09-25", 51, 40), d("2026-09-26", 52, 60)], "2026-09-26")).toEqual({ points: [40, 60], change: 50, latest: 60 });
    expect(keywordTrend([d("2026-09-25", null, null), d("2026-09-26", 52, 40)], "2026-09-26")).toEqual({ points: [52], change: null, latest: 52 });
  });
  it("scores difficulty and opportunity 0 to 100", () => {
    expect(keywordDifficulty(40)).toBe(0);
    expect(keywordDifficulty(972_993)).toBe(86);
    expect(keywordScore(13, 747)).toBeGreaterThan(keywordScore(972_993, 945));
    expect(keywordScore(10, null)).toBe(40);
  });
});
