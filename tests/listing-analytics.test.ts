import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDailySeries,
  buildMarketSeries,
  detectChanges,
  diagnose,
  evaluateAllTests,
  listingChecks,
  normalizeKeywords,
  suggestKeywords,
  windowStats,
  type KeywordSnapshot,
  type ListingSnapshot,
  type TopEntry,
} from "@/lib/listing-analytics";
import { normalizeListing, parseEtsyListingInput } from "@/lib/etsy";

const START = "2026-09-01";

function snap(day: number, views: number | null, overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    snapshot_date: addDays(START, day),
    etsy_listing_id: 1,
    state: "active",
    views,
    favorites: views === null ? null : Math.round(views / 20),
    title: "Crochet bunny plush, handmade amigurumi toy",
    tags: ["crochet bunny", "amigurumi"],
    description: "x".repeat(400),
    main_image_id: 100,
    main_image_url: "https://i.etsystatic.com/a.jpg",
    image_count: 8,
    ...overrides,
  };
}

function top(id: number, views: number, extra: Partial<TopEntry> = {}): TopEntry {
  return {
    id,
    title: `Winner ${id}`,
    tags: ["crochet bunny", "easter gift", "amigurumi"],
    views,
    favorites: Math.round(views / 10),
    imageCount: 10,
    mainImageId: id * 10,
    mainImageUrl: null,
    url: null,
    ...extra,
  };
}

function kw(day: number, position: number | null, winnerViews: number, keyword = "crochet bunny"): KeywordSnapshot {
  return {
    snapshot_date: addDays(START, day),
    keyword,
    position,
    depth: 100,
    top: [1, 2, 3].map((i) => top(1000 + i, winnerViews + i * 10)),
  };
}

describe("parseEtsyListingInput", () => {
  it("accepts listing links, regional links, and bare ids", () => {
    expect(parseEtsyListingInput("https://www.etsy.com/listing/1200909532/grandma-to-be?ref=x")).toBe(1200909532);
    expect(parseEtsyListingInput("etsy.com/uk/listing/1200909532/x")).toBe(1200909532);
    expect(parseEtsyListingInput("1200909532")).toBe(1200909532);
  });
  it("rejects other hosts and non-listing paths", () => {
    expect(parseEtsyListingInput("https://evil.com/listing/1200909532/")).toBeNull();
    expect(parseEtsyListingInput("https://etsy.com.evil.com/listing/1200909532/")).toBeNull();
    expect(parseEtsyListingInput("https://www.etsy.com/shop/Foo")).toBeNull();
    expect(parseEtsyListingInput("hello")).toBeNull();
  });
});

describe("normalizeListing", () => {
  it("maps Etsy fields and sorts images by rank", () => {
    const l = normalizeListing({
      listing_id: 5,
      shop_id: 9,
      title: "T",
      tags: ["a"],
      views: 10,
      num_favorers: 2,
      price: { amount: 1600, divisor: 100, currency_code: "USD" },
      images: [
        { listing_image_id: 2, rank: 2, url_570xN: "b" },
        { listing_image_id: 1, rank: 1, url_570xN: "a" },
      ],
    });
    expect(l?.priceCents).toBe(1600);
    expect(l?.images.map((i) => i.id)).toEqual([1, 2]);
    expect(l?.favorites).toBe(2);
  });
});

describe("buildDailySeries", () => {
  it("diffs lifetime counters and averages across gaps", () => {
    const s = buildDailySeries([snap(0, 100), snap(1, 110), snap(3, 130)]);
    expect(s.map((p) => p.viewsPerDay)).toEqual([null, 10, 10]);
  });
  it("treats 0 views (not tabulated) as missing, never as zero", () => {
    const s = buildDailySeries([snap(0, 100), snap(1, 0), snap(2, 120)]);
    expect(s[1].viewsPerDay).toBeNull();
    expect(s[2].viewsPerDay).toBe(10);
  });
  it("never mixes two different linked listings", () => {
    const s = buildDailySeries([snap(0, 100), snap(1, 500, { etsy_listing_id: 2 })]);
    expect(s[1].viewsPerDay).toBeNull();
  });
});

describe("detectChanges", () => {
  it("detects main photo, title, and tag changes (tag order ignored)", () => {
    const events = detectChanges([
      snap(0, 100),
      snap(1, 110, { tags: ["amigurumi", "crochet bunny"] }),
      snap(2, 120, { main_image_id: 200, title: "New title" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe(addDays(START, 2));
    expect(events[0].kinds).toEqual(["main_photo", "title"]);
  });
});

describe("evaluateAllTests", () => {
  const snaps: ListingSnapshot[] = [];
  // 10 views/day for 10 days, photo change on day 10, then 20 views/day.
  let views = 100;
  for (let d = 0; d <= 20; d++) {
    snaps.push(snap(d, views, d >= 10 ? { main_image_id: 200 } : {}));
    views += d >= 10 ? 20 : 10;
  }
  const series = buildDailySeries(snaps);
  const events = detectChanges(snaps);

  it("reports running before 7 days of after-data", () => {
    const [t] = evaluateAllTests(events, series, [], addDays(START, 13));
    expect(t.verdict).toBe("running");
  });

  it("reports better when the listing rises and the market is flat", () => {
    const market = buildMarketSeries(Array.from({ length: 21 }, (_, d) => kw(d, 5, 1000 + d * 50)));
    const [t] = evaluateAllTests(events, series, market, addDays(START, 20));
    expect(t.verdict).toBe("better");
    expect(t.lift).toBeGreaterThan(1.5);
  });

  it("controls for the market: a rise matched by top listings is no clear change", () => {
    // Winners go from 50/day to 100/day at the same time.
    const kws: KeywordSnapshot[] = [];
    let wv = 1000;
    for (let d = 0; d <= 20; d++) {
      kws.push({ ...kw(d, 5, 0), top: [top(1, wv), top(2, wv + 5), top(3, wv + 9)] });
      wv += d >= 10 ? 100 : 50;
    }
    const [t] = evaluateAllTests(events, series, buildMarketSeries(kws), addDays(START, 20));
    expect(t.verdict).toBe("no_clear_change");
  });

  it("marks a test interrupted when another change lands too soon", () => {
    const s2 = snaps.map((s, i) => (i >= 12 ? { ...s, title: "Changed again" } : s));
    const tests = evaluateAllTests(detectChanges(s2), buildDailySeries(s2), [], addDays(START, 20));
    expect(tests.find((t) => t.event.date === addDays(START, 10))?.verdict).toBe("interrupted");
  });
});

describe("windowStats", () => {
  it("computes favorites per 100 views", () => {
    const s = buildDailySeries([snap(0, 100), snap(1, 300)]);
    const w = windowStats(s, START, addDays(START, 1));
    expect(w.views).toBe(200);
    expect(w.favoritesPer100Views).toBeCloseTo(5, 5);
  });
});

describe("diagnose", () => {
  const base = {
    linked: true,
    tests: [],
    today: addDays(START, 10),
    ownPhotoScore: null,
    winnerPhotoScore: null,
  };
  const steady = buildDailySeries(Array.from({ length: 11 }, (_, d) => snap(d, 100 + d * 2)));

  it("asks to link first", () => {
    expect(diagnose({ ...base, linked: false, series: [], market: [], latestKeywords: [] }).state).toBe("not_linked");
  });

  it("flags findability from day 1 when not on page 1", () => {
    const d = diagnose({ ...base, series: [], market: [], latestKeywords: [kw(0, 80, 100)] });
    expect(d.state).toBe("findability");
    expect(d.fixTarget).toBe("title_tags");
  });

  it("collects data when ranked but history is short", () => {
    const d = diagnose({ ...base, series: steady.slice(0, 3), market: [], latestKeywords: [kw(0, 3, 100)] });
    expect(d.state).toBe("collecting");
  });

  it("flags the main photo when on page 1 but far fewer views than winners", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 100)));
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 2000)] });
    expect(d.state).toBe("click");
    expect(d.fixTarget).toBe("main_photo");
  });

  it("never says healthy while a high-severity title/tag gap exists", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 2)));
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 1020)], highSeverityChecks: 1 });
    expect(d.state).toBe("improve");
    expect(d.fixTarget).toBe("title_tags");
  });

  it("names the main photo when views trail and top listings' photos score clearly higher", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 5)));
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 1050)], ownPhotoScore: 6.4, winnerPhotoScore: 8.1 });
    expect(d.state).toBe("improve");
    expect(d.fixTarget).toBe("main_photo");
  });

  it("is healthy when nothing is behind", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 2)));
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 1020)] });
    expect(d.state).toBe("healthy");
  });

  it("pauses new advice while a test is running", () => {
    const running = evaluateAllTests(
      detectChanges([snap(8, 116), snap(9, 118, { main_image_id: 9 })]),
      steady,
      [],
      addDays(START, 10)
    );
    const d = diagnose({ ...base, tests: running, series: steady, market: [], latestKeywords: [kw(10, 80, 10)] });
    expect(d.state).toBe("testing");
  });
});

describe("listingChecks", () => {
  it("finds empty slots, cut tags, missing winner tags, and missing keyword in title", () => {
    const latest = snap(0, 100, { tags: ["pregnancy announceme", "crochet bunny"], image_count: 3 });
    const issues = listingChecks({
      latest,
      keywords: ["easter bunny"],
      latestKeywords: [kw(0, 5, 100)],
    });
    const ids = issues.map((i) => i.id);
    expect(ids).toContain("empty_tag_slots");
    expect(ids).toContain("tags_may_be_cut");
    expect(ids).toContain("missing_winner_tags");
    expect(ids).toContain("title_missing_easter bunny");
    expect(ids).toContain("fewer_photos");
    const missing = issues.find((i) => i.id === "missing_winner_tags");
    expect(missing?.suggestions).toContain("easter gift");
    expect(missing?.suggestions).not.toContain("crochet bunny");
  });
});

describe("keyword coverage", () => {
  it("only requires the PRIMARY keyword in the title; others may be covered by tags", () => {
    const latest = snap(0, 100, { tags: ["easter gift", "crochet bunny"] });
    const ids = listingChecks({
      latest,
      keywords: ["crochet bunny", "easter gift", "baby shower toy"],
      latestKeywords: [],
    }).map((i) => i.id);
    expect(ids).not.toContain("title_missing_crochet bunny");
    expect(ids).not.toContain("keyword_uncovered_easter gift");
    expect(ids).toContain("keyword_uncovered_baby shower toy");
  });
});

describe("keywords", () => {
  it("suggests the first title phrase plus multi-word tags", () => {
    expect(suggestKeywords("Crochet Bunny Plush, Handmade Toy", ["amigurumi", "easter bunny gift", "baby toy"])).toEqual([
      "crochet bunny plush",
      "easter bunny gift",
      "baby toy",
    ]);
  });
  it("normalizes and bounds user keywords", () => {
    expect(normalizeKeywords([" Crochet  Bunny ", "crochet bunny", ""])).toEqual(["crochet bunny"]);
    expect(normalizeKeywords(["a", "b", "c", "d"])).toBeNull();
    expect(normalizeKeywords("x")).toBeNull();
  });
});
