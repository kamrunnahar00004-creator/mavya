import type { SupabaseClient } from "@supabase/supabase-js";
import { getSearchCached } from "@/lib/search-cache";
import { suggestKeywords, comparablePeers, keywordIsRelevant } from "@/lib/listing-analytics";
import { buildCandidates, labelKeyword, rankIdeas, viewsPerDayMedian, type KeywordIdea } from "@/lib/keyword-finder";

/**
 * Run the keyword finder for one listing. SERVER ONLY (service-role client for
 * the shared search cache). Cost: at most 1 + MAX_CANDIDATES cached searches,
 * i.e. near zero Etsy calls when other sellers checked the same phrases today.
 */
export async function findKeywordIdeas(
  admin: SupabaseClient,
  listing: { listingId: number; title: string; tags: string[] },
  mainKeyword: string | null,
  today: string,
  deadlineAt = Date.now() + 40_000
): Promise<KeywordIdea[]> {
  const main = mainKeyword || suggestKeywords(listing.title, listing.tags)[0];
  if (!main) return [];
  const base = await getSearchCached(admin, main, today, deadlineAt);
  const candidates = buildCandidates({
    title: listing.title,
    tags: listing.tags,
    topTags: comparablePeers(listing, base.results.filter((l) => l.listingId !== listing.listingId).slice(0, 25)).map((l) => l.tags),
  });
  if (!candidates.includes(main)) candidates.unshift(main);

  const own = new Set(listing.tags.map((t) => t.trim().toLowerCase()));
  const ideas: KeywordIdea[] = [];
  for (const keyword of candidates) {
    if (Date.now() > deadlineAt - 2_000) break;
    try {
      const r = keyword === main ? base : await getSearchCached(admin, keyword, today, deadlineAt);
      const relevant = keywordIsRelevant(listing, keyword, r.results);
      if (!relevant) continue;
      const peers = comparablePeers(listing, r.results.filter(l => l.listingId !== listing.listingId));
      const idx = r.results.findIndex((l) => l.listingId === listing.listingId);
      const stats = {
        competition: r.count,
        interest: peers.length >= 3 ? viewsPerDayMedian(peers.slice(0, 10), today) : null,
        position: idx >= 0 ? idx + 1 : null,
        inTags: own.has(keyword),
      };
      ideas.push({ keyword, ...stats, label: labelKeyword(stats) });
    } catch {
      // One failed search never blocks the other ideas.
    }
  }
  return rankIdeas(ideas);
}
