import Link from "next/link";
import { BarChart3, Clock, Database, DollarSign, Heart, Search, Sparkles, TrendingUp, Zap } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeResearchQuery } from "@/lib/keyword-research";
import { researchContext, guardedSearch } from "@/lib/research-context";
import { exploreKeywords, runKeywordResearch, savedDetails, savedRefs } from "@/lib/research-store";
import { SORTS, parsePage, parseSort, parseTab, researchHref } from "@/lib/research";
import { KeywordDetail } from "@/components/research/keyword-detail";
import {
  EmptyState,
  ErrorNote,
  KeywordTable,
  Pager,
  ResearchBar,
  SearchHero,
  SortMenu,
  Toolbar,
  UpgradeModal,
  btn,
} from "@/components/research/research-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { tab?: string; q?: string; sort?: string; page?: string; valid?: string };

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
    const [data, saved] = await Promise.all([exploreKeywords(sort, locked ? 1 : page), savedRefs(ctx.userId, "keyword")]);
    const params = { tab: "explore", sort: sort.key === SORTS.keyword[0].key ? null : sort.key };
    return (
      <>
        <ResearchBar kind="keyword" tab="explore" />
        <Toolbar
          left={<p className="text-[14px] text-[var(--color-ink-muted)]">Every keyword researched on Mavya, with live Etsy numbers from the day it was checked.</p>}
          right={
            <>
              <Link href={researchHref("keyword", {})} aria-label="Search keywords" className={`${btn} w-9 px-0`}>
                <Search className="h-4 w-4" aria-hidden="true" />
              </Link>
              <SortMenu kind="keyword" sorts={SORTS.keyword} sort={sort} params={params} />
            </>
          }
        />
        {data.failed ? (
          <ErrorNote>Explore is not ready yet. Try again shortly.</ErrorNote>
        ) : data.rows.length === 0 ? (
          <EmptyState Icon={Database} title="Nothing to explore yet" body="Explore fills up as keywords are researched. Search one to add it." action={<Link href={researchHref("keyword", {})} className={btn}>Search a keyword</Link>} />
        ) : (
          <>
            <KeywordTable rows={data.rows} saved={new Set(saved.map((s) => s.ref))} sort={sort} sortHref={(k) => researchHref("keyword", { ...params, sort: k === SORTS.keyword[0].key ? null : k })} />
            <Pager kind="keyword" page={locked ? 1 : page} total={data.total} params={params} locked={!ctx.paid} />
          </>
        )}
        {locked && <UpgradeModal reason="explore" closeHref={researchHref("keyword", params)} />}
      </>
    );
  }

  if (tab === "saved") {
    const saved = await savedDetails(ctx.userId, ctx.today);
    return (
      <>
        <ResearchBar kind="keyword" tab="saved" />
        {saved.keywords.length === 0 ? (
          <EmptyState Icon={Heart} title="No saved keywords yet" body="Tap the heart on any keyword to keep it here." action={<Link href={researchHref("keyword", { tab: "explore" })} className={btn}>Explore keywords</Link>} />
        ) : (
          <div className="pt-2">
            <KeywordTable rows={saved.keywords} saved={new Set(saved.keywords.map((k) => k.keyword))} />
          </div>
        )}
      </>
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
            { label: "Busiest keywords", href: researchHref("keyword", { tab: "explore" }), Icon: TrendingUp },
            { label: "Low competition", href: researchHref("keyword", { tab: "explore", sort: "competition" }), Icon: Zap },
            { label: "Room for new listings", href: researchHref("keyword", { tab: "explore", sort: "new" }), Icon: Sparkles },
            { label: "Higher price", href: researchHref("keyword", { tab: "explore", sort: "price" }), Icon: DollarSign },
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
