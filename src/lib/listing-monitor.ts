import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EtsyApiError,
  fetchEtsyImage,
  fetchListingsBatch,
  searchActiveListings,
  type EtsyListing,
} from "@/lib/etsy";
import type { TopEntry } from "@/lib/listing-analytics";
import { scorePhoto } from "@/lib/score-photo";
import { rawOverall } from "@/lib/calibration";
import { RUBRIC_VERSION } from "@/lib/versions";
import { logEvent } from "@/lib/errors";

/**
 * Daily Listing Coach snapshot runner (docs/NORTH_STAR_LISTING_COACH.md).
 * SERVER ONLY, service-role client. Callers MUST have already checked
 * ownership (link route) or entitlement (cron) for every monitor passed in.
 *
 * Etsy call budget per run: one batch call per 100 monitored listings, one
 * search per UNIQUE keyword (shared across products), and one batch call per
 * 100 unique top listings. Idempotent per day: re-running upserts today's rows.
 */

export type MonitorRow = {
  product_id: string;
  user_id: string;
  etsy_listing_id: number;
  keywords: string[];
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
  opts: { today?: string; maxWinnerScores?: number } = {}
): Promise<MonitorRunSummary> {
  const today = opts.today ?? todayUtc();
  const summary: MonitorRunSummary = {
    monitors: monitors.length,
    snapshots: 0,
    keywordSnapshots: 0,
    winnerPhotosScored: 0,
    errors: 0,
  };
  if (monitors.length === 0) return summary;
  const errorsByProduct = new Map<string, string>();

  // 1. The sellers' own listings.
  const own = await fetchListingsBatch(monitors.map((m) => m.etsy_listing_id));
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
      .upsert(snapshotRows, { onConflict: "product_id,snapshot_date" });
    if (error) throw new Error(`listing_snapshots upsert failed: ${error.message}`);
    summary.snapshots = snapshotRows.length;
  }

  // 2. One search per unique keyword, shared by every product tracking it.
  const keywords = [...new Set(monitors.flatMap((m) => m.keywords))];
  const searchResults = new Map<string, EtsyListing[]>();
  for (const kw of keywords) {
    try {
      searchResults.set(kw, await searchActiveListings(kw, 100));
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
  if (topIds.length) {
    try {
      topDetails = await fetchListingsBatch(topIds);
    } catch (err) {
      summary.errors += 1;
      logEvent("listing_monitor.top_batch_failed", {
        code: err instanceof EtsyApiError ? err.code : "unknown",
      });
    }
  }

  const topByKeyword = new Map<string, TopEntry[]>();
  for (const [kw, results] of searchResults) {
    topByKeyword.set(
      kw,
      results.slice(0, TOP_N).map((l) => toTopEntry(topDetails.get(l.listingId) ?? l))
    );
  }

  const kwRows = [];
  for (const m of monitors) {
    for (const kw of m.keywords) {
      const results = searchResults.get(kw);
      if (!results) continue;
      const idx = results.findIndex((l) => l.listingId === m.etsy_listing_id);
      kwRows.push({
        product_id: m.product_id,
        snapshot_date: today,
        keyword: kw,
        position: idx >= 0 ? idx + 1 : null,
        depth: results.length,
        top: topByKeyword.get(kw) ?? [],
      });
    }
  }
  if (kwRows.length) {
    const { error } = await admin
      .from("listing_keyword_snapshots")
      .upsert(kwRows, { onConflict: "product_id,snapshot_date,keyword" });
    if (error) throw new Error(`listing_keyword_snapshots upsert failed: ${error.message}`);
    summary.keywordSnapshots = kwRows.length;
  }

  // 3. Score top listings' main photos with the same rubric (cached forever by image id).
  const maxScores = opts.maxWinnerScores ?? 12;
  if (maxScores > 0) {
    const scored = await scoreWinnerPhotos(admin, [...topByKeyword.values()], maxScores);
    summary.winnerPhotosScored = scored.scored;
    summary.errors += scored.errors;
  }
  summary.topByKeyword = topByKeyword;

  // 4. Record run status per monitor.
  for (const m of monitors) {
    const err = errorsByProduct.get(m.product_id) ?? null;
    if (err) summary.errors += 1;
    await admin
      .from("listing_monitors")
      .update({ last_checked_on: today, last_error: err, updated_at: new Date().toISOString() })
      .eq("product_id", m.product_id);
  }

  return summary;
}

/**
 * Score the main photos of the top WINNER_PHOTOS_PER_KEYWORD listings per
 * keyword with Mavya's main rubric. Cached forever by Etsy image id (an id
 * always names the same image), so each winner photo costs one AI call ever.
 * Stores the honest RAW score; comparisons never use the calibrated one.
 */
export async function scoreWinnerPhotos(
  admin: SupabaseClient,
  lists: TopEntry[][],
  max: number
): Promise<{ scored: number; errors: number }> {
  const result = { scored: 0, errors: 0 };
  if (max <= 0 || !process.env.OPENAI_API_KEY) return result;
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
    .in("etsy_image_id", [...candidates.keys()]);
  if (error) {
    result.errors += 1;
    return result;
  }
  for (const row of (existing as { etsy_image_id: number | string }[] | null) ?? []) {
    candidates.delete(Number(row.etsy_image_id));
  }
  for (const t of [...candidates.values()].slice(0, max)) {
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
