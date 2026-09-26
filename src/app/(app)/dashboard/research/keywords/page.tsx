import Link from "next/link";
import { BarChart3, Clock, Database, Heart, Target, TrendingUp, Zap } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeResearchQuery } from "@/lib/keyword-research";
import { researchContext, guardedSearch } from "@/lib/research-context";
import { exploreKeywords, runKeywordResearch, savedDetails, savedRefs, syncKeywordHistoryBriefly } from "@/lib/research-store";
import { KEYWORD_FILTERS, SORTS, parsePage, parseSort, parseTab, parseWhole, researchHref } from "@/lib/research";
import { KeywordExplore } from "@/components/research/keyword-explore";
import { KeywordDetail } from "@/components/research/keyword-detail";
import {
  EmptyState,
  ErrorNote,
  FilterMenu,
  Pager,
  ResearchBar,
  SearchHero,
  UpgradeModal,
  btn,
} from "@/components/research/research-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { tab?: string; q?: string; sort?: string; page?: string; valid?: string; minScore?: string; maxKd?: string; maxComp?: string; minViews?: string; find?: string };

/**
 * Keyword Research: Search (any phrase, live Etsy numbers), Explore (every
 * keyword Mavya sellers have researched, sortable), Saved (this account's).
 */
export default async function KeywordResearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await researchContext();
  const tab = parseTab(sp.tab);

  if (tab === "explore") {
    const sort = parseSort("keyword", sp.sort);
    const page = parsePage(sp.page);
    const locked = !ctx.paid && page > 1;
    const filters = {
      minScore: parseWhole(sp.minScore, 100),
      maxDifficulty: parseWhole(sp.maxKd, 100),
      maxCompetition: parseWhole(sp.maxComp, 100_000_000),
      minViews: parseWhole(sp.minViews, 100_000_000),
      find: normalizeResearchQuery(sp.find)?.toLowerCase() ?? null,
    };
    // Fill Explore from searches Mavya already stored (a few keywords per visit; the daily cron does the rest).
    try {
      await syncKeywordHistoryBriefly(ctx.today);
    } catch {
      // Best effort; Explore still shows what is stored.
    }
    const [data, saved] = await Promise.all([exploreKeywords(sort, locked ? 1 : page, filters, ctx.today), savedRefs(ctx.userId, "keyword")]);
    const filterValues = { minScore: filters.minScore, maxKd: filters.maxDifficulty, maxComp: filters.maxCompetition, minViews: filters.minViews };
    const params = { tab: "explore", sort: sort.key === SORTS.keyword[0].key ? null : sort.key, ...filterValues, find: filters.find };
    const sortHrefs = Object.fromEntries(SORTS.keyword.map((s) => [s.key, researchHref("keyword", { ...params, sort: s.key === SORTS.keyword[0].key ? null : s.key, page: null })]));
    const findHidden = Object.fromEntries(
      Object.entries({ ...params, find: null }).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])
    );
    return (
      <div className="min-h-[calc(100dvh-57px)] bg-white">
        <ResearchBar kind="keyword" tab="explore" />
        {data.failed ? (
          <ErrorNote>Explore is not ready yet. Try again shortly.</ErrorNote>
        ) : (
          <KeywordExplore
            rows={data.rows}
            savedRefs={saved.map((s) => s.ref)}
            sortKey={sort.key}
            sortHrefs={sortHrefs}
            keywordHref={Object.fromEntries(data.rows.map((r) => [r.keyword, researchHref("keyword", { q: r.keyword })]))}
            filterSlot={<FilterMenu kind="keyword" defs={KEYWORD_FILTERS} values={filterValues} params={params} />}
            findAction={researchHref("keyword", {})}
            findHidden={findHidden}
            find={filters.find}
            footer={
              data.rows.length === 0 ? (
                <EmptyState
                  Icon={Database}
                  title={filters.find || Object.values(filterValues).some((v) => v !== null) ? "No keywords match" : "Nothing to explore yet"}
                  body={filters.find || Object.values(filterValues).some((v) => v !== null) ? "Try fewer filters." : "Explore fills up as keywords are researched. Search one to add it."}
                  action={<Link href={researchHref("keyword", {})} className={btn}>Search a keyword</Link>}
                />
              ) : (
                <Pager kind="keyword" page={locked ? 1 : page} total={data.total} params={params} locked={!ctx.paid} />
              )
            }
          />
        )}
        {locked && <UpgradeModal reason="explore" closeHref={researchHref("keyword", params)} />}
      </div>
    );
  }

  if (tab === "saved") {
    const saved = await savedDetails(ctx.userId, ctx.today);
    return (
      <div className="min-h-[calc(100dvh-57px)] bg-white">
        <ResearchBar kind="keyword" tab="saved" />
        {saved.keywords.length === 0 ? (
          <EmptyState Icon={Heart} title="No saved keywords yet" body="Tick keywords in Explore and press Save to keep them here." action={<Link href={researchHref("keyword", { tab: "explore" })} className={btn}>Explore keywords</Link>} />
        ) : (
          <KeywordExplore
            mode="saved"
            rows={saved.keywords}
            savedRefs={saved.keywords.map((k) => k.keyword)}
            keywordHref={Object.fromEntries(saved.keywords.map((r) => [r.keyword, researchHref("keyword", { q: r.keyword })]))}
          />
        )}
      </div>
    );
  }

  const q = normalizeResearchQuery(sp.q);
  if (!q) {
    const supabase = await createSupabaseServerClient();
    const { data: monitors } = await supabase.from("listing_monitors").select("keywords").limit(20);
    const mine = [...new Set(((monitors as { keywords: string[] | null }[] | null) ?? []).flatMap((m) => m.keywords ?? []))].slice(0, 5);
    return (
      <>
        <ResearchBar kind="keyword" tab="search" />
        <SearchHero
          kind="keyword"
          placeholder="Search for keywords or niches"
          chips={[
            { label: "Trending keywords", href: researchHref("keyword", { tab: "explore", sort: "change" }), Icon: TrendingUp },
            { label: "Most viewed keywords", href: researchHref("keyword", { tab: "explore", sort: "views" }), Icon: BarChart3 },
            { label: "Low competition gems", href: researchHref("keyword", { tab: "explore", sort: "kd" }), Icon: Zap },
            { label: "Best opportunities", href: researchHref("keyword", { tab: "explore" }), Icon: Target },
            { label: "Recently checked", href: researchHref("keyword", { tab: "explore", sort: "recent" }), Icon: Clock },
          ]}
          mine={mine.map((k) => ({ label: k, href: researchHref("keyword", { q: k }), Icon: BarChart3 }))}
          note="Live Etsy numbers: competing listings, how busy the top listings are, and the tags they share. Etsy does not publish search volume, so Mavya never guesses it."
        />
      </>
    );
  }

  const result = await guardedSearch(ctx, "keyword", q, () => runKeywordResearch(q, ctx.today));
  if (!result.data) {
    return (
      <>
        <ResearchBar kind="keyword" tab="search" />
        <SearchHero kind="keyword" placeholder="Search for keywords or niches" chips={[]} error={result.error} />
        {result.blocked && <UpgradeModal reason="searches" closeHref={researchHref("keyword", {})} />}
      </>
    );
  }
  const saved = await savedRefs(ctx.userId, "keyword");
  return (
    <>
      <ResearchBar kind="keyword" tab="search" />
      <KeywordDetail r={result.data} validOnly={sp.valid === "1"} saved={saved.some((s) => s.ref === q.toLowerCase())} />
    </>
  );
}
