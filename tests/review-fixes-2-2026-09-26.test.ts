import { describe, expect, it } from "vitest";
import { addDays, buildDailySeries, wasFallingBefore, type ListingSnapshot } from "@/lib/listing-analytics";
import { buildShopView, titleIssues, type ShopSnapshotRow } from "@/lib/shop-analytics";
import { WRITER_SYSTEM_PROMPT, buildWriterMessage } from "@/lib/listing-writer";

const TODAY = "2026-09-26";
const row = (id: number, date: string, views: number, extra: Partial<ShopSnapshotRow> = {}): ShopSnapshotRow => ({
  listing_id: id, snapshot_date: date, views, favorites: 5, image_count: 8, main_image_id: 1, main_image_url: null,
  title: `Listing ${id} handmade soy candle gift for her, lavender scented jar candle`, tags: Array.from({ length: 13 }, (_, i) => `tag ${i}`), ...extra,
});

describe("writer keeps the seller's own statements' meaning (founder rule: reword ok, no policing)", () => {
  it("allows rewording but forbids changing what a statement means", () => {
    expect(WRITER_SYSTEM_PROMPT).toContain("You may\n   reword or move them");
    expect(WRITER_SYSTEM_PROMPT).toContain("NEVER change what\n   they mean");
    expect(WRITER_SYSTEM_PROMPT).toContain("Production time stays production time");
  });
  it("broad phrases are offered as 'use only if exact', never forbidden", () => {
    const msg = buildWriterMessage({
      current: { title: "t", tags: [], description: "" }, photo: { productSummary: null, category: null }, keywords: [], winnerTags: [], isDigital: null, facts: {},
      ideas: [{ keyword: "soy candle", label: "crowded", competition: 250_000, interest: 900, position: null, inTags: false }],
    });
    expect(msg).toContain("BROAD PHRASES");
    expect(msg).toContain("- soy candle (250,000 listings)");
    expect(msg).not.toContain("AVOID PHRASES");
  });
});

describe("title flag severity", () => {
  it("under 20 characters is big, 20 to 39 is small, 40+ is fine", () => {
    expect(titleIssues("Keychain")[0]).toMatchObject({ severity: "high", text: "Very short title" });
    expect(titleIssues("Silver Moon Stud Earrings")[0]).toMatchObject({ severity: "medium", text: "Short title" });
    expect(titleIssues("Silver moon stud earrings, sterling silver crescent studs")).toEqual([]);
  });
});

describe("fix-first weighs confidence and effort, with traffic capped", () => {
  it("a quick certain fix (no tags) beats a slow one (few photos) on equal traffic", () => {
    const v = buildShopView([row(1, TODAY, 900, { tags: [] }), row(2, TODAY, 900, { image_count: 2 })], TODAY);
    expect(v.fixQueue[0].listingId).toBe(1);
  });
  it("traffic beyond the cap adds nothing", () => {
    const v = buildShopView([row(1, TODAY, 900_000, { title: "Soy candle in amber jar, lavender" }), row(2, TODAY, 5_000_000, { title: "Soy candle in amber jar, lavender" })], TODAY);
    expect(v.listings.find((l) => l.listingId === 1)!.score).toBe(v.listings.find((l) => l.listingId === 2)!.score);
  });
});

describe("seller control over fix tips", () => {
  it("'Not now' hides a tip until its date; 'Don't touch' removes it and marks the listing", () => {
    const rows = [row(1, TODAY, 900, { tags: [] }), row(2, TODAY, 800, { tags: [] })];
    const hidden = buildShopView(rows, TODAY, undefined, { dismissed: { "1": addDays(TODAY, 10) } });
    expect(hidden.fixQueue.map((f) => f.listingId)).toEqual([2]);
    const expired = buildShopView(rows, TODAY, undefined, { dismissed: { "1": addDays(TODAY, -1) } });
    expect(expired.fixQueue.map((f) => f.listingId)).toContain(1);
    const prot = buildShopView(rows, TODAY, undefined, { protectedIds: [2] });
    expect(prot.fixQueue.map((f) => f.listingId)).toEqual([1]);
    expect(prot.listings.find((l) => l.listingId === 2)!.protected).toBe(true);
  });
});

describe("chart day completeness is weighted by views", () => {
  it("a day missing only a tiny listing still counts; missing the best-seller does not", () => {
    const d1 = addDays(TODAY, -2), d2 = addDays(TODAY, -1);
    const base = [row(1, d1, 10_000), row(2, d1, 50), row(3, d1, 60), row(4, d1, 70), row(5, d1, 80),
      row(1, d2, 10_100), row(2, d2, 51), row(3, d2, 61), row(4, d2, 71), row(5, d2, 81)];
    // TODAY: the 4 small listings report, the best-seller does not -> not complete.
    const missBig = buildShopView([...base, row(2, TODAY, 52), row(3, TODAY, 62), row(4, TODAY, 72), row(5, TODAY, 82)], TODAY, [1, 2, 3, 4, 5]);
    expect(missBig.daily.find((d) => d.date === TODAY)?.views ?? null).toBeNull();
    // TODAY: the best-seller and 3 small ones report (4 of 5 by count, ~99% by views) -> complete.
    const missSmall = buildShopView([...base, row(1, TODAY, 10_200), row(2, TODAY, 52), row(3, TODAY, 62), row(4, TODAY, 72)], TODAY, [1, 2, 3, 4, 5]);
    expect(missSmall.daily.find((d) => d.date === TODAY)?.views).toBe(103);
  });
});

describe("natural bounce", () => {
  it("flags a listing that was already falling before the change", () => {
    const START = "2026-08-01";
    let v = 1000;
    const snaps: ListingSnapshot[] = [];
    for (let d = 0; d < 40; d++) {
      v += d < 28 ? 10 : 3; // 10/day for 4 weeks, then 3/day
      snaps.push({ snapshot_date: addDays(START, d), etsy_listing_id: 1, state: "active", views: v, favorites: 1, title: "t", tags: [], description: null, main_image_id: 1, main_image_url: null, image_count: 5 });
    }
    const series = buildDailySeries(snaps);
    expect(wasFallingBefore(series, addDays(START, 29), 3)).toBe(true);
    expect(wasFallingBefore(series, addDays(START, 29), 9)).toBe(false);
  });
});
