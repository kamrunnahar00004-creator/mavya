import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EtsyApiError,
  fetchEtsyImage,
  fetchListingsBatch,
  type EtsyListing,
} from "@/lib/etsy";
import type { TopEntry } from "@/lib/listing-analytics";
import { getSearchCached } from "@/lib/search-cache";
import { scorePhoto } from "@/lib/score-photo";
import { rawOverall } from "@/lib/calibration";
import { RUBRIC_VERSION } from "@/lib/versions";
import { logEvent } from "@/lib/errors";
import { aiDisabled, withinGlobalBudget } from "@/lib/usage";
import { weightedRateLimit } from "@/lib/rate-limit";

/**
 * Daily Listing Coach snapshot runner (docs/NORTH_STAR_LISTING_COACH.md).
 * SERVER ONLY, service-role client. Callers MUST have already checked
 * ownership (link route) or entitlement (cron) for every monitor passed in.
 *
 * Etsy call budget per run: one batch call per 100 monitored listings, one
 * search per UNIQUE keyword (shared across products), and one batch call per
 * 100 unique top listings. Retries preserve the first complete daily observation.
 */

export type MonitorRow = {
  product_id: string;
  user_id: string;
  etsy_listing_id: number;
  keywords: string[];
  /** Configuration version (listing + keywords): scopes keyword history. */
  revision: string;
  /** Linked-listing version: scopes the listing's own daily history. */
  listing_revision: string;
};

export type MonitorRunSummary = {
  monitors: number;
  snapshots: number;
  keywordSnapshots: number;
  winnerPhotosScored: number;
  errors: number;
  /** Top listings per keyword from this run (lets callers score winner photos later). */
  topByKeyword?: Map<string, TopEntry[]>;
};

const TOP_N = 10;
const WINNER_PHOTOS_PER_KEYWORD = 3;
const MAX_MISSING_TOP = 2;

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toTopEntry(l: EtsyListing): TopEntry {
  const main = l.images[0] ?? null;
  return {
    id: l.listingId,
    title: l.title.slice(0, 200),
    tags: l.tags.slice(0, 13),
    views: l.views,
    favorites: l.favorites,
    imageCount: l.images.length,
    mainImageId: main?.id ?? null,
    mainImageUrl: main?.url570 ?? null,
    url: l.url,
  };
}

export async function runListingMonitor(
  admin: SupabaseClient,
  monitors: MonitorRow[],
  opts: { today?: string; maxWinnerScores?: number; deadlineAt?: number } = {}
): Promise<MonitorRunSummary> {
  const today = opts.today ?? todayUtc();
  const deadlineAt = opts.deadlineAt ?? Date.now() + 90_000;
  const summary: MonitorRunSummary = {
    monitors: monitors.length,
    snapshots: 0,
    keywordSnapshots: 0,
    winnerPhotosScored: 0,
    errors: 0,
  };
  if (monitors.length === 0) return summary;
  const { data: current, error: currentError } = await admin.from("listing_monitors")
    .select("product_id, revision, listing_revision, enabled, last_checked_on").in("product_id", monitors.map((m) => m.product_id));
  if (currentError) throw new Error("Could not revalidate monitors");
  monitors = monitors.filter((m) => current?.some((row) => row.product_id === m.product_id && row.revision === m.revision && row.listing_revision === m.listing_revision && row.enabled && row.last_checked_on !== today));
  if (!monitors.length) return summary;
  const errorsByProduct = new Map<string, string>();

  // 1. The sellers' own listings.
  const own = await fetchListingsBatch(monitors.map((m) => m.etsy_listing_id), deadlineAt);
  const snapshotRows = [];
  for (const m of monitors) {
    const l = own.get(m.etsy_listing_id);
    if (!l) {
      errorsByProduct.set(m.product_id, "listing_not_found");
      continue;
    }
    const main = l.images[0] ?? null;
    snapshotRows.push({
      product_id: m.product_id,
      listing_revision: m.listing_revision,
      control_revision: m.revision,
      snapshot_date: today,
      etsy_listing_id: l.listingId,
      state: l.state,
      views: l.views,
      favorites: l.favorites,
      title: l.title,
      tags: l.tags,
      description: l.description.slice(0, 20_000),
      price_cents: l.priceCents,
      currency: l.currency,
      main_image_id: main?.id ?? null,
      main_image_url: main?.url570 ?? null,
      image_count: l.images.length,
    });
  }
  if (snapshotRows.length) {
    const { error } = await admin
      .from("listing_snapshots")
      .upsert(snapshotRows, { onConflict: "product_id,listing_revision,snapshot_date", ignoreDuplicates: true });
    if (error) throw new Error(`listing_snapshots upsert failed: ${error.message}`);
    summary.snapshots = snapshotRows.length;
  }

  // 2. One search per unique keyword, shared by every product tracking it.
  const keywords = [...new Set(monitors.flatMap((m) => m.keywords))];
  const searchResults = new Map<string, EtsyListing[]>();
  for (const kw of keywords) {
    try {
      // Shared daily cache: one Etsy search per keyword per day for all sellers.
      searchResults.set(kw, (await getSearchCached(admin, kw, today, deadlineAt)).results);
    } catch (err) {
      summary.errors += 1;
      logEvent("listing_monitor.search_failed", {
        code: err instanceof EtsyApiError ? err.code : "unknown",
      });
      if (err instanceof EtsyApiError && err.code === "rate_limited") break;
    }
  }

  // Search results carry no images; fetch the top listings once, with images.
  const topIds = [...searchResults.values()].flatMap((r) => r.slice(0, TOP_N).map((l) => l.listingId));
  let topDetails = new Map<number, EtsyListing>();
  let detailsSucceeded = true;
  if (topIds.length) {
    try {
      topDetails = await fetchListingsBatch(topIds, deadlineAt);
    } catch (err) {
      detailsSucceeded = false;
      summary.errors += 1;
      logEvent("listing_monitor.top_batch_failed", {
        code: err instanceof EtsyApiError ? err.code : "unknown",
      });
    }
  }

  const topByKeyword = new Map<string, TopEntry[]>();
  for (const [kw, results] of searchResults) {
    if (!detailsSucceeded) continue;
    // A listing can disappear between the search and the detail fetch. Allow
    // up to MAX_MISSING_TOP gaps (dropped, never guessed); more than that is an
    // incomplete comparison and the day is retried. Ranks keep search order.
    const top = results.slice(0, TOP_N);
    const present = top.filter((l) => topDetails.has(l.listingId));
    if (top.length - present.length > MAX_MISSING_TOP) continue;
    topByKeyword.set(
      kw,
      top.flatMap((l, index) => {
        const d = topDetails.get(l.listingId);
        return d ? [{ ...toTopEntry(d), position: index + 1 }] : [];
      })
    );
  }

  const kwRows = [];
  for (const m of monitors) {
    for (const kw of m.keywords) {
      const results = searchResults.get(kw);
      if (!results || !topByKeyword.has(kw) || !own.has(m.etsy_listing_id)) continue;
      const idx = results.findIndex((l) => l.listingId === m.etsy_listing_id);
      kwRows.push({
        product_id: m.product_id,
        revision: m.revision,
        listing_revision: m.listing_revision,
        snapshot_date: today,
        keyword: kw,
        position: idx >= 0 ? idx + 1 : null,
        depth: results.length,
        top: (topByKeyword.get(kw) ?? []).filter((t) => t.id !== m.etsy_listing_id),
      });
    }
  }
  if (kwRows.length) {
    const { error } = await admin
      .from("listing_keyword_snapshots")
      .upsert(kwRows, { onConflict: "product_id,revision,snapshot_date,keyword", ignoreDuplicates: true });
    if (error) throw new Error(`listing_keyword_snapshots upsert failed: ${error.message}`);
    summary.keywordSnapshots = kwRows.length;
  }

  // 3. Score main photos once per image and rubric version.
  // Also score the actual linked Etsy photo. An uploaded Mavya photo may be
  // unrelated or out of date, and must never label a different Etsy image.
  const ownLists = [...own.values()].map((l) => [toTopEntry(l)]);
  const scoreLists = [...ownLists, ...topByKeyword.values()];
  const maxScores = opts.maxWinnerScores ?? 0;
  if (maxScores > 0) {
    const scored = await scoreWinnerPhotos(admin, scoreLists, maxScores, deadlineAt);
    summary.winnerPhotosScored = scored.scored;
    summary.errors += scored.errors;
  }
  summary.topByKeyword = new Map([...own.values()].map((l) => [`own:${l.listingId}`, [toTopEntry(l)]]));
  for (const [keyword, entries] of topByKeyword) summary.topByKeyword.set(keyword, entries);

  // 4. Record run status per monitor.
  for (const m of monitors) {
    const err = errorsByProduct.get(m.product_id) ?? (m.keywords.some((kw) => !searchResults.has(kw)) ? "search_failed" : m.keywords.some((kw) => !topByKeyword.has(kw)) ? "comparison_incomplete" : null);
    if (err) summary.errors += 1;
    const { error } = await admin
      .from("listing_monitors")
      .update({ ...(!err ? { last_checked_on: today } : {}), last_error: err, updated_at: new Date().toISOString() })
      .eq("product_id", m.product_id)
      .eq("revision", m.revision);
    if (error) throw new Error("Could not persist monitor status");
  }

  return summary;
}

/**
 * DORMANT (founder decision 2026-09-24): no route calls this. Mavya does not
 * AI-score other shops' photos; the Analytics page compares views, favorites
 * and photo counts instead. Kept, with its tests, in case that changes.
 *
 * Score the main photos of the top WINNER_PHOTOS_PER_KEYWORD listings per
 * keyword with Mavya's main rubric. Cached by Etsy image id and rubric version.
 * Stores the honest RAW score; comparisons never use the calibrated one.
 */
export async function scoreWinnerPhotos(
  admin: SupabaseClient,
  lists: TopEntry[][],
  max: number,
  deadlineAt = Date.now() + 110_000
): Promise<{ scored: number; errors: number }> {
  const result = { scored: 0, errors: 0 };
  if (max <= 0 || !process.env.OPENAI_API_KEY || aiDisabled()) return result;
  const candidates = new Map<number, TopEntry>();
  for (const entries of lists) {
    for (const t of entries.slice(0, WINNER_PHOTOS_PER_KEYWORD)) {
      if (t.mainImageId && t.mainImageUrl) candidates.set(t.mainImageId, t);
    }
  }
  if (candidates.size === 0) return result;
  const { data: existing, error } = await admin
    .from("etsy_image_scores")
    .select("etsy_image_id")
    .eq("rubric_version", RUBRIC_VERSION)
    .in("etsy_image_id", [...candidates.keys()]);
  if (error) {
    result.errors += 1;
    return result;
  }
  for (const row of (existing as { etsy_image_id: number | string }[] | null) ?? []) {
    candidates.delete(Number(row.etsy_image_id));
  }
  for (const t of [...candidates.values()].slice(0, max)) {
    // A score may require two 45s provider calls plus a 15s image fetch.
    if (Date.now() + 105_000 > deadlineAt || aiDisabled()) break;
    if (!(await weightedRateLimit(`etsy:image:${RUBRIC_VERSION}:${t.mainImageId}`, 1, 1, 300_000)).ok) continue;
    if (!(await withinGlobalBudget("score"))) break;
    try {
      const { buffer, mime } = await fetchEtsyImage(t.mainImageUrl!);
      const rubric = await scorePhoto({
        imageBuffer: buffer,
        imageMimeType: mime,
        buyerQuestions: { kind: "none" },
      });
      if (rubric.upload_kind === "invalid") continue;
      const { error: upsertError } = await admin.from("etsy_image_scores").upsert({
        etsy_image_id: t.mainImageId,
        etsy_listing_id: t.id,
        raw_score: rawOverall(rubric),
        pillars: rubric.pillars,
        rubric_version: RUBRIC_VERSION,
      });
      if (upsertError) throw upsertError;
      result.scored += 1;
    } catch {
      result.errors += 1;
      logEvent("listing_monitor.winner_score_failed", { etsyImageId: t.mainImageId });
    }
  }
  return result;
}
