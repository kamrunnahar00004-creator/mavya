/**
 * Research (Keywords / Products / Shops / Saved), 2026-09-26. PURE helpers,
 * unit-tested; pages do the fetching (src/lib/research-store.ts).
 *
 * Honesty rules (docs/NORTH_STAR_LISTING_COACH.md):
 * - Real public Etsy numbers only. No search volume, no per-listing sales, no
 *   revenue: Etsy does not publish them and Mavya does not estimate them.
 * - Shop sales are Etsy's own lifetime count. Sales per day exist only for
 *   shops Mavya has checked on two or more different days (saved shops are
 *   checked daily), and are the plain difference between those counts.
 */

export type ResearchKind = "keyword" | "product" | "shop";
export type ResearchTab = "search" | "explore" | "saved";

export const RESEARCH_PAGE_SIZE = 25;
export const RESEARCH_MAX_PAGE = 40;
/** Free accounts: research searches per rolling 7 days (then the plans popup). */
export const FREE_RESEARCH_SEARCHES = 3;
export const FREE_RESEARCH_WINDOW_MS = 7 * 86_400_000;
/** Paid accounts: research searches per day (repeats of the same search that day are free). */
export const PAID_RESEARCH_SEARCHES_PER_DAY = 60;
/** Saved shops are checked every day (one Etsy call each), so they are capped. */
export const MAX_SAVED_SHOPS = 20;
export const MAX_SAVED_OTHER = 200;

export const RESEARCH_BASE: Record<ResearchKind, string> = {
  keyword: "/dashboard/research/keywords",
  product: "/dashboard/research/products",
  shop: "/dashboard/research/shops",
};

export function parseTab(raw: string | undefined): ResearchTab {
  return raw === "explore" || raw === "saved" ? raw : "search";
}

export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), RESEARCH_MAX_PAGE) : 1;
}

/** Listing / shop age filter in days (7 to 3650), or null for no filter. */
export function parseAgeDays(raw: string | undefined): number | null {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 7 ? Math.min(n, 3650) : null;
}

export type SortDef = { key: string; label: string; column: string; ascending: boolean };

/** Explore sort options per kind. The first one is the default. */
export const SORTS: Record<ResearchKind, SortDef[]> = {
  keyword: [
    { key: "views", label: "Top views a day", column: "top_views_per_day", ascending: false },
    { key: "competition", label: "Lowest competition", column: "competition", ascending: true },
    { key: "new", label: "Most new listings", column: "new_share", ascending: false },
    { key: "price", label: "Highest price", column: "median_price_cents", ascending: false },
    { key: "recent", label: "Recently checked", column: "checked_on", ascending: false },
  ],
  product: [
    { key: "vpd", label: "Views a day", column: "views_per_day", ascending: false },
    { key: "views", label: "Total views", column: "views", ascending: false },
    { key: "favorites", label: "Favorites", column: "favorites", ascending: false },
    { key: "newest", label: "Newest", column: "created_on", ascending: false },
    { key: "price", label: "Highest price", column: "price_cents", ascending: false },
  ],
  shop: [
    { key: "sales", label: "Total sales", column: "sold_count", ascending: false },
    { key: "reviews", label: "Reviews", column: "review_count", ascending: false },
    { key: "favorites", label: "Favorites", column: "favorers", ascending: false },
    { key: "newest", label: "Newest shops", column: "created_on", ascending: false },
    { key: "listings", label: "Most listings", column: "active_listings", ascending: false },
  ],
};

export function parseSort(kind: ResearchKind, raw: string | undefined): SortDef {
  return SORTS[kind].find((s) => s.key === raw) ?? SORTS[kind][0];
}

/** Build a research URL from params, dropping empty ones. */
export function researchHref(kind: ResearchKind, params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${RESEARCH_BASE[kind]}?${s}` : RESEARCH_BASE[kind];
}

/** Whole days between an ISO date (YYYY-MM-DD) or unix seconds and today (at least 1). */
export function ageInDays(created: string | number | null | undefined, today: string): number | null {
  if (created === null || created === undefined || created === "") return null;
  const start = typeof created === "number" ? created * 1000 : Date.parse(`${created.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

export function unixToDate(sec: number | null): string | null {
  return typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 10) : null;
}

export type ShopDay = { checked_on: string; sold_count: number | null };

/**
 * Real sales per day for a shop from daily snapshots: the change in Etsy's
 * lifetime sales count between the oldest and newest check in the last 30
 * days, divided by the days between them. Null until two checks exist on
 * different days. Never negative (Etsy's count can dip after cancellations).
 */
export function salesPerDay(days: ShopDay[], today: string): { perDay: number; overDays: number } | null {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000;
  const pts = days
    .filter((d) => typeof d.sold_count === "number" && Date.parse(`${d.checked_on}T00:00:00Z`) >= cutoff)
    .sort((a, b) => a.checked_on.localeCompare(b.checked_on));
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const overDays = Math.round((Date.parse(`${last.checked_on}T00:00:00Z`) - Date.parse(`${first.checked_on}T00:00:00Z`)) / 86_400_000);
  if (overDays < 1) return null;
  const perDay = Math.max(0, ((last.sold_count as number) - (first.sold_count as number)) / overDays);
  return { perDay: Math.round(perDay * 10) / 10, overDays };
}

/** Compact number: 1234 -> 1.2k, 15412 -> 15k, 7.25 -> 7.3. */
export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  if (v > 0 && v < 0.1) return "<0.1";
  if (v >= 10 || Number.isInteger(v)) return Math.round(v).toLocaleString("en-US");
  return v.toFixed(1).replace(/\.0$/, "");
}

export function money(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents === null || cents === undefined) return "–";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)}`;
  }
}

export function ageLabel(days: number | null): string {
  if (days === null) return "–";
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 60) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

/** Key of one saved item. Keywords are lower-cased; ids are digits only. */
export function normalizeSavedRef(kind: ResearchKind, ref: unknown): string | null {
  if (typeof ref !== "string" && typeof ref !== "number") return null;
  const s = String(ref).replace(/\s+/g, " ").trim();
  if (kind === "keyword") return s.length >= 2 && s.length <= 80 ? s.toLowerCase() : null;
  return /^[1-9]\d{0,18}$/.test(s) ? s : null;
}
