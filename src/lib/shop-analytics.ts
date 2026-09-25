/**
 * Shop home analytics (north star 11.4 A-C, 11.12 steps 4-5). PURE functions
 * over daily public snapshots of every tracked listing in a seller's shop.
 *
 * Honesty rules (same as the listing coach): consecutive-day counter deltas
 * only; missing days stay unknown; results say "after", never "because";
 * too little data yields "collecting" / "measuring", never a guess.
 * Before/after results use the REST OF THE SHOP over the same days as the
 * comparison, so a seasonal shop-wide rise cannot pass for a win.
 */

import {
  addDays,
  buildDailySeries,
  detectChanges,
  windowStats,
  type ChangeKind,
  type ListingSnapshot,
} from "@/lib/listing-analytics";

export type ShopSnapshotRow = {
  listing_id: number;
  snapshot_date: string;
  views: number | null;
  favorites: number | null;
  image_count: number | null;
  main_image_id: number | null;
  main_image_url: string | null;
  title: string | null;
  tags: string[] | null;
};

export type ShopStatus = "rising" | "falling" | "seen_not_liked" | "dead" | "steady" | "collecting";
export type FixAction = "write" | "photo" | "analytics";

export type ShopIssue = { kind: "tags" | "photos"; severity: "high" | "medium"; text: string };

export type ShopListingView = {
  listingId: number;
  title: string;
  mainImageUrl: string | null;
  tagsUsed: number;
  imageCount: number | null;
  viewsPerDay: number | null;
  views30: number | null;
  favoritesPer100: number | null;
  status: ShopStatus;
  issues: ShopIssue[];
  score: number;
};

export type ShopFix = { listingId: number; title: string; mainImageUrl: string | null; reason: string; action: FixAction };

export type ShopChangeResult = {
  listingId: number;
  title: string;
  date: string;
  kinds: ChangeKind[];
  beforePerDay: number | null;
  afterPerDay: number | null;
  shopChange: number | null;
  lift: number | null;
  verdict: "measuring" | "better" | "worse" | "no_change" | "not_enough_data" | "interrupted";
};

export type ShopView = {
  historyDays: number;
  listings: ShopListingView[];
  counts: Record<"rising" | "falling" | "seen_not_liked" | "dead", number>;
  fixQueue: ShopFix[];
  changes: ShopChangeResult[];
  summary: { measured: number; better: number };
};

export const MIN_HISTORY_DAYS = 14;
const CHANGE_WINDOW = 7;
const MIN_AFTER_DAYS = 7;
const BETTER = 1.15;
const WORSE = 0.87;

const med = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function toSnapshot(r: ShopSnapshotRow): ListingSnapshot {
  return {
    snapshot_date: r.snapshot_date,
    etsy_listing_id: Number(r.listing_id),
    state: "active",
    views: r.views,
    favorites: r.favorites,
    title: r.title,
    tags: r.tags ?? [],
    description: null,
    main_image_id: r.main_image_id === null ? null : Number(r.main_image_id),
    main_image_url: r.main_image_url,
    image_count: r.image_count,
  };
}

export function buildShopView(rows: ShopSnapshotRow[], today: string, currentIds?: readonly number[]): ShopView {
  const byListing = new Map<number, ListingSnapshot[]>();
  const dates = new Set<string>();
  for (const r of rows) {
    const id = Number(r.listing_id);
    const list = byListing.get(id) ?? [];
    list.push(toSnapshot(r));
    byListing.set(id, list);
    dates.add(r.snapshot_date);
  }
  const historyDays = dates.size;
  const latestDate = [...dates].sort().at(-1);
  const current = new Set(currentIds ?? rows.filter((r) => r.snapshot_date === latestDate).map((r) => Number(r.listing_id)));
  const last7From = addDays(today, -6);
  const prevFrom = addDays(today, -34);
  const prevTo = addDays(today, -7);
  const last30From = addDays(today, -29);

  type Work = { snaps: ListingSnapshot[]; series: ReturnType<typeof buildDailySeries>; latest: ListingSnapshot };
  const work = new Map<number, Work>();
  for (const [id, snaps] of byListing) {
    snaps.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    work.set(id, { snaps, series: buildDailySeries(snaps), latest: snaps[snaps.length - 1] });
  }

  // Shop median of net favorites per 100 views (listings with enough views).
  const favRates: number[] = [];
  for (const [id, w] of work) {
    if (!current.has(id)) continue;
    const s = windowStats(w.series, last30From, today);
    if (s.views >= 50 && s.favoritesPer100Views !== null) favRates.push(s.favoritesPer100Views);
  }
  const shopFavMedian = favRates.length >= 3 ? med(favRates) : null;

  const listings: ShopListingView[] = [];
  for (const [id, w] of work) {
    if (!current.has(id)) continue;
    const last7 = windowStats(w.series, last7From, today);
    const prev = windowStats(w.series, prevFrom, prevTo);
    const last30 = windowStats(w.series, last30From, today);
    let status: ShopStatus = "steady";
    if (last30.days < MIN_HISTORY_DAYS) status = "collecting";
    else if (last30.days >= 30 && last30.views <= 1) status = "dead";
    else if (last7.days >= 5 && prev.days >= 7 && prev.viewsPerDay !== null && last7.viewsPerDay !== null) {
      if (prev.viewsPerDay >= 1 && last7.viewsPerDay <= prev.viewsPerDay * 0.6) status = "falling";
      else if (last7.viewsPerDay >= 1 && last7.viewsPerDay >= prev.viewsPerDay * 1.5) status = "rising";
    }
    if (
      status === "steady" &&
      shopFavMedian !== null &&
      last30.views >= 50 &&
      last30.favoritesPer100Views !== null &&
      last30.favoritesPer100Views < shopFavMedian * 0.5
    ) {
      status = "seen_not_liked";
    }

    const tagsUsed = w.latest.tags.length;
    const issues: ShopIssue[] = [];
    const emptyTags = 13 - tagsUsed;
    if (emptyTags >= 4) issues.push({ kind: "tags", severity: "high", text: `${emptyTags} empty tag slots` });
    else if (emptyTags > 0) issues.push({ kind: "tags", severity: "medium", text: `${emptyTags} empty tag slot${emptyTags > 1 ? "s" : ""}` });
    const photos = w.latest.image_count;
    if (photos !== null && photos <= 3) issues.push({ kind: "photos", severity: "high", text: `Only ${photos} photo${photos === 1 ? "" : "s"}` });
    else if (photos !== null && photos < 6) issues.push({ kind: "photos", severity: "medium", text: `Only ${photos} photos` });

    const statusWeight = { falling: 3, seen_not_liked: 2, dead: 1.5, rising: 0, steady: 0, collecting: 0 }[status];
    const issueWeight = issues.reduce((s, i) => s + (i.severity === "high" ? 2 : 1), 0);
    const importance = 1 + Math.log10(1 + Math.max(0, last30.views || (w.latest.views ?? 0) / 30));
    const score = (statusWeight + issueWeight) * importance;

    listings.push({
      listingId: id,
      title: w.latest.title ?? `Listing ${id}`,
      mainImageUrl: w.latest.main_image_url,
      tagsUsed,
      imageCount: photos,
      viewsPerDay: last7.viewsPerDay,
      views30: last30.days ? last30.views : null,
      favoritesPer100: last30.views >= 30 ? last30.favoritesPer100Views : null,
      status,
      issues,
      score,
    });
  }
  listings.sort((a, b) => b.score - a.score || (b.views30 ?? 0) - (a.views30 ?? 0));

  const counts = { rising: 0, falling: 0, seen_not_liked: 0, dead: 0 };
  for (const l of listings) if (l.status in counts) counts[l.status as keyof typeof counts] += 1;

  const fixQueue: ShopFix[] = listings
    .filter((l) => l.score > 0)
    .slice(0, 3)
    .map((l) => {
      const tagIssue = l.issues.find((i) => i.kind === "tags");
      const photoIssue = l.issues.find((i) => i.kind === "photos");
      const statusText =
        l.status === "falling" ? "Views falling" : l.status === "seen_not_liked" ? "Seen, but few favorites" : l.status === "dead" ? "Almost no views in 30 days" : null;
      const reason = [statusText, tagIssue?.text, photoIssue?.text].filter(Boolean).slice(0, 2).join(" · ");
      const action: FixAction =
        l.status === "seen_not_liked" && photoIssue ? "photo" : tagIssue || l.status === "dead" || l.status === "falling" ? "write" : photoIssue ? "photo" : "analytics";
      return { listingId: l.listingId, title: l.title, mainImageUrl: l.mainImageUrl, reason, action };
    });

  const changes = shopChanges(work, today);
  const measured = changes.filter((c) => c.verdict === "better" || c.verdict === "worse" || c.verdict === "no_change");
  return {
    historyDays,
    listings,
    counts,
    fixQueue,
    changes,
    summary: { measured: measured.length, better: measured.filter((c) => c.verdict === "better").length },
  };
}

function shopChanges(
  work: Map<number, { snaps: ListingSnapshot[]; series: ReturnType<typeof buildDailySeries> }>,
  today: string
): ShopChangeResult[] {
  const changeDates = new Map<number, string[]>();
  const events: { id: number; title: string; date: string; kinds: ChangeKind[] }[] = [];
  for (const [id, w] of work) {
    // Price is not part of detectChanges; title, tags, main photo are.
    const ev = detectChanges(w.snaps).filter((e) => e.kinds.some((k) => k !== "description"));
    changeDates.set(id, ev.map((e) => e.date));
    for (const e of ev) events.push({ id, title: e.after.title ?? `Listing ${id}`, date: e.date, kinds: e.kinds.filter((k) => k !== "description") });
  }
  const results: ShopChangeResult[] = [];
  // Bound expensive control comparisons before evaluation, not afterward.
  for (const e of events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20)) {
    const bFrom = addDays(e.date, -CHANGE_WINDOW);
    const bTo = addDays(e.date, -1);
    const aFrom = addDays(e.date, 1);
    const aTo = addDays(e.date, CHANGE_WINDOW);
    const series = work.get(e.id)!.series;
    const before = windowStats(series, bFrom, bTo);
    const after = windowStats(series, aFrom, aTo < today ? aTo : today);
    const base = { listingId: e.id, title: e.title, date: e.date, kinds: e.kinds, beforePerDay: before.viewsPerDay, afterPerDay: after.viewsPerDay, shopChange: null, lift: null };
    const ownChanges = changeDates.get(e.id) ?? [];
    if (ownChanges.some((d) => d > e.date && d <= aTo)) {
      results.push({ ...base, verdict: "interrupted" });
      continue;
    }
    if (ownChanges.some((d) => d >= bFrom && d < e.date)) {
      results.push({ ...base, verdict: "not_enough_data" });
      continue;
    }
    if (after.days < MIN_AFTER_DAYS) {
      results.push({ ...base, verdict: aTo >= today ? "measuring" : "not_enough_data" });
      continue;
    }
    if (!before.viewsPerDay || before.days < 3 || after.views < 10) {
      results.push({ ...base, verdict: "not_enough_data" });
      continue;
    }
    // The same control cohort must cover EVERY observed seller date in both
    // windows. Independently averaging sparse windows manufactures lift.
    const matchedDates = new Set(series.filter((p) => p.viewsPerDay !== null &&
      ((p.date >= bFrom && p.date <= bTo) || (p.date >= aFrom && p.date <= aTo && p.date <= today))).map((p) => p.date));
    const ratios: number[] = [];
    for (const [id, w] of work) {
      if (id === e.id) continue;
      if ((changeDates.get(id) ?? []).some((d) => d >= bFrom && d <= aTo)) continue;
      const matched = w.series.filter((p) => matchedDates.has(p.date) && p.viewsPerDay !== null);
      if (matched.length !== matchedDates.size) continue;
      const b = windowStats(matched, bFrom, bTo);
      const a = windowStats(matched, aFrom, aTo);
      if (b.viewsPerDay && b.viewsPerDay > 0 && a.viewsPerDay !== null && b.days >= 3 && a.days >= MIN_AFTER_DAYS) ratios.push(a.viewsPerDay / b.viewsPerDay);
    }
    const shopChange = ratios.length >= 3 ? med(ratios) : null;
    if (!shopChange || shopChange <= 0) {
      results.push({ ...base, verdict: "not_enough_data" });
      continue;
    }
    const lift = (after.viewsPerDay ?? 0) / before.viewsPerDay / shopChange;
    results.push({ ...base, shopChange, lift, verdict: lift >= BETTER ? "better" : lift <= WORSE ? "worse" : "no_change" });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
}
