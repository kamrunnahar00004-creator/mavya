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
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function etsyGet(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const url = new URL(`${ETSY_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const header = apiKeyHeader();

  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: { "x-api-key": header, accept: "application/json" },
      cache: "no-store",
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
    ? (r.images as Record<string, unknown>[])
        .map((i) => ({
          id: num(i.listing_image_id) ?? 0,
          rank: num(i.rank) ?? 99,
          url570: str(i.url_570xN),
          url170: str(i.url_170x135),
        }))
        .filter((i) => i.id > 0)
        .sort((a, b) => a.rank - b.rank)
    : [];
  return {
    listingId,
    shopId: num(r.shop_id),
    state: str(r.state),
    title: str(r.title) ?? "",
    description: str(r.description) ?? "",
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
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
export async function fetchListingsBatch(ids: number[]): Promise<Map<number, EtsyListing>> {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const out = new Map<number, EtsyListing>();
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const chunk = unique.slice(i, i + MAX_BATCH);
    let body: unknown;
    try {
      body = await etsyGet("/listings/batch", {
        listing_ids: chunk.join(","),
        includes: "Images",
      });
    } catch (err) {
      // One unknown id 404s the whole chunk. Fall back to one-by-one so a
      // single deleted listing never blinds the rest of the batch.
      if (err instanceof EtsyApiError && err.code === "not_found" && chunk.length > 1) {
        for (const id of chunk) {
          try {
            const single = await etsyGet("/listings/batch", { listing_ids: String(id), includes: "Images" });
            for (const l of resultsOf(single)) out.set(l.listingId, l);
          } catch (inner) {
            if (!(inner instanceof EtsyApiError && inner.code === "not_found")) throw inner;
          }
        }
        continue;
      }
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
export async function searchActiveListings(keyword: string, limit = 100): Promise<EtsyListing[]> {
  const body = await etsyGet("/listings/active", {
    keywords: keyword,
    sort_on: "score",
    limit: Math.min(Math.max(limit, 1), 100),
  });
  return resultsOf(body);
}

/** Download an Etsy CDN image (winner photo scoring). Only i.etsystatic.com is allowed. */
export async function fetchEtsyImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "i.etsystatic.com") {
    throw new EtsyApiError("Refusing non-Etsy image host", 400, "bad_response");
  }
  // No redirects: the host allowlist above must hold for the final URL too.
  const res = await fetch(parsed, { cache: "no-store", redirect: "error" });
  if (!res.ok) throw new EtsyApiError(`Etsy image fetch ${res.status}`, res.status, "upstream");
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  if (!mime.startsWith("image/")) throw new EtsyApiError("Not an image", 400, "bad_response");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 8 * 1024 * 1024) throw new EtsyApiError("Image too large", 400, "bad_response");
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
