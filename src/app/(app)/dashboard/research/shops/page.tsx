import Link from "next/link";
import { ArrowLeft, Clock, Database, Heart, List, MessageSquare, Search, ShoppingBag, Star, Store, TrendingUp } from "lucide-react";
import { fetchListingsBatch, fetchShopListingsPage, fetchShopPublic, parseEtsyShopInput, searchShops, EtsyApiError } from "@/lib/etsy";
import { summarizeResearch, type ResearchListing } from "@/lib/keyword-research";
import { researchContext, guardedSearch } from "@/lib/research-context";
import { exploreShops, recordProducts, recordShops, savedDetails, savedRefs, storedShop, withShopSales, type ShopRow } from "@/lib/research-store";
import { SORTS, ageLabel, compact, parseAgeDays, parsePage, parseSort, parseTab, researchHref } from "@/lib/research";
import {
  AgeFilter,
  EmptyState,
  ErrorNote,
  EtsyLink,
  Pager,
  ProductRows,
  Rating,
  ResearchBar,
  SearchField,
  SearchHero,
  ShopIcon,
  ShopRows,
  SortMenu,
  StatTiles,
  Toolbar,
  UpgradeModal,
  btn,
} from "@/components/research/research-ui";
import { SaveButton } from "@/components/research/save-button";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { tab?: string; q?: string; id?: string; sort?: string; page?: string; age?: string };

const PLACEHOLDER = "Search for an Etsy shop by name or link";
const SHOP_TOP_LISTINGS = 12;

/** Shop names are letters and digits only; accept a shop link too. */
function shopQuery(raw: string): string | null {
  const parsed = parseEtsyShopInput(raw);
  if (parsed) return parsed;
  const s = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  return s.length >= 2 ? s : null;
}

/**
 * Shop Research: Search (Etsy's shop search, then a shop page), Explore
 * (every shop Mavya has looked up), Saved (checked daily for real sales a
 * day). Sales are Etsy's own lifetime count; sales a day is the change
 * between two daily checks, never an estimate.
 */
export default async function ShopResearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await researchContext();
  const tab = parseTab(sp.tab);

  if (tab === "explore") {
    const sort = parseSort("shop", sp.sort);
    const age = parseAgeDays(sp.age);
    const page = parsePage(sp.page);
    const locked = !ctx.paid && page > 1;
    const [data, saved] = await Promise.all([exploreShops(sort, locked ? 1 : page, age, ctx.today), savedRefs(ctx.userId, "shop")]);
    const params = { tab: "explore", sort: sort.key === SORTS.shop[0].key ? null : sort.key, age };
    return (
      <>
        <ResearchBar kind="shop" tab="explore" />
        <Toolbar
          left={<AgeFilter kind="shop" age={age} params={params} noun="Shop" />}
          right={
            <>
              <Link href={researchHref("shop", {})} aria-label="Search shops" className={`${btn} w-9 px-0`}>
                <Search className="h-4 w-4" aria-hidden="true" />
              </Link>
              <SortMenu kind="shop" sorts={SORTS.shop} sort={sort} params={params} />
            </>
          }
        />
        {data.failed ? (
          <ErrorNote>Explore is not ready yet. Try again shortly.</ErrorNote>
        ) : data.rows.length === 0 ? (
          <EmptyState Icon={Database} title="Nothing to explore yet" body="Explore fills up as shops are researched. Search a shop to add it." action={<Link href={researchHref("shop", {})} className={btn}>Search shops</Link>} />
        ) : (
          <>
            <ShopRows rows={data.rows} saved={new Set(saved.map((s) => s.ref))} />
            <Pager kind="shop" page={locked ? 1 : page} total={data.total} params={params} locked={!ctx.paid} />
          </>
        )}
        {locked && <UpgradeModal reason="explore" closeHref={researchHref("shop", params)} />}
      </>
    );
  }

  if (tab === "saved") {
    const saved = await savedDetails(ctx.userId, ctx.today);
    return (
      <>
        <ResearchBar kind="shop" tab="saved" />
        {saved.shops.length === 0 ? (
          <EmptyState Icon={Heart} title="No saved shops yet" body="Save up to 20 shops. Mavya checks them every day, so you see their real sales a day." action={<Link href={researchHref("shop", { tab: "explore" })} className={btn}>Explore shops</Link>} />
        ) : (
          <>
            {!ctx.paid && <p className="px-4 pt-5 text-[13.5px] text-[var(--color-ink-muted)] sm:px-8">Daily checks for sales a day run on paid plans.</p>}
            <ShopRows rows={saved.shops} saved={new Set(saved.shops.map((s) => String(s.shopId)))} />
          </>
        )}
      </>
    );
  }

  const shopId = /^[1-9]\d{0,18}$/.test(sp.id ?? "") ? Number(sp.id) : null;
  if (shopId) return <ShopDetail ctx={ctx} shopId={shopId} />;

  const raw = (sp.q ?? "").trim().slice(0, 200);
  const q = raw ? shopQuery(raw) : null;
  if (!q) {
    return (
      <>
        <ResearchBar kind="shop" tab="search" />
        <SearchHero
          kind="shop"
          placeholder={PLACEHOLDER}
          chips={[
            { label: "Top sellers overall", href: researchHref("shop", { tab: "explore" }), Icon: ShoppingBag },
            { label: "Most reviewed", href: researchHref("shop", { tab: "explore", sort: "reviews" }), Icon: Star },
            { label: "Most favorited", href: researchHref("shop", { tab: "explore", sort: "favorites" }), Icon: Heart },
            { label: "Newer shops", href: researchHref("shop", { tab: "explore", sort: "newest" }), Icon: Clock },
            { label: "Biggest catalogs", href: researchHref("shop", { tab: "explore", sort: "listings" }), Icon: List },
          ]}
          error={raw && !q ? "Enter a shop name or an Etsy shop link." : null}
          note="Sales, reviews, and favorites are the numbers Etsy shows on each shop page. Save a shop and Mavya checks it every day, so you see its real sales a day."
        />
      </>
    );
  }

  const result = await guardedSearch(ctx, "shop", `name:${q.toLowerCase()}`, async () => {
    const found = await searchShops(q, 25);
    await recordShops(found.results, ctx.today, false);
    const exact = found.results.filter((s) => s.shopName.toLowerCase() === q.toLowerCase());
    const rest = found.results.filter((s) => s.shopName.toLowerCase() !== q.toLowerCase());
    return { count: found.count, rows: await withShopSales([...exact, ...rest], ctx.today) };
  });
  if (!result.data) {
    return (
      <>
        <ResearchBar kind="shop" tab="search" />
        <SearchHero kind="shop" placeholder={PLACEHOLDER} chips={[]} error={result.error} />
        {result.blocked && <UpgradeModal reason="searches" closeHref={researchHref("shop", {})} />}
      </>
    );
  }
  const saved = await savedRefs(ctx.userId, "shop");
  return (
    <>
      <ResearchBar kind="shop" tab="search" />
      <div className="border-b border-[var(--color-border)] bg-white px-4 py-4 sm:px-8">
        <SearchField kind="shop" q={raw} placeholder={PLACEHOLDER} />
      </div>
      <Toolbar
        left={
          <p className="text-[15px] font-semibold text-[var(--color-ink)]">
            {result.data.count.toLocaleString("en-US")} {result.data.count === 1 ? "shop" : "shops"} match &ldquo;{q}&rdquo;
            {result.data.count > result.data.rows.length && <span className="font-normal text-[var(--color-ink-muted)]"> · showing the first {result.data.rows.length}</span>}
          </p>
        }
      />
      {result.data.rows.length === 0 ? (
        <EmptyState Icon={Store} title="No shops found" body="Check the spelling, or paste the shop's Etsy link." />
      ) : (
        <ShopRows rows={result.data.rows} saved={new Set(saved.map((s) => s.ref))} />
      )}
    </>
  );
}

type ShopPage = { shop: ShopRow; listings: ResearchListing[]; live: boolean };

/** One shop page: shop numbers (snapshot for sales a day), then its most viewed newest listings. About 3 Etsy calls. */
async function loadShopPage(shopId: number, today: string): Promise<ShopPage | null> {
  const deadline = Date.now() + 40_000;
  let shop;
  try {
    shop = await fetchShopPublic(shopId, deadline);
  } catch (err) {
    if (err instanceof EtsyApiError && err.code === "not_found") return null;
    throw err;
  }
  if (!shop) return null;
  await recordShops([shop], today, true);
  const recent = await fetchShopListingsPage(shopId, 100, deadline);
  const top = recent.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, SHOP_TOP_LISTINGS);
  const details = await fetchListingsBatch(top.map((l) => l.listingId), deadline);
  const listings = summarizeResearch(shop.shopName, top.length, top, details, today).top;
  await recordProducts(listings, today);
  const [row] = await withShopSales([shop], today);
  return { shop: row, listings, live: true };
}

async function ShopDetail({ ctx, shopId }: { ctx: Awaited<ReturnType<typeof researchContext>>; shopId: number }) {
  const result = await guardedSearch(ctx, "shop", `id:${shopId}`, () => loadShopPage(shopId, ctx.today));

  let data = result.data;
  if (!data && !result.blocked) {
    const stored = await storedShop(shopId);
    if (stored) data = { shop: (await withShopSales([stored], ctx.today))[0], listings: [], live: false };
  }
  const back = (
    <Link href={researchHref("shop", {})} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Shop search
    </Link>
  );
  if (!data) {
    return (
      <>
        <ResearchBar kind="shop" tab="search" />
        <div className="px-4 pt-5 sm:px-8">{back}</div>
        {result.blocked ? (
          <UpgradeModal reason="searches" closeHref={researchHref("shop", {})} />
        ) : (
          <ErrorNote>{result.error ?? "This shop is not open on Etsy."}</ErrorNote>
        )}
      </>
    );
  }

  const s = data.shop;
  const saved = await savedRefs(ctx.userId);
  const isSaved = saved.some((x) => x.kind === "shop" && x.ref === String(s.shopId));
  return (
    <>
      <ResearchBar kind="shop" tab="search" />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
        {back}
        <section className="flex flex-wrap items-center gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white p-5">
          <ShopIcon src={s.iconUrl} name={s.shopName} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">{s.shopName}</h1>
            {s.title && <p className="text-[14px] text-[var(--color-ink-muted)]">{s.title}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-[var(--color-ink-muted)]">
              <span>Opened {ageLabel(s.ageDays)} ago</span>
              <span aria-hidden="true">·</span>
              <Rating avg={s.reviewAverage} count={s.reviewCount} />
              {s.country && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{s.country}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SaveButton kind="shop" refId={String(s.shopId)} label={s.shopName} initial={isSaved} withText />
            <EtsyLink href={`https://www.etsy.com/shop/${s.shopName}`}>Open on Etsy</EtsyLink>
          </div>
        </section>
        {!data.live && <p className="text-[13.5px] text-[var(--color-mid)]">{result.error ?? "Etsy is busy."} Showing the numbers Mavya saw last.</p>}

        <StatTiles
          items={[
            { Icon: ShoppingBag, label: "Total sales", value: compact(s.soldCount), sub: "Lifetime, as Etsy shows it" },
            {
              Icon: TrendingUp,
              label: "Sales a day",
              value: s.sales ? compact(s.sales.perDay) : "–",
              sub: s.sales ? `Counted over the last ${s.sales.overDays} ${s.sales.overDays === 1 ? "day" : "days"}` : isSaved ? "Shows after the second daily check" : "Save the shop to track it daily",
            },
            { Icon: MessageSquare, label: "Reviews", value: compact(s.reviewCount), sub: s.reviewAverage === null ? undefined : `${s.reviewAverage.toFixed(2)} average` },
            { Icon: Store, label: "Active listings", value: compact(s.activeListings), sub: `${compact(s.favorers)} shop favorites` },
          ]}
        />

        {data.listings.length > 0 && (
          <section aria-labelledby="shop-top-h" className="-mx-4 sm:-mx-8">
            <div className="px-4 sm:px-8">
              <h2 id="shop-top-h" className="text-[16px] font-semibold text-[var(--color-ink)]">Most viewed listings</h2>
              <p className="text-[13px] text-[var(--color-ink-muted)]">From the shop&apos;s 100 newest listings.</p>
            </div>
            <ProductRows rows={data.listings} saved={new Set(saved.filter((x) => x.kind === "product").map((x) => x.ref))} />
          </section>
        )}
      </div>
    </>
  );
}
