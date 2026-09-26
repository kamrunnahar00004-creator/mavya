import Link from "next/link";
import { Clock, Database, Eye, Heart, Package, Search, Sparkles, TrendingUp } from "lucide-react";
import { fetchListingsBatch, parseEtsyListingInput } from "@/lib/etsy";
import { normalizeResearchQuery, summarizeResearch, type ResearchListing } from "@/lib/keyword-research";
import { researchContext, guardedSearch } from "@/lib/research-context";
import { exploreProducts, recordProducts, runKeywordResearch, savedDetails, savedRefs } from "@/lib/research-store";
import { SORTS, parseAgeDays, parsePage, parseSort, parseTab, researchHref, type SortDef } from "@/lib/research";
import {
  AgeFilter,
  EmptyState,
  ErrorNote,
  Pager,
  ProductRows,
  ResearchBar,
  SearchField,
  SearchHero,
  SortMenu,
  Toolbar,
  UpgradeModal,
  btn,
} from "@/components/research/research-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { tab?: string; q?: string; sort?: string; page?: string; age?: string };

const PLACEHOLDER = "Search products by keyword, or paste an Etsy listing link";

/** Sort the 25 search results in memory by the same options Explore offers. */
function sortRows(rows: ResearchListing[], sort: SortDef): ResearchListing[] {
  const val = (t: ResearchListing): number | null =>
    sort.key === "views" ? t.views : sort.key === "favorites" ? t.favorites : sort.key === "newest" ? t.createdAt : sort.key === "price" ? t.priceCents : t.viewsPerDay;
  return [...rows].sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity));
}

/**
 * Product Research: Search (Etsy's top 25 for a phrase, or one listing by
 * link), Explore (every listing Mavya searches have seen), Saved. Views and
 * favorites are Etsy's own counts; Etsy does not publish per-listing sales,
 * so none are shown or estimated.
 */
export default async function ProductResearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await researchContext();
  const tab = parseTab(sp.tab);
  const sort = parseSort("product", sp.sort);
  const age = parseAgeDays(sp.age);

  if (tab === "explore") {
    const page = parsePage(sp.page);
    const locked = !ctx.paid && page > 1;
    const [data, saved] = await Promise.all([exploreProducts(sort, locked ? 1 : page, age, ctx.today), savedRefs(ctx.userId, "product")]);
    const params = { tab: "explore", sort: sort.key === SORTS.product[0].key ? null : sort.key, age };
    return (
      <>
        <ResearchBar kind="product" tab="explore" />
        <Toolbar
          left={<AgeFilter kind="product" age={age} params={params} noun="Listing" />}
          right={
            <>
              {age !== null && (
                <Link href={researchHref("product", { tab: "explore" })} className="px-2 text-[13.5px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                  Clear
                </Link>
              )}
              <Link href={researchHref("product", {})} aria-label="Search products" className={`${btn} w-9 px-0`}>
                <Search className="h-4 w-4" aria-hidden="true" />
              </Link>
              <SortMenu kind="product" sorts={SORTS.product} sort={sort} params={params} />
            </>
          }
        />
        {data.failed ? (
          <ErrorNote>Explore is not ready yet. Try again shortly.</ErrorNote>
        ) : data.rows.length === 0 ? (
          <EmptyState
            Icon={Database}
            title={age === null ? "Nothing to explore yet" : "No listings match this filter"}
            body={age === null ? "Explore fills up as products are researched. Search a keyword to add its top listings." : "Try a longer listing age."}
            action={<Link href={researchHref("product", {})} className={btn}>Search products</Link>}
          />
        ) : (
          <>
            <ProductRows rows={data.rows} saved={new Set(saved.map((s) => s.ref))} />
            <Pager kind="product" page={locked ? 1 : page} total={data.total} params={params} locked={!ctx.paid} />
          </>
        )}
        {locked && <UpgradeModal reason="explore" closeHref={researchHref("product", params)} />}
      </>
    );
  }

  if (tab === "saved") {
    const saved = await savedDetails(ctx.userId, ctx.today);
    return (
      <>
        <ResearchBar kind="product" tab="saved" />
        {saved.products.length === 0 ? (
          <EmptyState Icon={Heart} title="No saved products yet" body="Tap the heart on any listing to keep it here." action={<Link href={researchHref("product", { tab: "explore" })} className={btn}>Explore products</Link>} />
        ) : (
          <ProductRows rows={saved.products} saved={new Set(saved.products.map((p) => String(p.listingId)))} />
        )}
      </>
    );
  }

  const raw = (sp.q ?? "").trim().slice(0, 200);
  const listingId = raw ? parseEtsyListingInput(raw) : null;
  const q = listingId ? String(listingId) : normalizeResearchQuery(raw);
  if (!q) {
    return (
      <>
        <ResearchBar kind="product" tab="search" />
        <SearchHero
          kind="product"
          placeholder={PLACEHOLDER}
          chips={[
            { label: "Most views a day", href: researchHref("product", { tab: "explore" }), Icon: TrendingUp },
            { label: "New and busy", href: researchHref("product", { tab: "explore", age: 90 }), Icon: Sparkles },
            { label: "Most favorited", href: researchHref("product", { tab: "explore", sort: "favorites" }), Icon: Heart },
            { label: "Most viewed", href: researchHref("product", { tab: "explore", sort: "views" }), Icon: Eye },
            { label: "Newest", href: researchHref("product", { tab: "explore", sort: "newest" }), Icon: Clock },
          ]}
          note="Views and favorites are Etsy's own counts. Etsy does not publish sales for single listings, so Mavya never guesses them."
        />
      </>
    );
  }

  const result = listingId
    ? await guardedSearch(ctx, "product", q, async () => {
        const details = await fetchListingsBatch([listingId]);
        const l = details.get(listingId);
        if (!l) return { rows: [] as ResearchListing[], competition: null as number | null };
        const rows = summarizeResearch(l.title, 1, [l], details, ctx.today).top;
        await recordProducts(rows, ctx.today);
        return { rows, competition: null };
      })
    : await guardedSearch(ctx, "keyword", q, async () => {
        const r = await runKeywordResearch(q, ctx.today);
        return { rows: r.top, competition: r.competition as number | null };
      });

  if (!result.data) {
    return (
      <>
        <ResearchBar kind="product" tab="search" />
        <SearchHero kind="product" placeholder={PLACEHOLDER} chips={[]} error={result.error} />
        {result.blocked && <UpgradeModal reason="searches" closeHref={researchHref("product", {})} />}
      </>
    );
  }
  const saved = await savedRefs(ctx.userId, "product");
  const rows = sortRows(result.data.rows, sort);
  const params = { q: raw, sort: sort.key === SORTS.product[0].key ? null : sort.key };
  return (
    <>
      <ResearchBar kind="product" tab="search" />
      <div className="border-b border-[var(--color-border)] bg-white px-4 py-4 sm:px-8">
        <SearchField kind="product" q={raw} placeholder={PLACEHOLDER} />
      </div>
      <Toolbar
        left={
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-[var(--color-ink)]">{listingId ? "Listing" : `Top ${rows.length} Etsy listings for "${q}"`}</p>
            {result.data.competition !== null && (
              <p className="text-[13px] text-[var(--color-ink-muted)]">
                {result.data.competition.toLocaleString("en-US")} competing listings.{" "}
                <Link href={researchHref("keyword", { q })} className="font-semibold text-[var(--color-primary)] hover:underline">
                  Keyword numbers
                </Link>
              </p>
            )}
          </div>
        }
        right={!listingId && <SortMenu kind="product" sorts={SORTS.product} sort={sort} params={params} />}
      />
      {rows.length === 0 ? (
        <EmptyState Icon={Package} title="Nothing found" body={listingId ? "That listing is not active on Etsy." : "No active Etsy listings match this search."} />
      ) : (
        <ProductRows rows={rows} saved={new Set(saved.map((s) => s.ref))} />
      )}
    </>
  );
}
