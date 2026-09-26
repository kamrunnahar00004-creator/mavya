import { describe, expect, it } from "vitest";
import { isValidEtsyTag, normalizeResearchQuery, summarizeResearch } from "@/lib/keyword-research";
import type { EtsyListing } from "@/lib/etsy";

const TODAY = "2026-09-26";
const now = Date.parse(`${TODAY}T00:00:00Z`) / 1000;
const listing = (id: number, extra: Partial<EtsyListing> = {}): EtsyListing => ({
  listingId: id, shopId: 1, state: "active", title: `Sticker pack ${id}`, description: "", tags: ["laptop stickers", "cute stickers"],
  views: 1000, favorites: 50, priceCents: 500 + id, currency: "USD", url: `https://www.etsy.com/listing/${id}`, createdAt: now - 100 * 86_400, images: [], ...extra,
});

describe("keyword research", () => {
  it("normalizes the search phrase", () => {
    expect(normalizeResearchQuery("  sticker   pack ")).toBe("sticker pack");
    expect(normalizeResearchQuery("a")).toBeNull();
    expect(normalizeResearchQuery(undefined)).toBeNull();
  });

  it("knows which phrases are usable as Etsy tags", () => {
    expect(isValidEtsyTag("laptop stickers")).toBe(true);
    expect(isValidEtsyTag("this phrase is far too long")).toBe(false);
    expect(isValidEtsyTag("stickers!")).toBe(false);
  });

  it("summarizes real numbers: competition, views a day, new share, price, shared tags", () => {
    const results = [
      listing(1, { views: 3000, createdAt: now - 30 * 86_400, tags: ["laptop stickers", "sticker pack"] }),
      listing(2, { views: 1000, createdAt: now - 1000 * 86_400 }),
      listing(3, { views: 500, createdAt: now - 100 * 86_400, tags: ["vinyl stickers"] }),
    ];
    const r = summarizeResearch("sticker pack", 196_510, results, new Map(), TODAY);
    expect(r.competition).toBe(196_510);
    expect(r.top.map((t) => t.viewsPerDay)).toEqual([100, 1, 5]);
    expect(r.topViewsPerDay).toBe(5);
    expect(r.newShare).toBeCloseTo(1 / 3);
    expect(r.medianPriceCents).toBe(502);
    // The searched phrase itself is not a "similar" keyword; tags need 2+ listings.
    expect(r.similar.map((s) => s.tag)).toEqual(["laptop stickers"]);
    expect(r.similar[0]).toMatchObject({ count: 2, total: 3, valid: true });
  });

  it("prefers the fresh details (price, photo, tags) over the cached search row", () => {
    const d = new Map([[1, listing(1, { priceCents: 999, images: [{ id: 1, rank: 1, url570: "https://i.etsystatic.com/x/il_570xN.1.jpg", url170: null, urlFull: null }] })]]);
    const r = summarizeResearch("sticker pack", 10, [listing(1, { priceCents: null })], d, TODAY);
    expect(r.top[0]).toMatchObject({ priceCents: 999, image: "https://i.etsystatic.com/x/il_170x135.1.jpg" });
  });
});
