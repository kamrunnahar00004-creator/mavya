import { redirect } from "next/navigation";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/errors";
import { fetchListingsBatch, isEtsyConfigured } from "@/lib/etsy";
import { getSearchCached } from "@/lib/search-cache";
import { todayUtc } from "@/lib/listing-monitor";
import { normalizeResearchQuery, summarizeResearch, RESEARCH_TOP, type KeywordResearch } from "@/lib/keyword-research";
import { KeywordResearchView } from "@/components/dashboard/keyword-research-view";
import { PageBar } from "@/components/page-bar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Searches per account per day (each new phrase costs about 2 Etsy calls; repeats are cached). */
const DAILY_SEARCHES = 60;

/**
 * Keyword research: any phrase, real public Etsy numbers. Paid plans only
 * (free accounts see the page with a lock). The search itself is shared and
 * cached per phrase per day, so popular phrases cost nothing after the first.
 */
export default async function KeywordResearchPage({ searchParams }: { searchParams: Promise<{ q?: string; valid?: string }> }) {
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");
  const { q: rawQ, valid } = await searchParams;
  const q = normalizeResearchQuery(rawQ);
  const supabase = await createSupabaseServerClient();
  const [entitlement, monitors] = await Promise.all([
    getEntitlement(user.id),
    supabase.from("listing_monitors").select("keywords").limit(20),
  ]);
  const locked = !entitlement.active;
  const suggestions = [...new Set(((monitors.data as { keywords: string[] | null }[] | null) ?? []).flatMap((m) => m.keywords ?? []))].slice(0, 6);

  let research: KeywordResearch | null = null;
  let error: string | null = null;
  if (q && !locked) {
    if (!isEtsyConfigured()) {
      error = "Etsy connection is not set up yet.";
    } else if (!(await rateLimit(`kw-research:u:${user.id}`, DAILY_SEARCHES, 86_400_000)).ok) {
      error = `You have run ${DAILY_SEARCHES} searches today. Try again tomorrow.`;
    } else {
      try {
        research = await runResearch(q);
      } catch (err) {
        logEvent("keyword_research.failed", { userId: user.id, error: err instanceof Error ? err.message.slice(0, 80) : "unknown" });
        error = "Could not reach Etsy for this search. Try again in a minute.";
      }
    }
  }

  return (
    <>
      <PageBar crumbs={q && !locked ? [{ label: "Keyword research", href: "/dashboard/keywords" }, { label: q }] : [{ label: "Keyword research" }]} />
      <KeywordResearchView q={q} research={research} error={error} locked={locked} suggestions={suggestions} validOnly={valid === "1"} />
    </>
  );
}

/** One research run: shared daily search cache, then one details call for the top 25. */
async function runResearch(q: string): Promise<KeywordResearch> {
  const deadline = Date.now() + 40_000;
  const today = todayUtc();
  const search = await getSearchCached(createSupabaseAdminClient(), q, today, deadline);
  const details = await fetchListingsBatch(search.results.slice(0, RESEARCH_TOP).map((l) => l.listingId), deadline);
  return summarizeResearch(q, search.count, search.results, details, today);
}
