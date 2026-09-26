import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDailySeries,
  buildMarketSeries,
  detectChanges,
  diagnose,
  evaluateAllTests,
  evaluateTest,
  listingChecks,
  normalizeKeywords,
  suggestKeywords,
  windowStats,
  recentWinnerFavoriteRate,
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
  it("diffs consecutive lifetime counters and preserves gaps as unknown", () => {
    const s = buildDailySeries([snap(0, 100), snap(1, 110), snap(3, 130)]);
    expect(s.map((p) => p.viewsPerDay)).toEqual([null, 10, null, null]);
  });
  it("treats 0 views (not tabulated) as missing, never as zero", () => {
    const s = buildDailySeries([snap(0, 100), snap(1, 0), snap(2, 120)]);
    expect(s[1].viewsPerDay).toBeNull();
    expect(s[2].viewsPerDay).toBeNull();
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
    const flatMarket = buildMarketSeries(Array.from({ length: 21 }, (_, d) => kw(d, 5, 1000 + d * 50)));
    const [t] = evaluateAllTests(events, series, flatMarket, addDays(START, 13));
    expect(t.verdict).toBe("running");
  });

  it("keeps collecting through the fixed horizon even when the listing rises", () => {
    const market = buildMarketSeries(Array.from({ length: 21 }, (_, d) => kw(d, 5, 1000 + d * 50)));
    const [t] = evaluateAllTests(events, series, market, addDays(START, 20));
    expect(t.verdict).toBe("running");
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
    // Day 20: the likely range (about -22% to +28%) is too wide to call yet.
    const [early] = evaluateAllTests(events, series, buildMarketSeries(kws), addDays(START, 20));
    expect(early.verdict).toBe("running");
    expect(early.liftLow).toBeNull();
    expect(early.liftHigh).toBeNull();
    // Window over: matched by the market, so no clear change.
    const [done] = evaluateAllTests(events, series, buildMarketSeries(kws), addDays(START, 24));
    expect(done.verdict).toBe("observed");
  });

  it("marks a test interrupted when another change lands too soon", () => {
    const s2 = snaps.map((s, i) => (i >= 12 ? { ...s, title: "Changed again" } : s));
    const flatMarket = buildMarketSeries(Array.from({ length: 21 }, (_, d) => kw(d, 5, 1000 + d * 50)));
    const tests = evaluateAllTests(detectChanges(s2), buildDailySeries(s2), flatMarket, addDays(START, 20));
    expect(tests.find((t) => t.event.date === addDays(START, 10))?.verdict).toBe("interrupted");
  });
});

describe("market control keyword coverage", () => {
  it("a keyword missing on some days cannot fake a market drop", () => {
    // Listing: flat 10 views/day; photo changes on day 10.
    const snaps: ListingSnapshot[] = [];
    for (let d = 0; d <= 24; d++) snaps.push(snap(d, 100 + d * 10, d >= 10 ? { main_image_id: 200 } : {}));
    // Keyword A winners: +50/day. Keyword B winners: +500/day, but B has NO
    // data after the change. Without full-coverage matching, the "market"
    // would look like it fell from 275 to 50/day and the flat listing would
    // be reported as a big relative improvement.
    const kws: KeywordSnapshot[] = [];
    for (let d = 0; d <= 24; d++) {
      kws.push({ ...kw(d, 5, 0, "alpha"), top: [1, 2, 3].map((i) => top(i, 1000 + d * 50 + i)) });
      if (d < 10) kws.push({ ...kw(d, 5, 0, "beta"), top: [4, 5, 6].map((i) => top(i, 1000 + d * 500 + i)) });
    }
    const [t] = evaluateAllTests(detectChanges(snaps), buildDailySeries(snaps), [], addDays(START, 24), kws);
    expect(t.verdict).not.toBe("better");
  });
});

describe("tests without a market baseline", () => {
  it("close immediately instead of blocking advice for 14 days", () => {
    // 10 days of listing history before a day-10 photo change, but keyword
    // (market) data only starts the day before the change.
    const snaps: ListingSnapshot[] = [];
    for (let d = 0; d <= 12; d++) snaps.push(snap(d, 100 + d * 10, d >= 10 ? { main_image_id: 200 } : {}));
    const kws: KeywordSnapshot[] = [];
    for (let d = 9; d <= 12; d++) kws.push({ ...kw(d, 5, 0), top: [1, 2, 3].map((i) => top(i, 1000 + d * 50 + i)) });
    const series = buildDailySeries(snaps);
    const tests = evaluateAllTests(detectChanges(snaps), series, [], addDays(START, 12), kws);
    expect(tests[0].verdict).toBe("no_baseline");
    const d = diagnose({ linked: true, series, market: buildMarketSeries(kws), latestKeywords: [kws[kws.length - 1]], tests, today: addDays(START, 12), ownPhotoScore: null, winnerPhotoScore: null });
    expect(d.state).not.toBe("testing");
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

  it("does not send the seller back to the photo when their photo already out-scores the top listings", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 100)));
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 2000)], ownPhotoScore: 8.4, winnerPhotoScore: 7.1 });
    expect(d.state).toBe("improve");
    expect(d.fixTarget).toBe("title_tags");
    expect(d.headline).toMatch(/already scores higher/);
  });

  it("still points at the photo when scores are within the margin", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 100)));
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 2000)], ownPhotoScore: 7.3, winnerPhotoScore: 7.1 });
    expect(d.state).toBe("click");
  });

  it("a medium tag gap does not hide a large view gap once data exists", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 100)));
    const checks = [{ id: "empty_tag_slots", area: "tags" as const, severity: "medium" as const, title: "2 of 13 tag slots are empty", detail: "" }];
    const d = diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 2000)], checks });
    expect(d.state).toBe("click");
  });

  it("title/tag checks lead while view history is still too short", () => {
    const checks = [{ id: "empty_tag_slots", area: "tags" as const, severity: "medium" as const, title: "2 of 13 tag slots are empty", detail: "" }];
    const d = diagnose({ ...base, series: steady.slice(0, 3), market: [], latestKeywords: [kw(0, 3, 100)], checks });
    expect(d.state).toBe("improve");
    expect(d.headline).toBe("2 of 13 tag slots are empty");
  });

  it("a checks gap still outranks healthy when numbers are steady", () => {
    const market = buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 2)));
    const checks = [{ id: "empty_tag_slots", area: "tags" as const, severity: "medium" as const, title: "2 of 13 tag slots are empty", detail: "" }];
    expect(diagnose({ ...base, series: steady, market, latestKeywords: [kw(10, 5, 1020)], checks }).state).toBe("improve");
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
      buildMarketSeries(Array.from({ length: 11 }, (_, d) => kw(d, 5, 1000 + d * 50))),
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

describe("tests keep their original keyword controls", () => {
  const snapshots = Array.from({ length: 31 }, (_, d) => snap(d,
    100 + Math.min(d, 10) * 10 + Math.max(0, d - 10) * 20,
    { main_image_id: d < 10 ? 100 : 200, control_revision: "original" }));
  const original = snapshots.map((s, d) => ({ ...kw(d, 5, 1000 + d * 10), revision: "original" }));

  it("keeps a completed verdict and its numbers after a keyword edit", () => {
    const changed = snapshots.map((s, d) => ({ ...s, control_revision: d >= 26 ? "new" : "original" }));
    const history = original.filter((_, d) => d < 26).concat(original.filter((_, d) => d >= 26).map((k) => ({ ...k, revision: "new", top: k.top.map((t) => ({ ...t, views: 999999 })) })));
    const before = evaluateAllTests(detectChanges(snapshots), buildDailySeries(snapshots), [], addDays(START, 30), original, "original")[0];
    const after = evaluateAllTests(detectChanges(changed), buildDailySeries(changed), [], addDays(START, 30), history, "new")[0];
    expect(before.verdict).toBe("observed");
    expect(after.verdict).toBe(before.verdict);
    expect(after.lift).toBe(before.lift);
    expect(after.before).toEqual(before.before);
    expect(after.after).toEqual(before.after);
  });
  it("does not substitute a new revision even when its keyword text is identical", () => {
    const newOnly = original.map((k) => ({ ...k, revision: "new" }));
    const [result] = evaluateAllTests(detectChanges(snapshots), buildDailySeries(snapshots), [], addDays(START, 30), newOnly, "new");
    expect(result.lift).toBeNull();
    expect(result.before.days).toBe(0);
  });
  it("explicitly stops an unfinished test immediately after editing keywords", () => {
    const s = snapshots.slice(0, 15);
    const [result] = evaluateAllTests(detectChanges(s), buildDailySeries(s), [], addDays(START, 14), original.slice(0, 15), "new");
    expect(result.verdict).toBe("interrupted");
    expect(result.interruptionReason).toBe("keywords_changed");
  });
  it("keeps that interruption after its 14-day window expires, even with no new keywords", () => {
    const changed = snapshots.map((s, d) => ({ ...s, control_revision: d >= 14 ? "new" : "original" }));
    const [result] = evaluateAllTests(detectChanges(changed), buildDailySeries(changed), [], addDays(START, 30), original.slice(0, 14), "new");
    expect(result.verdict).toBe("interrupted");
    expect(result.interruptionReason).toBe("keywords_changed");
    expect(result.after.days).toBe(3);
  });
  it("does not finalize an early result when the comparison is interrupted", () => {
    const changed = snapshots.map((s, d) => ({ ...s, control_revision: d >= 20 ? "new" : "original" }));
    const [result] = evaluateAllTests(detectChanges(changed), buildDailySeries(changed), [], addDays(START, 30), original.slice(0, 20), "new");
    expect(result.verdict).toBe("interrupted");
    expect(result.interruptionReason).toBe("keywords_changed");
  });
  it("keeps the seventh after-day recorded before a same-day keyword edit", () => {
    const s = snapshots.slice(0, 18);
    const [result] = evaluateAllTests(detectChanges(s), buildDailySeries(s), [], addDays(START, 17), original.slice(0, 18), "new");
    expect(result.after.days).toBe(7);
    expect(result.verdict).toBe("interrupted");
  });
  it("does not mistake a listing change for a keyword edit", () => {
    const changed = snapshots.map((s, d) => ({ ...s, title: d >= 13 ? "new title" : s.title }));
    const result = evaluateAllTests(detectChanges(changed), buildDailySeries(changed), [], addDays(START, 30), original, "original").find((t) => t.event.date === addDays(START, 10))!;
    expect(result.verdict).toBe("interrupted");
    expect(result.interruptionReason).toBeUndefined();
  });
});

describe("coach review regressions", () => {
  const history = Array.from({ length: 31 }, (_, d) => snap(d, 100 + d * 10, d >= 10 ? { main_image_id: 200 } : {}));
  const series = buildDailySeries(history);
  const event = detectChanges(history)[0];
  const keywords = Array.from({ length: 31 }, (_, d) => kw(d, 5, 1000 + d * 10));
  const market = buildMarketSeries(keywords);
  const base = { linked: true, series, market, latestKeywords: [kw(30, 5, 1300)], tests: [], today: addDays(START, 30), ownPhotoScore: null, winnerPhotoScore: null };

  it("ends a low-volume test instead of blocking advice forever", () => {
    const low = series.map((p) => ({ ...p, viewsPerDay: p.viewsPerDay === null ? null : 1 }));
    expect(evaluateTest(event, null, low, market, addDays(START, 30)).verdict).toBe("insufficient_data");
  });
  it("does not call an unadjusted rise a market-relative improvement", () => {
    // No market data at all: the test can never be market-adjusted, so it
    // closes as no_baseline (never "better") instead of waiting 14 days.
    const t = evaluateTest(event, null, series, [], addDays(START, 30));
    expect(t.verdict).toBe("no_baseline");
    expect(t.lift).toBeNull();
  });
  it("does not divide by a zero market", () => {
    const flat = market.map((p) => ({ ...p, winnerViewsPerDay: 0 }));
    expect(evaluateTest(event, null, series, flat, addDays(START, 30)).lift).toBeNull();
  });
  it("uses identical observed dates for seller and comparison", () => {
    const sparse = market.filter((p) => p.date !== addDays(START, 12));
    const t = evaluateTest(event, null, series, sparse, addDays(START, 20));
    expect(t.after.days).toBe(9);
    expect(t.after.views).toBe(90);
  });
  it("does not mix earlier versions into a later test baseline", () => {
    expect(evaluateTest(event, null, series, market, addDays(START, 20), addDays(START, 8)).verdict).toBe("no_baseline");
  });
  it("does not treat rank-cohort replacement as a market trend", () => {
    const rotated = keywords.map((k, d) => ({ ...k, top: k.top.map((t) => ({ ...t, id: d >= 10 ? t.id + 100 : t.id })) }));
    const [t] = evaluateAllTests([event], series, buildMarketSeries(rotated), addDays(START, 30), rotated);
    // No listing stays in the cohort across the window: nothing comparable.
    expect(["no_baseline", "insufficient_data"]).toContain(t.verdict);
    expect(t.lift).toBeNull();
  });
  it("retains results for a fixed, observed comparison cohort", () => {
    expect(evaluateAllTests([event], series, market, addDays(START, 30), keywords)[0].verdict).toBe("observed");
  });
  it("does not average the market over missing days", () => {
    expect(buildMarketSeries([kw(0, 1, 100), kw(3, 1, 400)])).toEqual([]);
  });
  it("requires at least three matched competitor listings", () => {
    expect(buildMarketSeries(keywords.map((k) => ({ ...k, top: k.top.slice(0, 2) })))).toEqual([]);
  });
  it("keeps unknown favorites unknown", () => {
    const s = buildDailySeries([snap(0, 100, { favorites: null }), snap(1, 200)]);
    expect(windowStats(s, START, addDays(START, 1)).favoritesPer100Views).toBeNull();
  });
  it("represents removed favorites as a net negative instead of zero", () => {
    const s = buildDailySeries([snap(0, 100, { favorites: 10 }), snap(1, 200, { favorites: 8 })]);
    expect(windowStats(s, START, addDays(START, 1)).favoritesPer100Views).toBe(-2);
  });
  it("compares recent favorite deltas rather than lifetime ratios", () => {
    const ks = keywords.map((k) => ({ ...k, top: k.top.map((t) => ({ ...t, favorites: 500 })) }));
    expect(recentWinnerFavoriteRate(ks, series, addDays(START, 24), addDays(START, 30))).toBe(0);
  });
  it("requires enough recent favorites observations", () => {
    expect(recentWinnerFavoriteRate(keywords.slice(-2), series, addDays(START, 24), addDays(START, 30))).toBeNull();
  });
  it("does not call a listing healthy without keyword comparisons", () => {
    expect(diagnose({ ...base, latestKeywords: [], market: [] }).state).toBe("collecting");
  });
  it("does not make performance recommendations using stale checks", () => {
    expect(diagnose({ ...base, lastCheckedOn: START }).state).toBe("collecting");
    expect(diagnose({ ...base, enabled: false }).headline).toBe("Monitoring is paused");
  });
  it("does not let old observations count toward recent readiness", () => {
    expect(diagnose({ ...base, series: series.slice(0, 15) }).state).toBe("collecting");
  });
  it("routes a photo-count finding to supporting photos", () => {
    const checks = listingChecks({ latest: snap(30, 400, { tags: ["crochet bunny", "easter gift", "amigurumi", ...Array.from({ length: 10 }, (_, i) => `tag ${i}`)], image_count: 2 }), keywords: [], latestKeywords: [kw(30, 5, 1300)] });
    expect(diagnose({ ...base, checks }).fixTarget).toBe("supporting_photos");
  });
  it("does not invent missing photos when the count is unknown", () => {
    expect(listingChecks({ latest: snap(0, 100, { image_count: null }), keywords: [], latestKeywords: [kw(0, 1, 100)] }).map((i) => i.id)).not.toContain("fewer_photos");
  });
  it("accepts keyword words distributed across relevant title and tags", () => {
    const issues = listingChecks({ latest: snap(0, 100, { title: "Bunny crochet plush", tags: ["baby shower", "soft toy"] }), keywords: ["crochet bunny", "baby shower toy"], latestKeywords: [] });
    expect(issues.some((i) => i.id.startsWith("title_missing") || i.id.startsWith("keyword_uncovered"))).toBe(false);
  });
  it("does not confuse substrings with complete keyword words", () => {
    const issues = listingChecks({ latest: snap(0, 100, { title: "Carpet" }), keywords: ["car"], latestKeywords: [] });
    expect(issues.map((i) => i.id)).toContain("title_missing_car");
  });
  it("does not demand padding an already clear short title", () => {
    expect(listingChecks({ latest: snap(0, 100, { title: "Crochet bunny" }), keywords: [], latestKeywords: [] }).map((i) => i.id)).not.toContain("title_short");
  });
  it("does not claim a full-length tag was truncated", () => {
    const issues = listingChecks({ latest: snap(0, 100, { tags: ["12345678901234567890"] }), keywords: [], latestKeywords: [] });
    const issue = issues.find((i) => i.id === "tags_may_be_cut");
    expect(issue?.severity).toBe("low");
    expect(issue?.detail).not.toMatch(/cut off|truncat/i);
  });
});
