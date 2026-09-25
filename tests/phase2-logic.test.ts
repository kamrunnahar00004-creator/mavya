import { describe, expect, it } from "vitest";
import { buildCandidates, labelKeyword, rankIdeas, type KeywordIdea } from "@/lib/keyword-finder";
import { buildShopView, titleIssues, type ShopSnapshotRow } from "@/lib/shop-analytics";
import { addDays } from "@/lib/listing-analytics";
import { parseEtsyShopInput } from "@/lib/etsy";
import { ALLOWED_LISTING_LIMITS, getPlanPolicy, keywordLimitFor } from "@/lib/plans";
import { finalizeWriterOutput, tagReasons, type WriterContext } from "@/lib/listing-writer";

describe("keyword labels (real 2026-09-24 Coraline numbers)", () => {
  const cases: [string, Parameters<typeof labelKeyword>[0], string][] = [
    ["coraline doll crochet pattern", { competition: 134, interest: 9989, position: 1, inTags: false }, "winning"],
    ["coraline doll", { competition: 1119, interest: 2451, position: 68, inTags: false }, "add"],
    ["coraline", { competition: 5773, interest: 447, position: null, inTags: true }, "keep"],
    ["amigurumi", { competition: 585215, interest: 3268, position: null, inTags: true }, "crowded"],
    ["crochet pattern", { competition: 963522, interest: 7573, position: null, inTags: true }, "crowded"],
    ["amigurumi fan art (pdf)", { competition: 401, interest: 81, position: 1, inTags: false }, "quiet"],
  ];
  it.each(cases)("%s", (_k, stats, label) => expect(labelKeyword(stats)).toBe(label));

  it("ranks winning and add-as-tag ideas before crowded and quiet ones", () => {
    const ideas = cases.map(([keyword, s]) => ({ keyword, ...s, label: labelKeyword(s) })) as KeywordIdea[];
    expect(rankIdeas(ideas).map((i) => i.label)).toEqual(["winning", "add", "keep", "crowded", "crowded", "quiet"]);
  });

  it("builds relevant 2-4 word candidates only", () => {
    const c = buildCandidates({
      title: "Coraline Doll Crochet Pattern, Amigurumi Fan Art (PDF)",
      tags: ["coraline", "amigurumi", "crochet pattern", "pattern"],
      topTags: Array.from({ length: 24 }, (_, i) => (i < 10 ? ["coraline doll", "amigurumi doll", "baby blanket"] : ["coraline pattern"])),
    });
    expect(c).toContain("coraline doll crochet pattern");
    expect(c).toContain("coraline doll");
    expect(c).toContain("coraline pattern");
    expect(c).not.toContain("pattern"); // single generic word
    expect(c).not.toContain("baby blanket"); // shares no word with the listing
  });
});

describe("writer uses the keyword check", () => {
  const ideas: KeywordIdea[] = [
    { keyword: "coraline doll", label: "add", competition: 1119, interest: 2451, position: 68, inTags: false },
    { keyword: "digital crochet", label: "crowded", competition: 240847, interest: 0, position: null, inTags: false },
  ];
  const ctx: WriterContext = {
    current: { title: "Coraline Doll Crochet Pattern", tags: ["coraline"], description: "" },
    photo: { productSummary: null, category: null },
    keywords: [],
    winnerTags: [],
    ideas,
    isDigital: true,
    facts: {},
  };
  it("explains tags with checked numbers", () => {
    expect(tagReasons(["coraline doll"], ctx)[0].reason).toBe("Low competition (1.1K listings), you about #68");
  });
  it("drops NEW tags the check marked crowded or quiet", () => {
    const out = finalizeWriterOutput(
      { titles: ["Coraline Doll Crochet Pattern PDF", "Crochet Pattern PDF for a Coraline Doll"], tags: ["coraline", "coraline doll", "digital crochet", "doll pattern", "crochet doll", "amigurumi doll", ...Array.from({ length: 8 }, (_, i) => `tag ${i}`)], description: "A crochet pattern for a doll, sent as a PDF." },
      ctx
    );
    expect(out.tags.map((t) => t.tag)).not.toContain("digital crochet");
    expect(out.tags.map((t) => t.tag)).toContain("coraline");
  });
});

describe("shop link parsing", () => {
  it("accepts names and shop links, rejects other hosts", () => {
    expect(parseEtsyShopInput("WisdomHouseCo")).toBe("WisdomHouseCo");
    expect(parseEtsyShopInput("https://www.etsy.com/shop/WisdomHouseCo?ref=x")).toBe("WisdomHouseCo");
    expect(parseEtsyShopInput("etsy.com/shop/WisdomHouseCo")).toBe("WisdomHouseCo");
    expect(parseEtsyShopInput("https://evil.com/shop/WisdomHouseCo")).toBeNull();
    expect(parseEtsyShopInput("my shop!")).toBeNull();
  });
});

describe("plans by shop size (prices unchanged)", () => {
  it("100 / 300 / 1,000 listings and 10 / 30 / 100 keywords at $29 / $59 / $99", () => {
    expect(ALLOWED_LISTING_LIMITS).toEqual([100, 300, 1000]);
    for (const [plan, listings, keywords, cents] of [["starter", 100, 10, 2900], ["shop", 300, 30, 5900], ["power", 1000, 100, 9900]] as const) {
      const p = getPlanPolicy(plan, "monthly")!;
      expect(p.activeListingLimit).toBe(listings);
      expect(keywordLimitFor(p.activeListingLimit)).toBe(keywords);
      expect(p.priceCents).toBe(cents);
    }
    expect(keywordLimitFor(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shop analytics
// ---------------------------------------------------------------------------

const TODAY = "2026-10-30";
function history(listingId: number, perDay: (d: number) => number, opts: Partial<ShopSnapshotRow> & { days?: number; favPer100?: number; change?: { day: number; patch: Partial<ShopSnapshotRow> } } = {}): ShopSnapshotRow[] {
  const days = opts.days ?? 40;
  const rows: ShopSnapshotRow[] = [];
  let views = 1000;
  let favs = 50;
  for (let d = days - 1; d >= 0; d--) {
    const dayIndex = days - 1 - d;
    const inc = perDay(dayIndex);
    views += inc;
    favs += Math.round((inc * (opts.favPer100 ?? 5)) / 100);
    const base: ShopSnapshotRow = {
      listing_id: listingId,
      snapshot_date: addDays(TODAY, -d),
      views,
      favorites: favs,
      image_count: opts.image_count ?? 8,
      main_image_id: 1,
      main_image_url: null,
      title: opts.title ?? `Listing ${listingId} handmade soy candle gift for her, lavender scented jar candle`,
      tags: opts.tags ?? Array.from({ length: 13 }, (_, i) => `tag ${i}`),
    };
    rows.push(opts.change && dayIndex >= opts.change.day ? { ...base, ...opts.change.patch } : base);
  }
  return rows;
}

describe("shop home", () => {
  it("says collecting (no rising/falling) before 14 days of history", () => {
    const v = buildShopView(history(1, () => 10, { days: 5 }), TODAY);
    expect(v.historyDays).toBe(5);
    expect(v.listings[0].status).toBe("collecting");
  });

  it("classifies rising, falling, dead, and seen-not-liked", () => {
    const rows = [
      ...history(1, (d) => (d >= 33 ? 30 : 10)), // rising last week
      ...history(2, (d) => (d >= 33 ? 2 : 20)), // falling last week
      ...history(3, () => 0), // no views
      ...history(4, () => 10, { favPer100: 1 }), // seen, not liked vs shop
      ...history(5, () => 10),
      ...history(6, () => 10),
    ];
    const v = buildShopView(rows, TODAY);
    const status = (id: number) => v.listings.find((l) => l.listingId === id)!.status;
    expect(status(1)).toBe("rising");
    expect(status(2)).toBe("falling");
    expect(status(3)).toBe("dead");
    expect(status(4)).toBe("seen_not_liked");
    expect(v.counts).toMatchObject({ rising: 1, falling: 1, dead: 1, seen_not_liked: 1 });
  });

  it("puts listings with real problems in Fix these 3, with one action each", () => {
    const rows = [
      ...history(1, () => 20, { tags: ["only one"] }),
      ...history(2, () => 20, { image_count: 2 }),
      ...history(3, () => 20),
    ];
    const v = buildShopView(rows, TODAY);
    expect(v.fixQueue.map((f) => f.listingId).sort()).toEqual([1, 2]);
    expect(v.fixQueue.find((f) => f.listingId === 1)).toMatchObject({ action: "write", reason: "12 empty tag slots" });
    expect(v.fixQueue.find((f) => f.listingId === 2)).toMatchObject({ action: "photo", reason: "Only 2 photos" });
  });

  it("ranks title and photo problems, not only tags", () => {
    const rows = [
      ...history(1, () => 20, { title: "Candle" }),
      ...history(2, () => 20, { image_count: 2, tags: ["a b", "c d"] }),
      ...history(3, () => 20, { tags: Array.from({ length: 10 }, (_, i) => `tag ${i}`) }),
    ];
    const v = buildShopView(rows, TODAY);
    expect(v.fixQueue.find((f) => f.listingId === 1)).toMatchObject({ action: "write", reason: "Very short title" });
    // Photo problem is shown first and drives the action; tags come second.
    expect(v.fixQueue.find((f) => f.listingId === 2)).toMatchObject({ action: "photo", reason: "Only 2 photos · 11 empty tag slots" });
    // The seller is told what to DO, and the button names the first step.
    expect(v.fixQueue.find((f) => f.listingId === 1)).toMatchObject({ todo: "Write a fuller title (say what it is and who it is for).", button: "Fix title" });
    expect(v.fixQueue.find((f) => f.listingId === 2)).toMatchObject({ todo: "Add more photos (only 2), then fill 11 empty tags.", button: "Add photos" });
    // A few empty tag slots alone rank below a missing title or photos.
    expect(v.fixQueue.map((f) => f.listingId).slice(0, 2).sort()).toEqual([1, 2]);
  });

  it("flags visible title problems", () => {
    expect(titleIssues("Candle")[0]).toMatchObject({ kind: "title", severity: "high" });
    expect(titleIssues("Soy candle soy candle soy candle lavender jar gift for her handmade")).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Title repeats "soy"' })])
    );
    expect(titleIssues("HANDMADE LAVENDER SOY CANDLE GIFT FOR HER IN AMBER JAR WITH WOOD WICK")).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "Title in capitals" })])
    );
    expect(titleIssues("Handmade lavender soy candle gift for her, amber jar with a crackling wood wick")).toEqual([]);
  });

  it("compares a change with the rest of the shop over the same days", () => {
    const change = { day: 30, patch: { title: "New title" } };
    const rows = [
      ...history(1, (d) => (d > 30 ? 30 : 10), { change }), // tripled after its title change
      ...history(2, () => 10),
      ...history(3, () => 12),
      ...history(4, () => 8),
    ];
    const v = buildShopView(rows, TODAY);
    const c = v.changes.find((x) => x.listingId === 1)!;
    expect(c.kinds).toEqual(["title"]);
    expect(c.verdict).toBe("better");
    expect(v.summary).toEqual({ measured: 1, better: 1 });
  });

  it("does not call a shop-wide rise a win", () => {
    const change = { day: 30, patch: { title: "New title" } };
    const lift = (d: number) => (d > 30 ? 30 : 10);
    const rows = [...history(1, lift, { change }), ...history(2, lift), ...history(3, lift), ...history(4, lift)];
    const c = buildShopView(rows, TODAY).changes.find((x) => x.listingId === 1)!;
    expect(c.verdict).toBe("no_change");
  });
});

describe("Etsy text decoding", () => {
  it("decodes HTML entities Etsy puts in titles, tags, and descriptions", async () => {
    const { normalizeListing, decodeEntities } = await import("@/lib/etsy");
    expect(decodeEntities("Smells Like She&#39;s Reading &amp; &quot;Cozy&quot;")).toBe('Smells Like She\'s Reading & "Cozy"');
    expect(decodeEntities("&amp;#39;")).toBe("&#39;"); // decoded once, never twice
    const l = normalizeListing({ listing_id: 1, title: "Mom&#39;s Candle", tags: ["mom&#39;s gift"], description: "a &amp; b" });
    expect(l).toMatchObject({ title: "Mom's Candle", tags: ["mom's gift"], description: "a & b" });
  });
});
