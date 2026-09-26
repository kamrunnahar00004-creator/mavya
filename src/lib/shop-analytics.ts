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

import { checkListing, scoreChecks, type CheckItem, type ListingScore } from "@/lib/listing-check";
import {
  addDays,
  dailyRatioTest,
  ratioVerdict,
  type RatioDay,
  wasFallingBefore,
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
  /** Listing creation date (migration 0035); null on older rows. */
  created_on?: string | null;
  /** Description facts (migration 0039); null on older rows. */
  description_len?: number | null;
  description_has_size?: boolean | null;
  description_has_file_info?: boolean | null;
};

export type ShopStatus = "rising" | "falling" | "seen_not_liked" | "dead" | "steady" | "collecting";
export type FixAction = "write" | "photo" | "analytics";

export type ShopIssue = { kind: "title" | "photos" | "tags"; severity: "high" | "medium"; text: string };

const TITLE_STOP = new Set(["and", "for", "the", "with", "a", "an", "of", "in", "to", "or", "on", "your", "my", "by"]);

/** Visible title problems (no AI): short, one word repeated, or shouting. */
export function titleIssues(title: string | null): ShopIssue[] {
  const t = (title ?? "").trim();
  if (!t) return [{ kind: "title", severity: "high", text: "No title" }];
  const out: ShopIssue[] = [];
  // Etsy's own advice favors short, readable titles. Under 20 characters
  // ("Keychain") is a real gap; 20-39 ("Silver Moon Stud Earrings") is only a
  // small nudge; 40-140 is fine.
  if (t.length < 20) out.push({ kind: "title", severity: "high", text: "Very short title" });
  else if (t.length < 40) out.push({ kind: "title", severity: "medium", text: "Short title" });
  const counts = new Map<string, number>();
  for (const w of t.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
    if (w.length > 2 && !TITLE_STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const repeated = [...counts].find(([, n]) => n >= 3);
  if (repeated) out.push({ kind: "title", severity: "medium", text: `Title repeats "${repeated[0]}"` });
  const letters = t.replace(/[^a-z]/gi, "");
  if (letters.length > 10 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6) {
    out.push({ kind: "title", severity: "medium", text: "Title in capitals" });
  }
  return out;
}

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
  /** Etsy's all-time counters on the latest check (available from day 1). */
  totalViews: number | null;
  totalFavorites: number | null;
  /** All-time views / days since the listing was created (day-1 average). */
  avgPerDay: number | null;
  /** Days of daily data in the last 30 (trends need MIN_HISTORY_DAYS). */
  trendDays: number;
  /** Last 7 days vs the 4 weeks before (views/day ratio); null until known. */
  trendRatio: number | null;
  /** Views per day for the last 14 days, oldest first; null = unknown day. */
  spark: (number | null)[];
  /** Seller marked it as working: never suggested for changes. */
  protected: boolean;
  /** Listing check on the latest snapshot (title, tags, description facts, photo count). */
  check: ListingScore;
  checks: CheckItem[];
  /** Listing creation date, when known. */
  createdOn: string | null;
};

export type ShopFix = {
  listingId: number;
  title: string;
  mainImageUrl: string | null;
  /** What the problem is (short). */
  reason: string;
  /** What to do about it, in plain words ("Add tags (0 of 13 used), then add more photos (only 2)."). */
  todo: string;
  /** Button label naming the first step ("Add tags", "Add photos", "Fix title"). */
  button: string;
  action: FixAction;
};

/** Plain instruction for one visible problem. */
export function issueTodo(i: ShopIssue): string {
  if (i.kind === "tags") {
    if (i.text === "No tags") return "add tags (0 of 13 used)";
    const n = Number(i.text.match(/\d+/)?.[0] ?? 0);
    return `fill ${n} empty tag${n === 1 ? "" : "s"}`;
  }
  if (i.kind === "photos") return `add more photos (only ${i.text.match(/\d+/)?.[0] ?? "a few"})`;
  if (i.text === "No title") return "add a title";
  if (i.text.startsWith("Title repeats")) return "stop repeating a word in the title";
  if (i.text === "Title in capitals") return "use normal case in the title";
  return "write a fuller title (say what it is and who it is for)";
}

const BUTTON: Record<ShopIssue["kind"], string> = { tags: "Add tags", photos: "Add photos", title: "Fix title" };
const STATUS_SENTENCE: Partial<Record<ShopStatus, string>> = {
  falling: "Views are falling.",
  seen_not_liked: "People look but rarely favorite it.",
  dead: "Almost no views in 30 days.",
};

export type ShopChangeResult = {
  listingId: number;
  title: string;
  date: string;
  kinds: ChangeKind[];
  beforePerDay: number | null;
  afterPerDay: number | null;
  shopChange: number | null;
  lift: number | null;
  /** Likely range of the lift from the daily-ratio test; null until judged. */
  liftLow: number | null;
  liftHigh: number | null;
  /** Already falling before the change: a rise may partly be a natural bounce. */
  wasFalling: boolean;
  verdict: "measuring" | "better" | "worse" | "no_change" | "not_enough_data" | "interrupted";
};

export type ShopTopListing = { listingId: number; title: string; mainImageUrl: string | null; views: number; favorites: number | null };

export type ShopDailyPoint = { date: string; views: number | null; favorites: number | null };

/** One problem shared by most of the shop, said once instead of per listing. */
export type ShopWideIssue = {
  kind: "tags";
  /** Listings with 7+ of 13 tag slots empty. */
  count: number;
  /** Of those, listings with no tags at all. */
  none: number;
  total: number;
  /** Most viewed affected listings, to start with. */
  start: { listingId: number; title: string; mainImageUrl: string | null }[];
};

export type ShopView = {
  historyDays: number;
  shopWide: ShopWideIssue | null;
  /** All-time totals from Etsy's counters on the latest check (day 1 value). */
  totals: { views: number; favorites: number };
  /** Shop views and favorites per day, last 30 days. Null = not enough listings reported that day. */
  daily: ShopDailyPoint[];
  /** Most viewed listings of all time (available from the first check). */
  top: ShopTopListing[];
  listings: ShopListingView[];
  counts: Record<"rising" | "falling" | "seen_not_liked" | "dead", number>;
  fixQueue: ShopFix[];
  changes: ShopChangeResult[];
  summary: { measured: number; better: number };
};

export const MIN_HISTORY_DAYS = 14;
/** Confidence x ease per problem area (see the score in buildShopView). */
const ISSUE_FACTOR: Record<ShopIssue["kind"], number> = { tags: 1.0 * 1.2, title: 0.8 * 1.0, photos: 0.8 * 0.7 };
/** Monthly views above this add no more priority. */
const TRAFFIC_CAP = 3000;
/** Views needed in a week before a rise or fall is called (noise floor). */
export const MIN_TREND_VIEWS = 20;
const CHANGE_WINDOW = 14;
const MIN_AFTER_DAYS = 7;

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

/** Seller choices for "Fix these first" (migration 0037). */
export type ShopFixPrefs = {
  /** Listing id -> date (YYYY-MM-DD) until which its tip is hidden ("Not now"). */
  dismissed?: Record<string, string>;
  /** Listings the seller marked as working: never suggested for changes. */
  protectedIds?: readonly number[];
};

export const DISMISS_DAYS = 30;

export function buildShopView(rows: ShopSnapshotRow[], today: string, currentIds?: readonly number[], prefs: ShopFixPrefs = {}): ShopView {
  const protectedSet = new Set((prefs.protectedIds ?? []).map(Number));
  const hiddenUntil = prefs.dismissed ?? {};
  const byListing = new Map<number, ListingSnapshot[]>();
  const createdById = new Map<number, string>();
  // Latest description facts per listing (not part of the analytics snapshot type).
  const descById = new Map<number, { date: string; length: number; hasSize: boolean; hasFileInfo: boolean }>();
  const dates = new Set<string>();
  for (const r of rows) {
    const id = Number(r.listing_id);
    if (typeof r.description_len === "number" && (descById.get(id)?.date ?? "") <= r.snapshot_date) {
      descById.set(id, { date: r.snapshot_date, length: r.description_len, hasSize: Boolean(r.description_has_size), hasFileInfo: Boolean(r.description_has_file_info) });
    }
    const list = byListing.get(id) ?? [];
    list.push(toSnapshot(r));
    byListing.set(id, list);
    dates.add(r.snapshot_date);
    if (r.created_on) createdById.set(id, r.created_on);
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

  // Shop-wide pattern: 5+ listings and 60%+ of the shop share the tag gap. It
  // is then said once at shop level, and "Fix these first" ranks the other
  // problems, so it does not just repeat "Add tags" on the three busiest.
  let trackedCount = 0;
  let thinTags = 0;
  for (const [id, w] of work) {
    if (!current.has(id)) continue;
    trackedCount += 1;
    if (13 - w.latest.tags.length >= 7) thinTags += 1;
  }
  const tagsShopWide = trackedCount >= 5 && thinTags / trackedCount >= 0.6;

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
      // Noise floor: at ~1 view a day, +50% is 0.7 -> 1.05 views, which is
      // chance. A trend needs 20+ views in the busier of the two weeks compared.
      const enough = Math.max(last7.viewsPerDay, prev.viewsPerDay) * 7 >= MIN_TREND_VIEWS;
      if (enough && prev.viewsPerDay >= 1 && last7.viewsPerDay <= prev.viewsPerDay * 0.6) status = "falling";
      else if (enough && last7.viewsPerDay >= 1 && last7.viewsPerDay >= prev.viewsPerDay * 1.5) status = "rising";
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
    // One problem per area at most (title, photos, tags), so a listing is
    // never ranked on tags alone twice over. Order = what a buyer sees first.
    const issues: ShopIssue[] = [];
    const title = titleIssues(w.latest.title);
    if (title.length) issues.push(title.find((i) => i.severity === "high") ?? title[0]);
    const photos = w.latest.image_count;
    if (photos !== null && photos <= 3) issues.push({ kind: "photos", severity: "high", text: `Only ${photos} photo${photos === 1 ? "" : "s"}` });
    else if (photos !== null && photos < 6) issues.push({ kind: "photos", severity: "medium", text: `Only ${photos} photos` });
    const emptyTags = 13 - tagsUsed;
    // No tags at all is the biggest visible gap: listed first so it leads.
    if (emptyTags === 13) issues.unshift({ kind: "tags", severity: "high", text: "No tags" });
    else if (emptyTags >= 7) issues.push({ kind: "tags", severity: "high", text: `${emptyTags} empty tag slots` });
    else if (emptyTags > 0) issues.push({ kind: "tags", severity: "medium", text: `${emptyTags} empty tag slot${emptyTags > 1 ? "s" : ""}` });

    // Priority = severity x confidence x ease, then x capped traffic. Tags are
    // certain and take minutes (quick wins give early proof); title advice is
    // likelier to be a judgment call; photos take a reshoot. Status points are
    // discounted by how sure a trend label can be at Etsy traffic levels.
    const statusWeight = { falling: 3 * 0.9, seen_not_liked: 2 * 0.7, dead: 1.5 * 0.9, rising: 0, steady: 0, collecting: 0 }[status];
    const issueWeight = issues
      .filter((i) => !(tagsShopWide && i.kind === "tags"))
      .reduce((s, i) => s + (i.severity === "high" ? 2 : 1) * ISSUE_FACTOR[i.kind], 0);
    // Traffic weighs strongly (square root, not log): the same gap on a listing
    // many buyers see is worth more than two gaps on one almost nobody sees.
    const createdAtDay = createdById.get(id) ?? null;
    const liveDays = createdAtDay ? Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${createdAtDay}T00:00:00Z`)) / 86_400_000)) : null;
    // Day 1 (no daily data): 30 days at the listing's average views/day since
    // it went live; without a creation date, all-time views / 30 as before.
    const monthViews = last30.days > 0 ? last30.views / last30.days * 30 : ((w.latest.views ?? 0) / (liveDays ? liveDays / 30 : 30));
    // Capped so a very popular listing cannot win on traffic alone.
    const importance = 1 + Math.sqrt(Math.min(TRAFFIC_CAP, Math.max(0, monthViews)));
    const score = (statusWeight + issueWeight) * importance;

    const totalViews = typeof w.latest.views === "number" && w.latest.views > 0 ? w.latest.views : null;
    const createdOn = createdById.get(id) ?? null;
    const ageDays = createdOn ? Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${createdOn}T00:00:00Z`)) / 86_400_000)) : null;
    const spark: (number | null)[] = [];
    const byDate = new Map(w.series.map((pt) => [pt.date, pt.viewsPerDay]));
    for (let d = addDays(today, -13); d <= today; d = addDays(d, 1)) spark.push(byDate.get(d) ?? null);
    const checks = checkListing({
      title: w.latest.title ?? "",
      tags: w.latest.tags ?? [],
      description: null,
      descriptionFacts: descById.get(id) ?? null,
      keywords: [],
      winnerTags: [],
      isDigital: null,
      photos: { imageCount: photos },
    });
    listings.push({
      check: scoreChecks(checks),
      checks,
      createdOn,
      totalViews,
      totalFavorites: typeof w.latest.favorites === "number" ? w.latest.favorites : null,
      avgPerDay: totalViews !== null && ageDays !== null ? totalViews / ageDays : null,
      trendDays: last30.days,
      trendRatio:
        last7.days >= 5 && prev.days >= 7 && prev.viewsPerDay !== null && last7.viewsPerDay !== null && prev.viewsPerDay > 0
          ? last7.viewsPerDay / prev.viewsPerDay
          : null,
      spark,
      protected: protectedSet.has(id),
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
    .filter((l) => l.score > 0 && !l.protected && !((hiddenUntil[String(l.listingId)] ?? "") >= today))
    .slice(0, 3)
    .map((l) => {
      const tagIssue = l.issues.find((i) => i.kind === "tags");
      const photoIssue = l.issues.find((i) => i.kind === "photos");
      const titleIssue = l.issues.find((i) => i.kind === "title");
      const statusText =
        l.status === "falling" ? "Views falling" : l.status === "seen_not_liked" ? "Seen, but few favorites" : l.status === "dead" ? "Almost no views in 30 days" : null;
      // Worst problems first, whatever the area: high before medium.
      const ranked = l.issues
        .filter((i) => !(tagsShopWide && i.kind === "tags"))
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
      const reason = [statusText, ...ranked.map((i) => i.text)].filter(Boolean).slice(0, 2).join(" · ");
      const top = ranked[0];
      const action: FixAction =
        l.status === "seen_not_liked" && photoIssue
          ? "photo"
          : top?.kind === "photos"
          ? "photo"
          : top || titleIssue || tagIssue || l.status === "dead" || l.status === "falling"
          ? "write"
          : "analytics";
      const steps = ranked.slice(0, 2).map(issueTodo);
      const stepText = steps.length ? `${steps.join(", then ")}.` : "check what changed.";
      const todo = [STATUS_SENTENCE[l.status], stepText.charAt(0).toUpperCase() + stepText.slice(1)].filter(Boolean).join(" ");
      const lead = action === "photo" ? photoIssue ?? top : top;
      const button = lead ? BUTTON[lead.kind] : "Open";
      return { listingId: l.listingId, title: l.title, mainImageUrl: l.mainImageUrl, reason, todo, button, action };
    });

  const changes = shopChanges(work, today);
  const measured = changes.filter((c) => c.verdict === "better" || c.verdict === "worse" || c.verdict === "no_change");

  // Day-1 numbers: Etsy's all-time counters on each listing's latest check.
  let totalViews = 0;
  let totalFavorites = 0;
  const top: ShopTopListing[] = [];
  const perDate = new Map<string, { sum: number; n: number; fav: number; favN: number; weight: number }>();
  let tracked = 0;
  for (const [id, w] of work) {
    if (!current.has(id)) continue;
    tracked += 1;
    const views = typeof w.latest.views === "number" && w.latest.views > 0 ? w.latest.views : 0;
    totalViews += views;
    totalFavorites += typeof w.latest.favorites === "number" ? w.latest.favorites : 0;
    top.push({ listingId: id, title: w.latest.title ?? `Listing ${id}`, mainImageUrl: w.latest.main_image_url, views, favorites: w.latest.favorites });
    for (const pt of w.series) {
      if (pt.date < last30From || pt.date > today || pt.viewsPerDay === null) continue;
      const d = perDate.get(pt.date) ?? { sum: 0, n: 0, fav: 0, favN: 0, weight: 0 };
      d.sum += pt.viewsPerDay;
      d.n += 1;
      d.weight += views;
      if (pt.favoritesPerDay !== null) {
        d.fav += pt.favoritesPerDay;
        d.favN += 1;
      }
      perDate.set(pt.date, d);
    }
  }
  top.sort((a, b) => b.views - a.views);
  // A day counts only when the listings that reported it carry 80%+ of the
  // shop's views (weighted by all-time views, not a head count): a missing
  // best-seller must not pass for a quiet day, and a missing dud must not
  // blank one. Shops with no view history fall back to the head count.
  const daily: ShopView["daily"] = [];
  for (let d = last30From; d <= today; d = addDays(d, 1)) {
    const x = perDate.get(d);
    const complete = x && tracked > 0 && (totalViews > 0 ? x.weight >= totalViews * 0.8 : x.n >= Math.max(1, Math.ceil(tracked * 0.8)));
    daily.push({ date: d, views: complete ? x.sum : null, favorites: complete && x.favN === x.n ? x.fav : null });
  }
  while (daily.length && daily[0].views === null) daily.shift();

  const thin = listings.filter((l) => 13 - l.tagsUsed >= 7);
  const shopWide: ShopWideIssue | null = tagsShopWide
    ? {
        kind: "tags",
        count: thin.length,
        none: thin.filter((l) => l.tagsUsed === 0).length,
        total: listings.length,
        start: thin.filter((l) => !l.protected && !((hiddenUntil[String(l.listingId)] ?? "") >= today))
          .sort((a, b) => (b.totalViews ?? 0) - (a.totalViews ?? 0))
          .slice(0, 5)
          .map((l) => ({ listingId: l.listingId, title: l.title, mainImageUrl: l.mainImageUrl })),
      }
    : null;

  return {
    historyDays,
    shopWide,
    totals: { views: totalViews, favorites: totalFavorites },
    daily,
    top: top.slice(0, 3),
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
    const base = { listingId: e.id, title: e.title, date: e.date, kinds: e.kinds, beforePerDay: before.viewsPerDay, afterPerDay: after.viewsPerDay, shopChange: null, lift: null, liftLow: null, liftHigh: null, wasFalling: wasFallingBefore(series, bFrom, before.viewsPerDay) };
    const ownChanges = changeDates.get(e.id) ?? [];
    if (ownChanges.some((d) => d > e.date && d <= aTo)) {
      results.push({ ...base, verdict: "interrupted" });
      continue;
    }
    if (ownChanges.some((d) => d >= bFrom && d < e.date)) {
      results.push({ ...base, verdict: "not_enough_data" });
      continue;
    }
    if (today < aTo || after.days < MIN_AFTER_DAYS) {
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
    // Comparison group: every other listing unchanged through both windows
    // that reported every matched day, summed per day.
    const controlByDate = new Map<string, number>();
    let controls = 0;
    for (const [id, w] of work) {
      if (id === e.id) continue;
      if ((changeDates.get(id) ?? []).some((d) => d >= bFrom && d <= aTo)) continue;
      const matched = w.series.filter((p) => matchedDates.has(p.date) && p.viewsPerDay !== null);
      if (matched.length !== matchedDates.size) continue;
      controls += 1;
      for (const pt of matched) controlByDate.set(pt.date, (controlByDate.get(pt.date) ?? 0) + (pt.viewsPerDay as number));
    }
    const days: RatioDay[] = series
      .filter((pt) => pt.viewsPerDay !== null && matchedDates.has(pt.date))
      .map((pt) => ({ phase: pt.date <= bTo ? "before" : "after", own: pt.viewsPerDay as number, control: controlByDate.get(pt.date) ?? 0 }));
    const test = controls >= 3 ? dailyRatioTest(days) : null;
    if (!test) {
      results.push({ ...base, verdict: "not_enough_data" });
      continue;
    }
    const cb = days.filter((d) => d.phase === "before").reduce((sum, d) => sum + d.control, 0) / test.before;
    const ca = days.filter((d) => d.phase === "after").reduce((sum, d) => sum + d.control, 0) / test.after;
    const call = ratioVerdict(test);
    results.push({ ...base, shopChange: cb > 0 ? ca / cb : null, lift: test.lift, liftLow: test.low, liftHigh: test.high, verdict: call === "no_clear_change" ? "no_change" : call });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
}
