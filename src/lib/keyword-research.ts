import type { EtsyListing } from "@/lib/etsy";

/**
 * Keyword research (2026-09-26): real public Etsy numbers for any search
 * phrase. PURE, so it is unit-tested; the page does the (cached) fetching.
 *
 * Honesty: Etsy does not publish search volume, so nothing here claims it.
 * "Demand" is shown as what the top listings actually get (views per day since
 * listed), labeled as such.
 */

export type ResearchListing = {
  rank: number;
  listingId: number;
  title: string;
  url: string | null;
  image: string | null;
  views: number | null;
  favorites: number | null;
  viewsPerDay: number | null;
  priceCents: number | null;
  currency: string | null;
  ageDays: number | null;
};

export type SimilarKeyword = { tag: string; count: number; total: number; valid: boolean };

export type KeywordResearch = {
  keyword: string;
  /** Matching active listings on Etsy (search count). */
  competition: number;
  /** Median views per day since listed, top 10 results. */
  topViewsPerDay: number | null;
  /** Share of the top 25 listed in the last 90 days (can new listings break in?). */
  newShare: number | null;
  medianPriceCents: number | null;
  currency: string | null;
  similar: SimilarKeyword[];
  top: ResearchListing[];
};

export const RESEARCH_TOP = 25;
const ETSY_TAG = /^[\p{L}\p{N} '\-&]+$/u;

/** A search phrase as the page accepts it: trimmed, single-spaced, 2 to 80 characters. */
export function normalizeResearchQuery(raw: string | undefined | null): string | null {
  const q = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return q.length >= 2 ? q : null;
}

/** Could this phrase be used as an Etsy tag as-is (20 characters, allowed characters)? */
export function isValidEtsyTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= 20 && ETSY_TAG.test(tag);
}

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarizeResearch(
  keyword: string,
  count: number,
  results: EtsyListing[],
  details: Map<number, EtsyListing>,
  today: string
): KeywordResearch {
  const now = Date.parse(`${today}T00:00:00Z`) / 1000;
  const top: ResearchListing[] = results.slice(0, RESEARCH_TOP).map((r, i) => {
    const d = details.get(r.listingId);
    const createdAt = d?.createdAt ?? r.createdAt;
    const views = d?.views ?? r.views;
    const ageDays = typeof createdAt === "number" && createdAt > 0 ? Math.max(1, Math.round((now - createdAt) / 86_400)) : null;
    const image = d?.images[0]?.url570 ?? null;
    return {
      rank: i + 1,
      listingId: r.listingId,
      title: d?.title || r.title,
      url: d?.url ?? r.url,
      image: image && image.includes("/il_570xN.") ? image.replace("/il_570xN.", "/il_170x135.") : image,
      views,
      favorites: d?.favorites ?? r.favorites,
      viewsPerDay: typeof views === "number" && ageDays !== null ? views / ageDays : null,
      priceCents: d?.priceCents ?? r.priceCents ?? null,
      currency: d?.currency ?? r.currency ?? null,
      ageDays,
    };
  });

  const topViews = median(top.slice(0, 10).map((t) => t.viewsPerDay).filter((v): v is number => v !== null));
  const aged = top.filter((t) => t.ageDays !== null);
  const newShare = aged.length ? aged.filter((t) => (t.ageDays as number) <= 90).length / aged.length : null;
  const priced = top.filter((t) => t.priceCents !== null);
  const currency = priced[0]?.currency ?? null;
  const medianPriceCents = median(priced.filter((t) => t.currency === currency).map((t) => t.priceCents as number));

  // Similar keywords: tags the top listings actually use (2+ of them).
  const counts = new Map<string, number>();
  const own = keyword.toLowerCase();
  for (const r of results.slice(0, RESEARCH_TOP)) {
    const d = details.get(r.listingId);
    for (const t of new Set((d?.tags.length ? d.tags : r.tags).map((x) => x.trim().toLowerCase()).filter(Boolean))) {
      if (t === own) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const total = Math.min(RESEARCH_TOP, results.length);
  const similar = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([tag, n]) => ({ tag, count: n, total, valid: isValidEtsyTag(tag) }));

  return {
    keyword,
    competition: count,
    topViewsPerDay: topViews === null ? null : Math.round(topViews * 10) / 10,
    newShare,
    medianPriceCents: medianPriceCents === null ? null : Math.round(medianPriceCents),
    currency,
    similar,
    top,
  };
}
