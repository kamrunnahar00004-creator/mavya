import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { acquireLease, rateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/errors";
import { fetchListingsBatch, type EtsyShopPublic } from "@/lib/etsy";
import { getSearchCached } from "@/lib/search-cache";
import { summarizeResearch, RESEARCH_TOP, type KeywordResearch, type ResearchListing } from "@/lib/keyword-research";
import {
  FREE_RESEARCH_SEARCHES,
  FREE_RESEARCH_WINDOW_MS,
  PAID_RESEARCH_SEARCHES_PER_DAY,
  RESEARCH_PAGE_SIZE,
  ageInDays,
  salesPerDay,
  unixToDate,
  type ResearchKind,
  type ShopDay,
  type SortDef,
} from "@/lib/research";

/**
 * Research data access (2026-09-26). SERVER ONLY. Pages have already checked
 * the signed-in user; every write here is public Etsy data (no user ids)
 * except research_saved, which is always keyed by the caller's own id.
 *
 * Every shared-table write is best effort: a failed write never breaks the
 * search the seller just ran (logged, not thrown).
 */

export type KeywordRow = {
  keyword: string;
  competition: number;
  topViewsPerDay: number | null;
  newShare: number | null;
  medianPriceCents: number | null;
  currency: string | null;
  checkedOn: string;
};

export type ShopRow = EtsyShopPublic & { ageDays: number | null; sales: { perDay: number; overDays: number } | null };

export type SearchCharge = "ok" | "free_limit" | "daily_limit" | "unavailable";

/**
 * Count one research search against the account. The same search again the
 * same day is free (reloads, back button, sharing a link with yourself).
 * Free accounts: FREE_RESEARCH_SEARCHES per 7 days. Paid: a daily cap.
 */
export async function chargeResearchSearch(userId: string, paid: boolean, kind: ResearchKind, q: string, today: string): Promise<SearchCharge> {
  const release = await acquireLease(`research-seen:${userId}:${kind}:${today}:${q.toLowerCase()}`, 86_400_000);
  if (!release) return "ok";
  const r = paid
    ? await rateLimit(`research:u:${userId}`, PAID_RESEARCH_SEARCHES_PER_DAY, 86_400_000)
    : await rateLimit(`research-free:u:${userId}`, FREE_RESEARCH_SEARCHES, FREE_RESEARCH_WINDOW_MS);
  if (r.ok) return "ok";
  await release();
  if (r.reason !== "limited") return "unavailable";
  return paid ? "daily_limit" : "free_limit";
}

/** One keyword search: shared daily search cache, then one details call for the top 25. */
export async function runKeywordResearch(q: string, today: string): Promise<KeywordResearch> {
  const deadline = Date.now() + 40_000;
  const search = await getSearchCached(createSupabaseAdminClient(), q, today, deadline);
  const details = await fetchListingsBatch(search.results.slice(0, RESEARCH_TOP).map((l) => l.listingId), deadline);
  const research = summarizeResearch(q, search.count, search.results, details, today);
  await recordKeyword(research, today);
  return research;
}

async function recordKeyword(r: KeywordResearch, today: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("research_keywords").upsert({
    keyword: r.keyword.toLowerCase(),
    competition: r.competition,
    top_views_per_day: r.topViewsPerDay,
    new_share: r.newShare,
    median_price_cents: r.medianPriceCents,
    currency: r.currency,
    checked_on: today,
    updated_at: new Date().toISOString(),
  });
  if (error) logEvent("research.keyword_write_failed", { code: error.code ?? "" });
  await recordProducts(r.top, today);
}

export async function recordProducts(rows: ResearchListing[], today: string) {
  if (!rows.length) return;
  const { error } = await createSupabaseAdminClient().from("research_products").upsert(
    rows.map((t) => ({
      listing_id: t.listingId,
      shop_id: t.shopId,
      title: t.title.slice(0, 300),
      url: t.url,
      image_url: t.image,
      price_cents: t.priceCents,
      currency: t.currency,
      views: t.views,
      favorites: t.favorites,
      created_on: unixToDate(t.createdAt),
      views_per_day: t.viewsPerDay === null ? null : Math.round(t.viewsPerDay * 100) / 100,
      seen_on: today,
      updated_at: new Date().toISOString(),
    }))
  );
  if (error) logEvent("research.product_write_failed", { code: error.code ?? "" });
}

/** Store shops seen in a search; with `snapshot`, also today's sales count (for sales per day). */
export async function recordShops(shops: EtsyShopPublic[], today: string, snapshot: boolean) {
  if (!shops.length) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("research_shops").upsert(
    shops.map((s) => ({
      shop_id: s.shopId,
      shop_name: s.shopName,
      title: s.title?.slice(0, 300) ?? null,
      icon_url: s.iconUrl,
      country: s.country,
      sold_count: s.soldCount,
      review_count: s.reviewCount,
      review_average: s.reviewAverage,
      favorers: s.favorers,
      active_listings: s.activeListings,
      created_on: unixToDate(s.createdAt),
      seen_on: today,
      updated_at: new Date().toISOString(),
    }))
  );
  if (error) logEvent("research.shop_write_failed", { code: error.code ?? "" });
  if (!snapshot) return;
  const { error: dayError } = await admin.from("research_shop_days").upsert(
    shops.map((s) => ({ shop_id: s.shopId, checked_on: today, sold_count: s.soldCount, review_count: s.reviewCount, favorers: s.favorers }))
  );
  if (dayError) logEvent("research.shop_day_write_failed", { code: dayError.code ?? "" });
}

type KeywordDb = { keyword: string; competition: number; top_views_per_day: number | null; new_share: number | null; median_price_cents: number | null; currency: string | null; checked_on: string };
type ProductDb = { listing_id: number; shop_id: number | null; title: string; url: string | null; image_url: string | null; price_cents: number | null; currency: string | null; views: number | null; favorites: number | null; created_on: string | null; views_per_day: number | null };
type ShopDb = { shop_id: number; shop_name: string; title: string | null; icon_url: string | null; country: string | null; sold_count: number | null; review_count: number | null; review_average: number | null; favorers: number | null; active_listings: number | null; created_on: string | null };

const keywordRow = (k: KeywordDb): KeywordRow => ({
  keyword: k.keyword,
  competition: k.competition,
  topViewsPerDay: k.top_views_per_day === null ? null : Number(k.top_views_per_day),
  newShare: k.new_share === null ? null : Number(k.new_share),
  medianPriceCents: k.median_price_cents,
  currency: k.currency,
  checkedOn: k.checked_on,
});

const productRow = (p: ProductDb, i: number, today: string): ResearchListing => ({
  rank: i + 1,
  listingId: Number(p.listing_id),
  shopId: p.shop_id === null ? null : Number(p.shop_id),
  createdAt: p.created_on ? Date.parse(`${p.created_on}T00:00:00Z`) / 1000 : null,
  title: p.title,
  url: p.url,
  image: p.image_url,
  views: p.views,
  favorites: p.favorites,
  viewsPerDay: p.views_per_day === null ? null : Number(p.views_per_day),
  priceCents: p.price_cents,
  currency: p.currency,
  ageDays: ageInDays(p.created_on, today),
});

export function shopRow(s: EtsyShopPublic, today: string, days: ShopDay[] = []): ShopRow {
  return { ...s, ageDays: ageInDays(s.createdAt, today), sales: salesPerDay(days, today) };
}

const shopFromDb = (s: ShopDb): EtsyShopPublic => ({
  shopId: Number(s.shop_id),
  shopName: s.shop_name,
  title: s.title,
  iconUrl: s.icon_url,
  country: s.country,
  soldCount: s.sold_count,
  reviewCount: s.review_count,
  reviewAverage: s.review_average === null ? null : Number(s.review_average),
  favorers: s.favorers,
  activeListings: s.active_listings,
  createdAt: s.created_on ? Date.parse(`${s.created_on}T00:00:00Z`) / 1000 : null,
  url: `https://www.etsy.com/shop/${s.shop_name}`,
});

async function shopDays(shopIds: number[]): Promise<Map<number, ShopDay[]>> {
  const out = new Map<number, ShopDay[]>();
  if (!shopIds.length) return out;
  const { data } = await createSupabaseAdminClient()
    .from("research_shop_days")
    .select("shop_id, checked_on, sold_count")
    .in("shop_id", shopIds)
    .order("checked_on", { ascending: false })
    .limit(shopIds.length * 31);
  for (const d of (data as { shop_id: number; checked_on: string; sold_count: number | null }[] | null) ?? []) {
    const id = Number(d.shop_id);
    out.set(id, [...(out.get(id) ?? []), { checked_on: d.checked_on, sold_count: d.sold_count }]);
  }
  return out;
}

export async function withShopSales(shops: EtsyShopPublic[], today: string): Promise<ShopRow[]> {
  const days = await shopDays(shops.map((s) => s.shopId));
  return shops.map((s) => shopRow(s, today, days.get(s.shopId)));
}

export type ExplorePage<T> = { rows: T[]; total: number; failed: boolean };

/** Explore tables: everything Mavya searches collect, newest data first within the chosen sort. */
export async function exploreKeywords(sort: SortDef, page: number): Promise<ExplorePage<KeywordRow>> {
  const from = (page - 1) * RESEARCH_PAGE_SIZE;
  const { data, count, error } = await createSupabaseAdminClient()
    .from("research_keywords")
    .select("keyword, competition, top_views_per_day, new_share, median_price_cents, currency, checked_on", { count: "exact" })
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order("keyword", { ascending: true })
    .range(from, from + RESEARCH_PAGE_SIZE - 1);
  if (error) return { rows: [], total: 0, failed: true };
  return { rows: ((data as KeywordDb[] | null) ?? []).map(keywordRow), total: count ?? 0, failed: false };
}

export async function exploreProducts(sort: SortDef, page: number, maxAgeDays: number | null, today: string): Promise<ExplorePage<ResearchListing>> {
  const from = (page - 1) * RESEARCH_PAGE_SIZE;
  let query = createSupabaseAdminClient()
    .from("research_products")
    .select("listing_id, shop_id, title, url, image_url, price_cents, currency, views, favorites, created_on, views_per_day", { count: "exact" });
  if (maxAgeDays !== null) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
    query = query.gte("created_on", since);
  }
  const { data, count, error } = await query
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order("listing_id", { ascending: true })
    .range(from, from + RESEARCH_PAGE_SIZE - 1);
  if (error) return { rows: [], total: 0, failed: true };
  return { rows: ((data as ProductDb[] | null) ?? []).map((p, i) => productRow(p, from + i, today)), total: count ?? 0, failed: false };
}

export async function exploreShops(sort: SortDef, page: number, maxAgeDays: number | null, today: string): Promise<ExplorePage<ShopRow>> {
  const from = (page - 1) * RESEARCH_PAGE_SIZE;
  let query = createSupabaseAdminClient()
    .from("research_shops")
    .select("shop_id, shop_name, title, icon_url, country, sold_count, review_count, review_average, favorers, active_listings, created_on", { count: "exact" });
  if (maxAgeDays !== null) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
    query = query.gte("created_on", since);
  }
  const { data, count, error } = await query
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .order("shop_id", { ascending: true })
    .range(from, from + RESEARCH_PAGE_SIZE - 1);
  if (error) return { rows: [], total: 0, failed: true };
  const shops = ((data as ShopDb[] | null) ?? []).map(shopFromDb);
  return { rows: await withShopSales(shops, today), total: count ?? 0, failed: false };
}

/** A shop Mavya has stored before (for the detail page when Etsy is busy). */
export async function storedShop(shopId: number): Promise<EtsyShopPublic | null> {
  const { data } = await createSupabaseAdminClient()
    .from("research_shops")
    .select("shop_id, shop_name, title, icon_url, country, sold_count, review_count, review_average, favorers, active_listings, created_on")
    .eq("shop_id", shopId)
    .maybeSingle();
  return data ? shopFromDb(data as ShopDb) : null;
}

export type SavedItem = { kind: ResearchKind; ref: string; label: string; createdAt: string };

export async function savedRefs(userId: string, kind?: ResearchKind): Promise<SavedItem[]> {
  let query = createSupabaseAdminClient().from("research_saved").select("kind, ref, label, created_at").eq("user_id", userId);
  if (kind) query = query.eq("kind", kind);
  const { data } = await query.order("created_at", { ascending: false }).limit(500);
  return ((data as { kind: ResearchKind; ref: string; label: string; created_at: string }[] | null) ?? []).map((d) => ({
    kind: d.kind,
    ref: d.ref,
    label: d.label,
    createdAt: d.created_at,
  }));
}

/** Saved items with their latest stored numbers, per kind. */
export async function savedDetails(userId: string, today: string) {
  const saved = await savedRefs(userId);
  const admin = createSupabaseAdminClient();
  const refs = (k: ResearchKind) => saved.filter((s) => s.kind === k).map((s) => s.ref);
  const [kw, pr, sh] = await Promise.all([
    refs("keyword").length
      ? admin.from("research_keywords").select("keyword, competition, top_views_per_day, new_share, median_price_cents, currency, checked_on").in("keyword", refs("keyword"))
      : Promise.resolve({ data: [] }),
    refs("product").length
      ? admin.from("research_products").select("listing_id, shop_id, title, url, image_url, price_cents, currency, views, favorites, created_on, views_per_day").in("listing_id", refs("product"))
      : Promise.resolve({ data: [] }),
    refs("shop").length
      ? admin.from("research_shops").select("shop_id, shop_name, title, icon_url, country, sold_count, review_count, review_average, favorers, active_listings, created_on").in("shop_id", refs("shop"))
      : Promise.resolve({ data: [] }),
  ]);
  const order = (k: ResearchKind) => new Map(saved.filter((s) => s.kind === k).map((s, i) => [s.ref, i]));
  const kwOrder = order("keyword");
  const prOrder = order("product");
  const shOrder = order("shop");
  const keywords = ((kw.data as KeywordDb[] | null) ?? []).map(keywordRow).sort((a, b) => (kwOrder.get(a.keyword) ?? 0) - (kwOrder.get(b.keyword) ?? 0));
  const products = ((pr.data as ProductDb[] | null) ?? [])
    .sort((a, b) => (prOrder.get(String(a.listing_id)) ?? 0) - (prOrder.get(String(b.listing_id)) ?? 0))
    .map((p, i) => productRow(p, i, today));
  const shops = await withShopSales(
    ((sh.data as ShopDb[] | null) ?? []).map(shopFromDb).sort((a, b) => (shOrder.get(String(a.shopId)) ?? 0) - (shOrder.get(String(b.shopId)) ?? 0)),
    today
  );
  return { keywords, products, shops, counts: { keyword: refs("keyword").length, product: refs("product").length, shop: refs("shop").length } };
}
