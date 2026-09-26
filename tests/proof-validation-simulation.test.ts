import { describe, expect, it } from "vitest";
import { addDays, buildDailySeries, detectChanges, evaluateAllTests, type ListingSnapshot } from "@/lib/listing-analytics";
import { buildShopView, type ShopSnapshotRow } from "@/lib/shop-analytics";

/**
 * Validation of the before/after method (Codex follow-up review, finding 2):
 * simulate shops where a change has NO effect, with realistic mess (a shared
 * daily market swing, extra per-listing daily noise, sparse comparison
 * groups, missing days), and count how often the app wrongly says Better or
 * Worse. Target: at most 5%. Then check it still finds a real doubling.
 * Seeded, so the result is the same on every run.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
  const poisson = (lambda: number) => {
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()));
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= next();
    } while (p > l);
    return k - 1;
  };
  return { next, normal, poisson };
}

const START = "2026-08-01";
const CHANGE_DAY = 15;
const TODAY_DAY = 30;

type Scenario = { seller: number; controls: number[]; effect: number; missing: number; trend: boolean; shopWideMisses?: boolean };

/** One simulated shop: listing 1 changes its title on day 15; controls never change. */
function simulateShop(r: ReturnType<typeof rng>, s: Scenario): ShopSnapshotRow[] {
  const rates = [s.seller, ...s.controls];
  const totals = rates.map(() => 1000);
  const rows: ShopSnapshotRow[] = [];
  for (let d = 0; d <= TODAY_DAY; d++) {
    // A failed daily check misses the whole shop at once (one scan per shop).
    const shopMissed = s.shopWideMisses && d > 0 && d !== CHANGE_DAY && r.next() < s.missing;
    // Shared market swing (weekday/season/news) plus an optional trend.
    const market = Math.exp(0.25 * r.normal()) * (s.trend ? 1 + d / TODAY_DAY : 1);
    rates.forEach((rate, i) => {
      const effect = i === 0 && d > CHANGE_DAY ? s.effect : 1;
      totals[i] += r.poisson(rate * market * effect * Math.exp(0.2 * r.normal()));
      if (shopMissed) return;
      if (!s.shopWideMisses && d > 0 && r.next() < s.missing) return; // per-listing gaps (unrealistic safety check)
      rows.push({
        listing_id: i + 1, snapshot_date: addDays(START, d), views: totals[i], favorites: 5, image_count: 8,
        main_image_id: 1, main_image_url: null, created_on: START, tags: [],
        title: i === 0 && d >= CHANGE_DAY ? "Lavender soy candle in amber jar, hand poured" : `Listing ${i + 1} soy candle in amber jar, hand poured`,
      });
    });
  }
  return rows;
}

function runShop(seed: number, n: number, s: Scenario) {
  const r = rng(seed);
  const counts = { better: 0, worse: 0, no_change: 0, not_enough_data: 0, other: 0 };
  for (let i = 0; i < n; i++) {
    const view = buildShopView(simulateShop(r, s), addDays(START, TODAY_DAY));
    const c = view.changes.find((x) => x.listingId === 1);
    const v = c?.verdict ?? "other";
    if (v in counts) counts[v as keyof typeof counts] += 1;
    else counts.other += 1;
  }
  return counts;
}

describe("shop-level before/after: no-effect simulations (false Better/Worse must stay rare)", () => {
  const N = 300;
  it.each([
    ["small listing, small shop", { seller: 5, controls: [5, 4, 6, 5], effect: 1, missing: 0, trend: false }],
    ["busy listing, tiny comparison group (Codex counterexample)", { seller: 200, controls: [1, 1, 2, 1, 2], effect: 1, missing: 0, trend: false }],
    ["busy shop with a rising trend", { seller: 60, controls: [40, 80, 50, 30, 70], effect: 1, missing: 0, trend: true }],
    ["missed daily checks (whole shop)", { seller: 30, controls: [20, 30, 25, 40], effect: 1, missing: 0.15, trend: false, shopWideMisses: true }],
    ["random per-listing gaps (safe: only says it cannot tell)", { seller: 30, controls: [20, 30, 25, 40], effect: 1, missing: 0.15, trend: false }],
  ] as const)("%s", (_name, s) => {
    const c = runShop(7, N, { ...s, controls: [...s.controls] });
    const wrong = (c.better + c.worse) / N;
    expect(wrong).toBeLessThanOrEqual(0.05);
  });

  it("still finds a real doubling in a normal shop most of the time", () => {
    const c = runShop(11, 200, { seller: 30, controls: [30, 25, 40, 35, 20], effect: 2, missing: 0, trend: false });
    expect(c.better / 200).toBeGreaterThanOrEqual(0.8);
    expect(c.worse).toBe(0);
  });
});

describe("listing-level before/after: no-effect simulations against a market series", () => {
  it("false Better/Worse stays rare with a noisy market", () => {
    const r = rng(3);
    const N = 300;
    let wrong = 0;
    for (let i = 0; i < N; i++) {
      let total = 1000;
      const snaps: ListingSnapshot[] = [];
      const market: { date: string; winnerViewsPerDay: number | null }[] = [];
      for (let d = 0; d <= 24; d++) {
        const swing = Math.exp(0.25 * r.normal());
        total += r.poisson(20 * swing * Math.exp(0.2 * r.normal()));
        snaps.push({ snapshot_date: addDays(START, d), etsy_listing_id: 1, state: "active", views: total, favorites: 5,
          title: d >= 10 ? "New title" : "Old title", tags: [], description: null, main_image_id: 1, main_image_url: null, image_count: 5 });
        // Median of 3 top listings at ~30 views a day, sharing the swing.
        const tops = [0, 1, 2].map(() => r.poisson(30 * swing * Math.exp(0.2 * r.normal()))).sort((a, b) => a - b);
        market.push({ date: addDays(START, d), winnerViewsPerDay: tops[1] });
      }
      const [t] = evaluateAllTests(detectChanges(snaps), buildDailySeries(snaps), market, addDays(START, 24));
      if (t.verdict === "better" || t.verdict === "worse") wrong += 1;
    }
    expect(wrong / N).toBeLessThanOrEqual(0.05);
  });
});
