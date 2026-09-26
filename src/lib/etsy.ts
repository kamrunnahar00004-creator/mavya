/**
 * Minimal read-only Etsy Open API v3 client for the Listing Coach
 * (docs/NORTH_STAR_LISTING_COACH.md). SERVER ONLY.
 *
 * Public data only, API key auth only: no OAuth, no seller login, no writes.
 * Etsy requires the header `x-api-key: <keystring>:<shared_secret>`.
 *
 * Rate limit for the current Personal Access app: 5 requests/second and
 * 5,000/day. Calls are spaced at least MIN_INTERVAL_MS apart within one
 * server instance; the daily cron is the only bulk caller.
 */

import { weightedRateLimit, rollingRateLimitMany } from "@/lib/rate-limit";
import { AsyncLocalStorage } from "node:async_hooks";
import { FREE_ETSY_CALLS_PER_DAY } from "@/lib/plans";

const requestTier = new AsyncLocalStorage<"free" | "paid">();
export function withEtsyRequestTier<T>(tier: "free" | "paid", work: () => Promise<T>): Promise<T> {
  return requestTier.run(tier, work);
}

const ETSY_BASE = "https://openapi.etsy.com/v3/application";
const MIN_INTERVAL_MS = 250;
const MAX_BATCH = 100;

export class EtsyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "not_configured" | "not_found" | "rate_limited" | "bad_response" | "upstream"
  ) {
    super(message);
  }
}

export type EtsyImage = {
  id: number;
  rank: number;
  url570: string | null;
  url170: string | null;
  /** Full-size original; used only to import a seller's own photo. */
  urlFull: string | null;
};

export type EtsyListing = {
  listingId: number;
  shopId: number | null;
  state: string | null;
  title: string;
  description: string;
  tags: string[];
  /** Lifetime view count, tabulated once a day by Etsy. 0 may mean "not tabulated". */
  views: number | null;
  favorites: number | null;
  priceCents: number | null;
  currency: string | null;
  url: string | null;
  /** Unix seconds; used to estimate a listing's age. */
  createdAt: number | null;
  /** Sorted by rank; rank 1 is the main (thumbnail) photo. Empty when not requested. */
  images: EtsyImage[];
};

function apiKeyHeader(): string {
  const keystring = process.env.ETSY_API_KEYSTRING?.trim();
  const secret = process.env.ETSY_SHARED_SECRET?.trim();
  if (!keystring || !secret) {
    throw new EtsyApiError("Etsy API key not configured", 500, "not_configured");
  }
  return `${keystring}:${secret}`;
}

export function isEtsyConfigured(): boolean {
  return Boolean(process.env.ETSY_API_KEYSTRING?.trim() && process.env.ETSY_SHARED_SECRET?.trim());
}

let lastCallAt = 0;
async function throttle() {
  const reserved = Math.max(lastCallAt + MIN_INTERVAL_MS, Date.now());
  lastCallAt = reserved;
  const wait = reserved - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * The per-second budget is shared across instances (cron + manual checks).
 * A busy second is normal contention, not an outage: wait for the next
 * second instead of failing the keyword. Checked BEFORE the daily budget so
 * a waited-out attempt never consumes daily quota.
 */
async function acquireSecondSlot(deadlineAt: number): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await weightedRateLimit("etsy:requests:second", 1, 4, 1000)).ok) return;
    if (Date.now() + 300 >= deadlineAt) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new EtsyApiError("Etsy request budget reached", 429, "rate_limited");
}

async function etsyGet(path: string, params: Record<string, string | number> = {}, deadlineAt = Date.now() + 30_000): Promise<unknown> {
  const url = new URL(`${ETSY_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const header = apiKeyHeader();

  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    if (Date.now() >= deadlineAt) throw new EtsyApiError("Etsy check timed out", 504, "upstream");
    await acquireSecondSlot(deadlineAt);
    const budgets = [{ key: "requests:day", max: 4500 }];
    if (requestTier.getStore() === "free") budgets.push({ key: "free:day", max: FREE_ETSY_CALLS_PER_DAY });
    if (!(await rollingRateLimitMany(budgets, 86_400_000)).ok) {
      throw new EtsyApiError("Etsy request budget reached", 429, "rate_limited");
    }
    const res = await fetch(url, {
      headers: { "x-api-key": header, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadlineAt - Date.now()))),
      redirect: "error",
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (res.status === 404) throw new EtsyApiError("Etsy resource not found", 404, "not_found");
    if (res.status === 429) throw new EtsyApiError("Etsy rate limit reached", 429, "rate_limited");
    if (!res.ok) throw new EtsyApiError(`Etsy API error ${res.status}`, res.status, "upstream");
    try {
      return await res.json();
    } catch {
      throw new EtsyApiError("Etsy returned invalid JSON", res.status, "bad_response");
    }
  }
  throw new EtsyApiError("Etsy rate limit reached", 429, "rate_limited");
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Etsy's API returns titles, tags, and descriptions HTML-encoded ("She&#39;s",
 * "&quot;", "&amp;"). Decode once here, where all listing text enters Mavya,
 * so pages, the writer, and keyword matching all see the real text.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Normalize one raw Etsy listing object. Exported for tests. */
export function normalizeListing(raw: unknown): EtsyListing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const listingId = num(r.listing_id);
  if (!listingId) return null;
  const price = r.price as { amount?: unknown; divisor?: unknown; currency_code?: unknown } | undefined;
  const amount = num(price?.amount);
  const divisor = num(price?.divisor);
  const images = Array.isArray(r.images)
    ? (r.images as unknown[])
        .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
        .map((i) => ({
          id: num(i.listing_image_id) ?? 0,
          rank: num(i.rank) ?? 99,
          url570: str(i.url_570xN),
          url170: str(i.url_170x135),
          urlFull: str(i.url_fullxfull),
        }))
        .filter((i) => i.id > 0)
        .sort((a, b) => a.rank - b.rank)
    : [];
  return {
    listingId,
    shopId: num(r.shop_id),
    state: str(r.state),
    title: decodeEntities(str(r.title) ?? ""),
    description: decodeEntities(str(r.description) ?? ""),
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string").map(decodeEntities) : [],
    views: num(r.views),
    favorites: num(r.num_favorers),
    priceCents:
      amount !== null && divisor ? Math.round((amount / divisor) * 100) : null,
    currency: str(price?.currency_code),
    url: str(r.url),
    createdAt: num(r.original_creation_timestamp) ?? num(r.created_timestamp),
    images,
  };
}

/** Fetch up to any number of listings (chunked by 100) with images. */
export async function fetchListingsBatch(ids: number[], deadlineAt = Date.now() + 60_000): Promise<Map<number, EtsyListing>> {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const out = new Map<number, EtsyListing>();
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const chunk = unique.slice(i, i + MAX_BATCH);
    let body: unknown;
    try {
      body = await etsyGet("/listings/batch", {
        listing_ids: chunk.join(","),
        includes: "Images",
      }, deadlineAt);
    } catch (err) {
      // One unknown id 404s the whole chunk. Fall back to one-by-one so a
      // single deleted listing never blinds the rest of the batch.
      if (err instanceof EtsyApiError && err.code === "not_found" && chunk.length > 1) {
        for (const id of chunk) {
          try {
            const single = await etsyGet("/listings/batch", { listing_ids: String(id), includes: "Images" }, deadlineAt);
            for (const l of resultsOf(single)) out.set(l.listingId, l);
          } catch (inner) {
            if (!(inner instanceof EtsyApiError && inner.code === "not_found")) throw inner;
          }
        }
        continue;
      }
      if (err instanceof EtsyApiError && err.code === "not_found" && chunk.length === 1) continue;
      throw err;
    }
    for (const l of resultsOf(body)) out.set(l.listingId, l);
  }
  return out;
}

function resultsOf(body: unknown): EtsyListing[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new EtsyApiError("Unexpected Etsy response", 200, "bad_response");
  return results.map(normalizeListing).filter((l): l is EtsyListing => l !== null);
}

/**
 * Etsy search for one keyword, ranked by relevance (`sort_on=score`). Close to,
 * not identical to, what a buyer sees on etsy.com (personalization and ads).
 * Returns listings in rank order without images.
 */
export async function searchActiveListings(keyword: string, limit = 100, deadlineAt = Date.now() + 30_000): Promise<EtsyListing[]> {
  return (await searchActiveListingsWithCount(keyword, limit, deadlineAt)).results;
}

/** Same search, plus Etsy's total match count (competition signal). */
export async function searchActiveListingsWithCount(
  keyword: string,
  limit = 100,
  deadlineAt = Date.now() + 30_000
): Promise<{ count: number; results: EtsyListing[] }> {
  const body = await etsyGet("/listings/active", {
    keywords: keyword,
    sort_on: "score",
    limit: Math.min(Math.max(limit, 1), 100),
  }, deadlineAt);
  const count = num((body as { count?: unknown })?.count) ?? 0;
  return { count, results: resultsOf(body) };
}

export type EtsyShop = { shopId: number; shopName: string; activeListings: number | null };

/**
 * Parse a pasted shop reference: a shop name, "etsy.com/shop/Name", or a full
 * shop URL. Returns the shop name, or null.
 */
export function parseEtsyShopInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9]{3,40}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "etsy.com" && !host.endsWith(".etsy.com")) return null;
  const match = url.pathname.match(/\/shop\/([A-Za-z0-9]{3,40})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

/** Exact (case-insensitive) shop-name lookup via the public findShops endpoint. */
export async function fetchShopByName(name: string, deadlineAt = Date.now() + 20_000): Promise<EtsyShop | null> {
  const body = await etsyGet("/shops", { shop_name: name, limit: 25 }, deadlineAt);
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new EtsyApiError("Unexpected Etsy response", 200, "bad_response");
  for (const r of results as Record<string, unknown>[]) {
    const shopName = str(r.shop_name);
    const shopId = num(r.shop_id);
    if (shopName && shopId && shopName.toLowerCase() === name.toLowerCase()) {
      return { shopId, shopName, activeListings: num(r.listing_active_count) };
    }
  }
  return null;
}

/** Public shop numbers Etsy shows on any shop page (research, 2026-09-26). */
export type EtsyShopPublic = {
  shopId: number;
  shopName: string;
  title: string | null;
  iconUrl: string | null;
  country: string | null;
  /** Lifetime sales, as Etsy counts them on the shop page. */
  soldCount: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  favorers: number | null;
  activeListings: number | null;
  /** Unix seconds the shop opened. */
  createdAt: number | null;
  url: string | null;
};

/** Normalize one raw Etsy shop object. Exported for tests. */
export function normalizeShop(raw: unknown): EtsyShopPublic | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const shopId = num(r.shop_id);
  const shopName = str(r.shop_name);
  if (!shopId || !shopName) return null;
  const icon = str(r.icon_url_fullxfull);
  return {
    shopId,
    shopName,
    title: str(r.title) ? decodeEntities(str(r.title) as string) : null,
    iconUrl: icon && icon.startsWith("https://i.etsystatic.com/") ? icon : null,
    country: str(r.shop_location_country_iso),
    soldCount: num(r.transaction_sold_count),
    reviewCount: num(r.review_count),
    reviewAverage: num(r.review_average),
    favorers: num(r.num_favorers),
    activeListings: num(r.listing_active_count),
    createdAt: num(r.create_date) ?? num(r.created_timestamp),
    url: str(r.url),
  };
}

/** Fuzzy shop-name search (Etsy findShops): up to 25 shops plus Etsy's total match count. One call. */
export async function searchShops(name: string, limit = 25, deadlineAt = Date.now() + 20_000): Promise<{ count: number; results: EtsyShopPublic[] }> {
  const body = await etsyGet("/shops", { shop_name: name, limit: Math.min(Math.max(limit, 1), 100) }, deadlineAt);
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new EtsyApiError("Unexpected Etsy response", 200, "bad_response");
  return {
    count: num((body as { count?: unknown })?.count) ?? results.length,
    results: results.map(normalizeShop).filter((s): s is EtsyShopPublic => s !== null),
  };
}

/** One shop's public numbers by id. One call. */
export async function fetchShopPublic(shopId: number, deadlineAt = Date.now() + 20_000): Promise<EtsyShopPublic | null> {
  const shop = normalizeShop(await etsyGet(`/shops/${shopId}`, {}, deadlineAt));
  if (!shop) throw new EtsyApiError("Unexpected Etsy response", 200, "bad_response");
  return shop;
}

/**
 * A shop's newest active listings (one page, up to 100) with views and
 * favorites, without images. One call. Research uses it to show a shop's
 * most viewed recent listings without reading the whole shop.
 */
export async function fetchShopListingsPage(shopId: number, limit = 100, deadlineAt = Date.now() + 20_000): Promise<EtsyListing[]> {
  return resultsOf(await etsyGet(`/shops/${shopId}/listings/active`, { limit: Math.min(Math.max(limit, 1), 100) }, deadlineAt));
}

/**
 * All active listings of a shop (public), up to `max`, most viewed first when
 * the shop is larger than `max`. One call per 100 listings, then one batch
 * call per 100 selected listings for images. Selection requires reading all
 * shop pages first, so cost depends on total shop size, not just the plan cap.
 */
export async function fetchShopActiveListings(
  shopId: number,
  max: number,
  deadlineAt = Date.now() + 60_000,
  /** Stop after this many pages (free checks read at most 500 listings). */
  maxPages = 50
): Promise<EtsyListing[]> {
  const all: EtsyListing[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    if (offset / 100 >= maxPages) break;
    const body = await etsyGet(`/shops/${shopId}/listings/active`, { limit: 100, offset }, deadlineAt);
    const page = resultsOf(body);
    all.push(...page);
    if (page.length < 100) break;
    const count = num((body as { count?: unknown })?.count);
    if (count !== null && all.length >= count) break;
    if (offset === 4900) throw new EtsyApiError("Shop enumeration limit reached", 422, "bad_response");
  }
  const chosen = all.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, Math.max(0, max));
  const withImages = await fetchListingsBatch(chosen.map((l) => l.listingId), deadlineAt);
  if (chosen.some((l) => !withImages.has(l.listingId))) throw new EtsyApiError("Incomplete shop details", 502, "bad_response");
  return chosen.map((l) => withImages.get(l.listingId)!);
}

/** Download an Etsy CDN image (winner photo scoring). Only i.etsystatic.com is allowed. */
export async function fetchEtsyImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "i.etsystatic.com" || parsed.port || parsed.username || parsed.password) {
    throw new EtsyApiError("Refusing non-Etsy image host", 400, "bad_response");
  }
  // No redirects: the host allowlist above must hold for the final URL too.
  const res = await fetch(parsed, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new EtsyApiError(`Etsy image fetch ${res.status}`, res.status, "upstream");
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  if (!mime.startsWith("image/")) throw new EtsyApiError("Not an image", 400, "bad_response");
  const reader = res.body?.getReader();
  if (!reader) throw new EtsyApiError("Empty image", 400, "bad_response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new EtsyApiError("Image too large", 400, "bad_response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks);
  return { buffer, mime };
}

/**
 * Parse a pasted Etsy listing link (or bare id) into a listing id.
 * Accepts etsy.com/listing/<id>/..., regional paths (etsy.com/uk/listing/<id>),
 * and bare numeric ids. Short links (etsy.me) cannot be resolved offline.
 */
export function parseEtsyListingInput(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d{6,15}$/.test(trimmed)) return Number(trimmed);
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "etsy.com" && !host.endsWith(".etsy.com")) return null;
  const match = url.pathname.match(/\/listing\/(\d{6,15})(?:\/|$)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}
