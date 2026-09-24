import { redirect } from "next/navigation";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { unwrapOrThrow } from "@/lib/unwrap";
import { rawOverall } from "@/lib/calibration";
import type { RubricJson } from "@/lib/rubric";
import { ProductViewSwitch } from "@/components/dashboard/product-view-switch";
import {
  ListingAnalyticsView,
  type AnalyticsViewModel,
} from "@/components/dashboard/listing-analytics-view";
import {
  addDays,
  buildDailySeries,
  buildMarketSeries,
  detectChanges,
  diagnose,
  evaluateAllTests,
  latestByKeyword,
  listingChecks,
  windowStats,
  type KeywordSnapshot,
  type ListingSnapshot,
} from "@/lib/listing-analytics";
import { todayUtc } from "@/lib/listing-monitor";

export const dynamic = "force-dynamic";

const HISTORY_DAYS = 90;
const KEYWORD_HISTORY_DAYS = 45;

/**
 * Listing Coach analytics for one product (docs/NORTH_STAR_LISTING_COACH.md).
 * Reads only the owner's rows under RLS; every number on the page is derived
 * here from stored daily snapshots by pure functions in listing-analytics.ts.
 */
export default async function ProductAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");

  const supabase = await createSupabaseServerClient();
  const today = todayUtc();
  const [entitlement, productResult, monitorResult, snapResult, kwResult, mainPhotoResult] = await Promise.all([
    getEntitlement(user.id),
    supabase.from("products").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("listing_monitors")
      .select("etsy_listing_id, keywords, enabled, last_checked_on, last_error")
      .eq("product_id", id)
      .maybeSingle(),
    supabase
      .from("listing_snapshots")
      .select("snapshot_date, etsy_listing_id, state, views, favorites, title, tags, description, main_image_id, main_image_url, image_count")
      .eq("product_id", id)
      .gte("snapshot_date", addDays(today, -HISTORY_DAYS))
      .order("snapshot_date", { ascending: true }),
    supabase
      .from("listing_keyword_snapshots")
      .select("snapshot_date, keyword, position, depth, top")
      .eq("product_id", id)
      .gte("snapshot_date", addDays(today, -KEYWORD_HISTORY_DAYS))
      .order("snapshot_date", { ascending: true }),
    supabase
      .from("photos")
      .select("current_audit_id")
      .eq("product_id", id)
      .eq("role", "main")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!entitlement.active && entitlement.reason !== "past_due") redirect("/subscribe");

  const product = unwrapOrThrow(productResult, "product_hydration_failed");
  if (!product) redirect("/dashboard");
  const monitor = unwrapOrThrow(monitorResult, "product_hydration_failed") as {
    etsy_listing_id: number | string;
    keywords: string[];
    enabled: boolean;
    last_checked_on: string | null;
    last_error: string | null;
  } | null;
  const listingId = monitor ? Number(monitor.etsy_listing_id) : null;
  const keywords = monitor?.keywords ?? [];

  const allSnaps = ((unwrapOrThrow(snapResult, "product_hydration_failed") as ListingSnapshot[] | null) ?? []).map(
    (s) => ({ ...s, etsy_listing_id: Number(s.etsy_listing_id), main_image_id: s.main_image_id === null ? null : Number(s.main_image_id), tags: s.tags ?? [] })
  );
  // Only the CURRENTLY linked listing's history (a re-link never mixes listings).
  const snaps = listingId ? allSnaps.filter((s) => s.etsy_listing_id === listingId) : [];
  // Only the CURRENTLY tracked keywords.
  const kwSnaps = ((unwrapOrThrow(kwResult, "product_hydration_failed") as KeywordSnapshot[] | null) ?? []).filter(
    (k) => keywords.includes(k.keyword)
  );

  const series = buildDailySeries(snaps);
  const market = buildMarketSeries(kwSnaps);
  const latestKeywords = latestByKeyword(kwSnaps);
  const events = detectChanges(snaps);
  const tests = evaluateAllTests(events, series, market, today);
  const latest = snaps.length ? snaps[snaps.length - 1] : null;

  // Mavya photo scores: the seller's main photo (raw, honest) and the top listings'.
  let ownPhotoScore: number | null = null;
  const mainPhoto = mainPhotoResult.data as { current_audit_id: string | null } | null;
  if (mainPhoto?.current_audit_id) {
    const { data: audit } = await supabase
      .from("audits")
      .select("rubric")
      .eq("id", mainPhoto.current_audit_id)
      .maybeSingle();
    const rubric = (audit as { rubric: RubricJson } | null)?.rubric;
    if (rubric && typeof rubric.overall_score === "number") ownPhotoScore = rawOverall(rubric);
  }
  const winnerImageIds = [
    ...new Set(latestKeywords.flatMap((k) => k.top.slice(0, 10).map((t) => t.mainImageId).filter((x): x is number => Boolean(x)))),
  ];
  const winnerScores = new Map<number, number>();
  if (winnerImageIds.length) {
    const { data } = await supabase
      .from("etsy_image_scores")
      .select("etsy_image_id, raw_score")
      .in("etsy_image_id", winnerImageIds);
    for (const r of (data as { etsy_image_id: number | string; raw_score: number | string }[] | null) ?? []) {
      winnerScores.set(Number(r.etsy_image_id), Number(r.raw_score));
    }
  }
  const topThreeScores = latestKeywords
    .flatMap((k) => k.top.slice(0, 3))
    .map((t) => (t.mainImageId ? winnerScores.get(t.mainImageId) : undefined))
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const winnerPhotoScore = topThreeScores.length
    ? topThreeScores[Math.floor((topThreeScores.length - 1) / 2)]
    : null;

  const checks = listingChecks({ latest, keywords, latestKeywords });
  const diagnosis = diagnose({
    linked: Boolean(monitor),
    series,
    market,
    latestKeywords,
    tests,
    today,
    ownPhotoScore,
    winnerPhotoScore,
    highSeverityChecks: checks.filter((c) => c.severity === "high").length,
  });
  const last7 = windowStats(series, addDays(today, -7), today);

  const vm: AnalyticsViewModel = {
    productId: product.id,
    productName: product.name,
    today,
    monitor: monitor
      ? {
          listingId: listingId!,
          keywords,
          enabled: monitor.enabled,
          lastCheckedOn: monitor.last_checked_on,
          lastError: monitor.last_error,
        }
      : null,
    listing: latest
      ? {
          title: latest.title,
          url: listingId ? `https://www.etsy.com/listing/${listingId}` : null,
          mainImageUrl: latest.main_image_url,
          imageCount: latest.image_count,
          tags: latest.tags,
          state: latest.state,
          totalViews: latest.views,
          totalFavorites: latest.favorites,
        }
      : null,
    last7: {
      days: last7.days,
      viewsPerDay: last7.viewsPerDay,
      favoritesPer100Views: last7.views >= 30 ? last7.favoritesPer100Views : null,
    },
    series: series.slice(-30).map((p) => ({ date: p.date, viewsPerDay: p.viewsPerDay, favoritesPerDay: p.favoritesPerDay })),
    changeDates: events.map((e) => ({ date: e.date, kinds: e.kinds })),
    keywords: latestKeywords.map((k) => ({
      keyword: k.keyword,
      position: k.position,
      depth: k.depth,
      date: k.snapshot_date,
      top: k.top.slice(0, 5).map((t) => ({
        ...t,
        photoScore: t.mainImageId ? winnerScores.get(t.mainImageId) ?? null : null,
      })),
    })),
    ownPhotoScore,
    winnerPhotoScore,
    diagnosis,
    checks,
    tests: tests.map((t) => ({
      date: t.event.date,
      kinds: t.event.kinds,
      verdict: t.verdict,
      daysAfter: t.daysAfter,
      beforeViewsPerDay: t.before.viewsPerDay,
      afterViewsPerDay: t.after.viewsPerDay,
      marketChange: t.marketChange,
      lift: t.lift,
      beforeTitle: t.event.before.title,
      afterTitle: t.event.after.title,
      beforeImage: t.event.before.mainImageUrl,
      afterImage: t.event.after.mainImageUrl,
    })),
    canEdit: entitlement.active,
  };

  return (
    <>
      <ProductViewSwitch productId={product.id} active="analytics" />
      <ListingAnalyticsView vm={vm} />
    </>
  );
}
