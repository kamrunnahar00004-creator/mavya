/**
 * Listing Coach analytics (docs/NORTH_STAR_LISTING_COACH.md, sections 5-6).
 *
 * PURE functions over stored daily snapshots. No I/O, no clock reads (the
 * caller passes `today`), so every rule here is unit-tested. Nothing derived
 * is persisted: the Analytics page recomputes from snapshots on every load.
 *
 * Honesty rules baked in:
 *  - Etsy does not expose impressions, so there is no CTR anywhere here.
 *  - A before/after test is not an A/B test and never claims causation; it
 *    reports the listing's change relative to the same keyword's top
 *    listings over the same days (market control).
 *  - Too little data always yields "collecting"/"running", never a guess.
 */

export type ListingSnapshot = {
  control_revision?: string;
  snapshot_date: string; // YYYY-MM-DD (UTC)
  etsy_listing_id: number;
  state: string | null;
  views: number | null;
  favorites: number | null;
  title: string | null;
  tags: string[];
  description: string | null;
  main_image_id: number | null;
  main_image_url: string | null;
  image_count: number | null;
};

export type TopEntry = {
  id: number;
  position?: number;
  title: string;
  tags: string[];
  views: number | null;
  favorites: number | null;
  imageCount: number;
  mainImageId: number | null;
  mainImageUrl: string | null;
  url: string | null;
};

export type KeywordSnapshot = {
  revision?: string;
  snapshot_date: string;
  keyword: string;
  position: number | null;
  depth: number;
  top: TopEntry[];
};

export const PAGE_ONE_SIZE = 48;
export const TEST_WINDOW_DAYS = 14;
export const MIN_AFTER_DAYS = 7;
export const MIN_AFTER_VIEWS = 20;
export const MIN_SERIES_DAYS = 5;
/** A change is called Better/Worse only past these relative lifts, AND only
 *  when the whole likely range is past 1x (see dailyRatioTest). */
export const BETTER_LIFT = 1.15;
export const WORSE_LIFT = 0.87;
/** Minimum comparison-group views in EACH window before any comparison. */
export const MIN_CONTROL_VIEWS = 30;
export const ETSY_TAG_MAX = 20;
export const ETSY_TAG_SLOTS = 13;
/** Seller photo must out-score the top listings' median by this much before Mavya stops pointing at the photo. */
export const PHOTO_BETTER_MARGIN = 0.5;

// ---------------------------------------------------------------------------
// Dates (UTC day strings)
// ---------------------------------------------------------------------------

export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Daily series for the seller's listing
// ---------------------------------------------------------------------------

export type DailyPoint = {
  date: string;
  views: number | null;
  favorites: number | null;
  /** New views between consecutive daily snapshots. Null = unknown. */
  viewsPerDay: number | null;
  favoritesPerDay: number | null;
};

/**
 * Etsy's `views` is a lifetime counter tabulated once a day, and `0` can mean
 * "not tabulated yet", so a 0 (or a counter that went backwards) is treated as
 * missing, never as zero views. Gaps stay unknown, never interpolated.
 */
export function buildDailySeries(snapshots: ListingSnapshot[]): DailyPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const points: DailyPoint[] = [];
  let prev: ListingSnapshot | null = null;
  for (const s of sorted) {
    if (prev && prev.etsy_listing_id !== s.etsy_listing_id) prev = null;
    const lastDate = points.at(-1)?.date;
    if (lastDate) {
      for (let date = addDays(lastDate, 1); date < s.snapshot_date; date = addDays(date, 1)) {
        points.push({ date, views: null, favorites: null, viewsPerDay: null, favoritesPerDay: null });
      }
    }
    const validViews = typeof s.views === "number" && s.views > 0 ? s.views : null;
    let viewsPerDay: number | null = null;
    let favoritesPerDay: number | null = null;
    if (prev && validViews !== null && prev.etsy_listing_id === s.etsy_listing_id) {
      const days = dayNumber(s.snapshot_date) - dayNumber(prev.snapshot_date);
      if (days === 1 && typeof prev.views === "number" && validViews >= prev.views) {
        viewsPerDay = validViews - prev.views;
        if (typeof s.favorites === "number" && typeof prev.favorites === "number") {
          favoritesPerDay = s.favorites - prev.favorites;
        }
      }
    }
    points.push({
      date: s.snapshot_date,
      views: validViews,
      favorites: s.favorites,
      viewsPerDay,
      favoritesPerDay,
    });
    prev = validViews !== null ? s : null;
  }
  return points;
}

export type WindowStats = {
  days: number;
  views: number;
  favorites: number;
  viewsPerDay: number | null;
  favoritesPer100Views: number | null;
};

/** Sum known daily values for dates in [from, to] inclusive. */
export function windowStats(series: DailyPoint[], from: string, to: string): WindowStats {
  let days = 0;
  let views = 0;
  let favorites = 0;
  let favoriteDays = 0;
  for (const p of series) {
    if (p.date < from || p.date > to || p.viewsPerDay === null) continue;
    days += 1;
    views += p.viewsPerDay;
    if (p.favoritesPerDay !== null) {
      favorites += p.favoritesPerDay;
      favoriteDays += 1;
    }
  }
  return {
    days,
    views,
    favorites,
    viewsPerDay: days > 0 ? views / days : null,
    favoritesPer100Views: views >= 1 && favoriteDays === days ? (favorites / views) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Market (top listings for the tracked keywords)
// ---------------------------------------------------------------------------

export type MarketPoint = { date: string; winnerViewsPerDay: number | null };

/**
 * Median new views/day across the top listings, per date, measured the same
 * way as the seller's own listing (difference between our daily snapshots).
 * Averaged across tracked keywords.
 */
export function buildMarketSeries(
  kwSnaps: KeywordSnapshot[],
  topN = 10,
  /** When set, a date counts only if EVERY listed keyword has a value that
   *  day, so a missing keyword can never silently change the market mix. */
  requireKeywords?: string[]
): MarketPoint[] {
  const byKeyword = new Map<string, KeywordSnapshot[]>();
  for (const k of kwSnaps) {
    const list = byKeyword.get(k.keyword) ?? [];
    list.push(k);
    byKeyword.set(k.keyword, list);
  }
  const perDate = new Map<string, number[]>();
  const keywordsByDate = new Map<string, Set<string>>();
  for (const [keyword, list] of byKeyword) {
    list.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const days = dayNumber(cur.snapshot_date) - dayNumber(prev.snapshot_date);
      if (days !== 1) continue;
      const prevViews = new Map(prev.top.map((t) => [t.id, t.views]));
      const deltas: number[] = [];
      for (const t of cur.top.slice(0, topN)) {
        const before = prevViews.get(t.id);
        if (typeof before === "number" && before > 0 && typeof t.views === "number" && t.views >= before) {
          deltas.push((t.views - before) / days);
        }
      }
      const m = deltas.length >= 3 ? median(deltas) : null;
      if (m === null) continue;
      const arr = perDate.get(cur.snapshot_date) ?? [];
      arr.push(m);
      perDate.set(cur.snapshot_date, arr);
      const seen = keywordsByDate.get(cur.snapshot_date) ?? new Set<string>();
      seen.add(keyword);
      keywordsByDate.set(cur.snapshot_date, seen);
    }
  }
  return [...perDate.entries()]
    .filter(([date]) => !requireKeywords || requireKeywords.every((k) => keywordsByDate.get(date)?.has(k)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, winnerViewsPerDay: vals.reduce((s, v) => s + v, 0) / vals.length }));
}

export function marketWindowAvg(market: MarketPoint[], from: string, to: string): number | null {
  const vals = market
    .filter((m) => m.date >= from && m.date <= to && m.winnerViewsPerDay !== null)
    .map((m) => m.winnerViewsPerDay as number);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/** Latest keyword snapshot per keyword. */
export function latestByKeyword(kwSnaps: KeywordSnapshot[]): KeywordSnapshot[] {
  const latest = new Map<string, KeywordSnapshot>();
  for (const k of kwSnaps) {
    const cur = latest.get(k.keyword);
    if (!cur || k.snapshot_date > cur.snapshot_date) latest.set(k.keyword, k);
  }
  return [...latest.values()].sort((a, b) => a.keyword.localeCompare(b.keyword));
}

/** Median lifetime favorites per 100 views across the latest top listings. */
export function winnerFavoriteRate(latest: KeywordSnapshot[], topN = 10): number | null {
  const rates: number[] = [];
  const seen = new Set<number>();
  for (const k of latest) {
    for (const t of k.top.slice(0, topN)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (typeof t.views === "number" && t.views >= 100 && typeof t.favorites === "number") {
        rates.push((t.favorites / t.views) * 100);
      }
    }
  }
  return median(rates);
}

/** Recent NET favorites per view, on the same observed dates as the seller. */
export function recentWinnerFavoriteRate(snapshots: KeywordSnapshot[], series: DailyPoint[], from: string, to: string): number | null {
  const observations = new Map<string, TopEntry>();
  for (const k of snapshots) for (const t of k.top) observations.set(`${k.snapshot_date}:${t.id}`, t);
  const totals = new Map<number, { views: number; favorites: number; days: number }>();
  for (const p of series) {
    if (p.date < from || p.date > to || p.viewsPerDay === null || p.favoritesPerDay === null) continue;
    const entries = new Map(snapshots.filter((k) => k.snapshot_date === p.date).flatMap((k) => k.top.map((t) => [t.id, t] as const)));
    for (const t of entries.values()) {
      const prev = observations.get(`${addDays(p.date, -1)}:${t.id}`);
      if (!prev || prev.views === null || prev.views <= 0 || t.views === null || t.views < prev.views || prev.favorites === null || t.favorites === null) continue;
      const total = totals.get(t.id) ?? { views: 0, favorites: 0, days: 0 };
      total.views += t.views - prev.views;
      total.favorites += t.favorites - prev.favorites;
      total.days += 1;
      totals.set(t.id, total);
    }
  }
  const rates = [...totals.values()].filter((t) => t.days >= MIN_SERIES_DAYS && t.views >= 30).map((t) => 100 * t.favorites / t.views);
  return rates.length >= 3 ? median(rates) : null;
}

// ---------------------------------------------------------------------------
// Change detection + before/after tests
// ---------------------------------------------------------------------------

export type RatioDay = { phase: "before" | "after"; own: number; control: number };
export type RatioTest = { lift: number; low: number; high: number; before: number; after: number };

/**
 * Did the listing move relative to its comparison group, beyond normal daily
 * wobble? (Codex follow-up review, finding 2.)
 *
 * For each observed day: log((own + 0.5) / (control + 0.5)). The lift is the
 * change in the mean of that daily log-ratio from before to after. Its
 * uncertainty comes from how much the daily ratio ACTUALLY varies in each
 * window (a Welch-style standard error), so a thin or noisy comparison group,
 * a noisy listing, and day-to-day swings all widen the range automatically;
 * nothing assumes clean counting noise. The range uses 2.5 standard errors,
 * wider than 95% on purpose (validated: under 5% wrong Better/Worse calls in
 * no-effect simulations, tests/proof-validation-simulation.test.ts), and is
 * judged once, at the end of a fixed 14-day window (no repeated early looks).
 *
 * Null when either window has too few days or the comparison group has too
 * few views to say anything.
 */
export function dailyRatioTest(days: RatioDay[], minBefore = 3, minAfter = MIN_AFTER_DAYS): RatioTest | null {
  const logs = (phase: RatioDay["phase"]) => days.filter((d) => d.phase === phase).map((d) => Math.log((d.own + 0.5) / (d.control + 0.5)));
  const b = logs("before");
  const a = logs("after");
  if (b.length < minBefore || a.length < minAfter) return null;
  const controlBefore = days.filter((d) => d.phase === "before").reduce((sum, d) => sum + d.control, 0);
  const controlAfter = days.filter((d) => d.phase === "after").reduce((sum, d) => sum + d.control, 0);
  if (controlBefore < MIN_CONTROL_VIEWS || controlAfter < MIN_CONTROL_VIEWS) return null;
  const mean = (x: number[]) => x.reduce((sum, v) => sum + v, 0) / x.length;
  const variance = (x: number[]) => {
    const m = mean(x);
    return x.length > 1 ? x.reduce((sum, v) => sum + (v - m) ** 2, 0) / (x.length - 1) : 0;
  };
  // Floor the per-day spread at counting noise (about 1/views for each side
  // of the ratio) and at 0.01 (+-10% a day), so a suspiciously smooth window,
  // or a tiny listing whose few views happen to look steady, can never
  // produce a razor-thin range.
  const countingNoise = (phase: RatioDay["phase"]) => {
    const ds = days.filter((d) => d.phase === phase);
    return ds.reduce((sum, d) => sum + 1 / (d.own + 0.5) + 1 / (d.control + 0.5), 0) / ds.length;
  };
  const vb = Math.max(variance(b), countingNoise("before"), 0.01);
  const va = Math.max(variance(a), countingNoise("after"), 0.01);
  const diff = mean(a) - mean(b);
  const se = Math.sqrt(vb / b.length + va / a.length);
  return { lift: Math.exp(diff), low: Math.exp(diff - 2.5 * se), high: Math.exp(diff + 2.5 * se), before: b.length, after: a.length };
}

/** Better / Worse only when the whole range is past 1x and the lift is meaningful. */
export function ratioVerdict(t: RatioTest): "better" | "worse" | "no_clear_change" {
  if (t.low > 1 && t.lift >= BETTER_LIFT) return "better";
  if (t.high < 1 && t.lift <= WORSE_LIFT) return "worse";
  return "no_clear_change";
}

/**
 * Was the listing already sliding before the change? Before-window views/day at
 * or under 60% of the 4 weeks before it. A listing picked for a fix because it
 * had a bad stretch often recovers on its own, so a later "better" partly
 * reflects that bounce; the UI says so instead of claiming the full rise.
 */
export function wasFallingBefore(series: DailyPoint[], beforeFrom: string, beforeViewsPerDay: number | null): boolean {
  if (beforeViewsPerDay === null) return false;
  const prior = windowStats(series, addDays(beforeFrom, -28), addDays(beforeFrom, -1));
  return prior.days >= 7 && (prior.viewsPerDay ?? 0) >= 1 && beforeViewsPerDay <= (prior.viewsPerDay as number) * 0.6;
}

export type ChangeKind = "main_photo" | "title" | "tags" | "description";

export type ChangeEvent = {
  controlRevision?: string;
  controlEndDate?: string;
  /** First snapshot date showing the new version (change happened since the previous one). */
  date: string;
  kinds: ChangeKind[];
  before: { title: string | null; tags: string[]; mainImageUrl: string | null };
  after: { title: string | null; tags: string[]; mainImageUrl: string | null };
};

const tagKey = (tags: string[]) =>
  [...tags].map((t) => t.trim().toLowerCase()).sort().join("|");

export function detectChanges(snapshots: ListingSnapshot[]): ChangeEvent[] {
  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const events: ChangeEvent[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.etsy_listing_id !== cur.etsy_listing_id) continue;
    const kinds: ChangeKind[] = [];
    if (prev.main_image_id && cur.main_image_id && prev.main_image_id !== cur.main_image_id) {
      kinds.push("main_photo");
    }
    if (prev.title !== null && cur.title !== null && prev.title.trim() !== cur.title.trim()) {
      kinds.push("title");
    }
    if (tagKey(prev.tags) !== tagKey(cur.tags)) kinds.push("tags");
    if (
      prev.description !== null &&
      cur.description !== null &&
      prev.description.trim() !== cur.description.trim()
    ) {
      kinds.push("description");
    }
    if (kinds.length === 0) continue;
    events.push({
      controlRevision: cur.control_revision,
      controlEndDate: cur.control_revision ? sorted.slice(i + 1).find((s) => s.control_revision && s.control_revision !== cur.control_revision)?.snapshot_date : undefined,
      date: cur.snapshot_date,
      kinds,
      before: { title: prev.title, tags: prev.tags, mainImageUrl: prev.main_image_url },
      after: { title: cur.title, tags: cur.tags, mainImageUrl: cur.main_image_url },
    });
  }
  return events;
}

export type TestVerdict = "running" | "better" | "worse" | "no_clear_change" | "interrupted" | "no_baseline" | "insufficient_data";

export type TestResult = {
  interruptionReason?: "keywords_changed";
  event: ChangeEvent;
  verdict: TestVerdict;
  daysAfter: number;
  before: WindowStats;
  after: WindowStats;
  /** Listing views/day after ÷ before. */
  listingChange: number | null;
  /** Top listings views/day after ÷ before over the same dates. Null = no control data. */
  marketChange: number | null;
  /** listingChange divided by marketChange; null without a usable control. */
  lift: number | null;
  /** Likely range of the lift from the daily-ratio test; null until judged. */
  liftLow: number | null;
  liftHigh: number | null;
  /** Search position before vs after, per keyword present on both sides. */
  rank: { keyword: string; before: number | null; after: number | null }[];
  /** The listing was already falling before the change (see wasFallingBefore). */
  wasFalling: boolean;
};

/**
 * Before window: up to 14 days before the change. After window: up to 14 days
 * after, cut short by the next change. The change day itself is excluded from
 * both (its daily number mixes old and new versions).
 */
export function evaluateTest(
  event: ChangeEvent,
  nextEventDate: string | null,
  series: DailyPoint[],
  market: MarketPoint[],
  today: string,
  previousEventDate: string | null = null,
  /** How many top listings stand behind each day's market median. */
  controlSize = 3
): TestResult {
  const beforeFrom = previousEventDate && addDays(previousEventDate, 1) > addDays(event.date, -TEST_WINDOW_DAYS)
    ? addDays(previousEventDate, 1) : addDays(event.date, -TEST_WINDOW_DAYS);
  const beforeTo = addDays(event.date, -1);
  const afterFrom = addDays(event.date, 1);
  let afterTo = addDays(event.date, TEST_WINDOW_DAYS);
  if (nextEventDate && addDays(nextEventDate, -1) < afterTo) afterTo = addDays(nextEventDate, -1);
  if (today < afterTo) afterTo = today;

  // Compare the listing and market on the SAME observed days. A missing
  // control is not evidence of a flat market.
  const matched = series.filter((p) => market.some((m) => m.date === p.date && m.winnerViewsPerDay !== null));
  const before = windowStats(matched, beforeFrom, beforeTo);
  const after = windowStats(matched, afterFrom, afterTo);
  const daysAfter = Math.max(0, dayNumber(afterTo) - dayNumber(event.date));

  const wasFalling = wasFallingBefore(series, beforeFrom, windowStats(series, beforeFrom, beforeTo).viewsPerDay);
  const base = { event, daysAfter, before, after, listingChange: null, marketChange: null, lift: null, liftLow: null, liftHigh: null, rank: [] as TestResult["rank"], wasFalling };

  const interrupted = nextEventDate !== null && nextEventDate <= today && nextEventDate <= addDays(event.date, TEST_WINDOW_DAYS);
  const ended = today >= addDays(event.date, TEST_WINDOW_DAYS);
  if (windowStats(series, beforeFrom, beforeTo).days < 3) {
    return { ...base, verdict: "no_baseline" };
  }
  // The before window is entirely in the past, so a missing market baseline
  // can never be filled in later. Close the test now instead of keeping the
  // seller in "wait, a test is running" for 14 days that cannot produce a result.
  if (before.days < 3) {
    return { ...base, verdict: "no_baseline" };
  }
  if (after.days < MIN_AFTER_DAYS || after.views < MIN_AFTER_VIEWS) {
    return { ...base, verdict: interrupted ? "interrupted" : ended ? "insufficient_data" : "running" };
  }

  const listingChange =
    before.viewsPerDay !== null && before.viewsPerDay > 0 ? (after.viewsPerDay ?? 0) / before.viewsPerDay : null;
  const matchedMarket = market.filter((m) => matched.some((p) => p.date === m.date && p.viewsPerDay !== null));
  const mBefore = marketWindowAvg(matchedMarket, beforeFrom, beforeTo);
  const mAfter = marketWindowAvg(matchedMarket, afterFrom, afterTo);
  const marketChange = mBefore !== null && mAfter !== null && mBefore > 0 ? mAfter / mBefore : null;
  const lift = listingChange !== null && marketChange !== null && marketChange > 0 ? listingChange / marketChange : null;

  if (lift === null) return { ...base, verdict: "insufficient_data", listingChange, marketChange, lift };
  // Judged once, at the end of the fixed window, from the daily ratio against
  // the comparison group (median views of the top listings x how many there are).
  if (!ended) return { ...base, verdict: interrupted ? "interrupted" : "running", listingChange, marketChange, lift };
  const marketByDate = new Map(matchedMarket.map((m) => [m.date, m.winnerViewsPerDay as number]));
  const days: RatioDay[] = matched
    .filter((p) => p.viewsPerDay !== null && marketByDate.has(p.date) && ((p.date >= beforeFrom && p.date <= beforeTo) || (p.date >= afterFrom && p.date <= afterTo)))
    .map((p) => ({ phase: p.date <= beforeTo ? "before" : "after", own: p.viewsPerDay as number, control: (marketByDate.get(p.date) as number) * controlSize }));
  const test = dailyRatioTest(days);
  if (!test) return { ...base, verdict: "insufficient_data", listingChange, marketChange, lift };
  return { ...base, verdict: interrupted ? "interrupted" : ratioVerdict(test), listingChange, marketChange, lift: test.lift, liftLow: test.low, liftHigh: test.high };
}

export function evaluateAllTests(
  events: ChangeEvent[],
  series: DailyPoint[],
  market: MarketPoint[],
  today: string,
  keywordSnapshots?: KeywordSnapshot[],
  currentControlRevision?: string
): TestResult[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return sorted
    .map((e, i) => {
      const controlClosed = Boolean(e.controlRevision && currentControlRevision && e.controlRevision !== currentControlRevision);
      // A same-day settings edit must retain the old configuration's already
      // recorded observation, including a result that just reached seven days.
      const controlEnd = e.controlEndDate ?? (controlClosed ? addDays(today, 1) : null);
      const nextListingChange = sorted[i + 1]?.date ?? null;
      const nextChange = [nextListingChange, controlEnd].filter((d): d is string => Boolean(d)).sort()[0] ?? null;
      let control = market;
      let controlSize = 3;
      if (keywordSnapshots) {
        const from = addDays(e.date, -TEST_WINDOW_DAYS - 1);
        const to = [today, addDays(e.date, TEST_WINDOW_DAYS), nextChange ? addDays(nextChange, -1) : today].sort()[0];
        const snaps = keywordSnapshots.filter((k) =>
          (!e.controlRevision || k.revision === e.controlRevision) &&
          k.snapshot_date >= from && k.snapshot_date <= to);
        // Keep a fixed comparison cohort through each test, so changes in
        // who ranks in the top ten cannot masquerade as a market trend.
        const idsByKeyword = new Map<string, Set<number>>();
        for (const k of snaps) {
          const ids = new Set(k.top.map((t) => t.id));
          const prior = idsByKeyword.get(k.keyword);
          idsByKeyword.set(k.keyword, prior ? new Set([...prior].filter((id) => ids.has(id))) : ids);
        }
        // Only keywords whose fixed cohort can yield a median (>= 3 listings)
        // take part, and every one of them must be present on a counted day.
        const usable = [...idsByKeyword].filter(([, ids]) => ids.size >= 3).map(([k]) => k);
        // Smallest fixed cohort behind the averaged medians (conservative).
        controlSize = Math.max(3, Math.min(10, ...[...idsByKeyword].filter(([k]) => usable.includes(k)).map(([, ids]) => ids.size)));
        control = buildMarketSeries(
          snaps.filter((k) => usable.includes(k.keyword)).map((k) => ({ ...k, top: k.top.filter((t) => idsByKeyword.get(k.keyword)?.has(t.id)) })),
          10,
          usable
        );
      }
      const evaluated = evaluateTest(e, nextChange, series, control, today, sorted[i - 1]?.date ?? null, controlSize);
      // Search position moves within days of a title or tag edit and needs no
      // traffic, so it is the fastest honest signal for those changes.
      let rank: TestResult["rank"] = [];
      if (keywordSnapshots) {
        const sameConfig = keywordSnapshots.filter((k) => !e.controlRevision || k.revision === e.controlRevision);
        const endAt = [today, addDays(e.date, TEST_WINDOW_DAYS), nextChange ? addDays(nextChange, -1) : today].sort()[0];
        const pre = latestByKeyword(sameConfig.filter((k) => k.snapshot_date < e.date && k.snapshot_date >= addDays(e.date, -7)));
        const post = new Map(latestByKeyword(sameConfig.filter((k) => k.snapshot_date > e.date && k.snapshot_date <= endAt)).map((k) => [k.keyword, k]));
        rank = pre.filter((k) => post.has(k.keyword)).slice(0, 3).map((k) => ({ keyword: k.keyword, before: k.position, after: post.get(k.keyword)!.position }));
      }
      const result = { ...evaluated, rank };
      // A different keyword configuration must never replace an old test's
      // control or keep it waiting for observations we no longer collect.
      if (result.verdict === "running" && controlClosed) {
        return { ...result, verdict: "interrupted" as const, interruptionReason: "keywords_changed" as const };
      }
      if (result.verdict === "interrupted" && controlEnd && (!nextListingChange || controlEnd <= nextListingChange)) {
        return { ...result, interruptionReason: "keywords_changed" as const };
      }
      return result;
    })
    .reverse();
}

// ---------------------------------------------------------------------------
// Title / tags / photo-count checks (available from day 1)
// ---------------------------------------------------------------------------

export type CheckIssue = {
  id: string;
  area: "tags" | "title" | "photos" | "description";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** Concrete words the seller could use; only ever taken from real winner listings. */
  suggestions?: string[];
};

export function winnerTagFrequency(latest: KeywordSnapshot[], topN = 10): { tag: string; share: number; count: number; total: number }[] {
  const counts = new Map<string, number>();
  const seen = new Set<number>();
  for (const k of latest) {
    for (const t of k.top.slice(0, topN)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      for (const tag of new Set(t.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  const total = seen.size;
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count, total, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function listingChecks(args: {
  latest: ListingSnapshot | null;
  keywords: string[];
  latestKeywords: KeywordSnapshot[];
}): CheckIssue[] {
  const { latest, keywords, latestKeywords } = args;
  if (!latest) return [];
  const issues: CheckIssue[] = [];
  const tags = latest.tags ?? [];
  const title = (latest.title ?? "").trim();
  const titleLower = title.toLowerCase();

  const empty = ETSY_TAG_SLOTS - tags.length;
  if (empty > 0) {
    issues.push({
      id: "empty_tag_slots",
      area: "tags",
      severity: empty >= 4 ? "high" : "medium",
      title: `${empty} of ${ETSY_TAG_SLOTS} tag slots are empty`,
      detail: "Each tag is one more search you can show up in.",
    });
  }

  const maybeCut = tags.filter((t) => t.length >= ETSY_TAG_MAX);
  if (maybeCut.length > 0) {
    issues.push({
      id: "tags_may_be_cut",
      area: "tags",
      severity: "low",
      title: `${maybeCut.length} tag${maybeCut.length > 1 ? "s" : ""} at the character limit`,
      detail: "Check that no word got cut short.",
      suggestions: maybeCut,
    });
  }

  const own = new Set(tags.map((t) => t.trim().toLowerCase()));
  const freq = winnerTagFrequency(latestKeywords);
  const missing = freq
    .filter((f) => f.total >= 3 && f.count >= 3 && f.share >= 0.3 && !own.has(f.tag))
    .slice(0, 6)
    .map((f) => f.tag);
  if (missing.length > 0) {
    issues.push({
      id: "missing_winner_tags",
      area: "tags",
      severity: missing.length >= 3 ? "high" : "medium",
      title: "Top listings use tags you do not",
      detail: "Add only the ones that fit your product.",
      suggestions: missing,
    });
  }

  // Etsy matches search words across the title AND tags together. The
  // primary (first) keyword belongs in the title; the others only need to be
  // covered by the title or an exact tag.
  keywords.forEach((kw, i) => {
    const k = kw.toLowerCase();
    const words = k.match(/[\p{L}\p{N}]+/gu) ?? [];
    const titleWords = new Set(titleLower.match(/[\p{L}\p{N}]+/gu) ?? []);
    const listingWords = new Set([titleLower, ...own].join(" ").match(/[\p{L}\p{N}]+/gu) ?? []);
    const inTitle = words.length > 0 && words.every((w) => titleWords.has(w));
    if (i === 0 && !inTitle) {
      issues.push({
        id: `title_missing_${kw}`,
        area: "title",
        severity: "high",
        title: `Your title does not contain "${kw}"`,
        detail: "Put these words near the start of your title, if they fit.",
      });
    } else if (i === 0 && titleLower.indexOf(k) > 40) {
      issues.push({
        id: `title_late_${kw}`,
        area: "title",
        severity: "low",
        title: `"${kw}" appears late in your title`,
        detail: "Lead with what the product is.",
      });
    } else if (i > 0 && !words.every((w) => listingWords.has(w))) {
      issues.push({
        id: `keyword_uncovered_${kw}`,
        area: "tags",
        severity: "medium",
        title: `"${kw}" is not in your title or tags`,
        detail: "Add it as a tag if it fits your product.",
      });
    }
  });

  if (title.length > 140) {
    issues.push({
      id: "title_long",
      area: "title",
      severity: "medium",
      title: "Your title exceeds 140 characters",
      detail: "Keep the product name and key details.",
    });
  }

  const winnerPhotoCounts = latestKeywords.flatMap((k) => k.top.slice(0, 10).map((t) => t.imageCount)).filter((n) => n > 0);
  const winnerPhotos = median(winnerPhotoCounts);
  const ownPhotos = latest.image_count;
  if (winnerPhotos !== null && ownPhotos !== null && ownPhotos < winnerPhotos - 1) {
    issues.push({
      id: "fewer_photos",
      area: "photos",
      severity: ownPhotos <= 4 ? "high" : "medium",
      title: `Top listings show ${Math.round(winnerPhotos)} photos, you show ${ownPhotos}`,
      detail: "Show size, details, and what is included.",
    });
  }

  const desc = (latest.description ?? "").trim();
  if (desc.length > 0 && desc.length < 250) {
    issues.push({
      id: "description_short",
      area: "description",
      severity: "low",
      title: "Your description is short",
      detail: "Add size, materials, care, and what is in the box.",
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------------------
// Diagnosis: the one "next best fix"
// ---------------------------------------------------------------------------

export type DiagnosisState =
  | "not_linked"
  | "collecting"
  | "testing"
  | "findability"
  | "click"
  | "trust"
  | "improve"
  | "healthy";

export type FixTarget = "title_tags" | "main_photo" | "supporting_photos" | null;

export type Diagnosis = {
  state: DiagnosisState;
  fixTarget: FixTarget;
  headline: string;
  detail: string;
  evidence: string[];
};

export type DiagnosisInput = {
  linked: boolean;
  series: DailyPoint[];
  market: MarketPoint[];
  latestKeywords: KeywordSnapshot[];
  tests: TestResult[];
  today: string;
  /** Mavya raw score of the seller's main photo, if rated. */
  ownPhotoScore: number | null;
  /** Median Mavya raw score of top listings' main photos, if scored. */
  winnerPhotoScore: number | null;
  /** High-severity title/tag/photo-count issues from listingChecks(). */
  highSeverityChecks?: number;
  checks?: CheckIssue[];
  enabled?: boolean;
  lastCheckedOn?: string | null;
  winnerRecentFavoriteRate?: number | null;
  /** The listing's all-time Etsy views (latest check). */
  totalViews?: number | null;
};

const fmt = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));

export function diagnose(input: DiagnosisInput): Diagnosis {
  const { linked, series, market, latestKeywords, tests, today } = input;
  if (!linked) {
    return {
      state: "not_linked",
      fixTarget: null,
      headline: "Link your Etsy listing to start",
      detail: "Mavya checks it daily and tells you what to fix.",
      evidence: [],
    };
  }

  const evidence: string[] = [];
  if (input.enabled === false) {
    return { state: "collecting", fixTarget: null, headline: "Monitoring is paused", detail: "Turn on the daily check to keep tracking.", evidence };
  }
  if (input.lastCheckedOn !== undefined && (!input.lastCheckedOn || input.lastCheckedOn < addDays(today, -1))) {
    return { state: "collecting", fixTarget: null, headline: "Waiting for today's Etsy check", detail: "Numbers below may be a day old.", evidence };
  }
  const positions = latestKeywords.map((k) => k.position);
  const best = positions.filter((p): p is number => p !== null).sort((a, b) => a - b)[0] ?? null;
  for (const k of latestKeywords) {
    evidence.push(
      k.position === null
        ? `Not in the top ${k.depth} for "${k.keyword}"`
        : `#${k.position} for "${k.keyword}"`
    );
  }

  const running = tests.find((t) => t.verdict === "running");
  if (running) {
    return {
      state: "testing",
      fixTarget: null,
      headline: "Give your change time to work",
      detail: `You changed ${describeKinds(running.event.kinds)}. Leave the listing as is for 14 days so Mavya can compare the observations.`,
      evidence,
    };
  }

  // Findability does not need a view history: the search position is known day 1.
  if (latestKeywords.length > 0 && (best === null || best > PAGE_ONE_SIZE)) {
    // Selected search positions cannot establish a listing's traffic sources.
    const recent = windowStats(series, addDays(today, -6), today);
    const busy = (recent.days >= 3 && (recent.viewsPerDay ?? 0) >= 3) || (input.totalViews ?? 0) >= 1000;
    if (busy) {
      return {
        state: "improve",
        fixTarget: "title_tags",
        headline: "Your listing has views, but not a top position for these searches",
        detail: "We did not find it in the top 48 for your tracked keywords. We cannot tell where those views came from.",
        evidence,
      };
    }
    return {
      state: "findability",
      fixTarget: "title_tags",
      headline: "Buyers may not be finding this listing",
      detail: "It does not show near the top of search for your keywords. Start with the title and tags.",
      evidence,
    };
  }

  const last7From = addDays(today, -6);
  const own = windowStats(series, last7From, today);
  const knownDays = own.days;
  // Metric-based diagnoses (views/favorites vs the top listings) outrank the
  // static title/tag checks when enough data exists: a minor tag gap must not
  // hide a large view or favorite gap. Checks still lead while data is thin.
  const actionable = input.checks?.find((c) => c.severity !== "low");
  const actionableResult = (): Diagnosis | null =>
    actionable
      ? { state: "improve", fixTarget: actionable.area === "photos" ? "supporting_photos" : "title_tags", headline: actionable.title, detail: actionable.detail, evidence }
      : null;
  if (knownDays < MIN_SERIES_DAYS || own.viewsPerDay === null) {
    return actionableResult() ?? {
      state: "collecting",
      fixTarget: null,
      headline: "Collecting your first numbers",
      detail: `About ${Math.max(1, MIN_SERIES_DAYS - knownDays)} more day${Math.max(1, MIN_SERIES_DAYS - knownDays) === 1 ? "" : "s"} until Mavya can compare your views.`,
      evidence,
    };
  }

  const comparableMarket = market.filter((m) => series.some((p) => p.date === m.date && p.viewsPerDay !== null));
  const marketVpd = comparableMarket.filter((m) => m.date >= last7From && m.date <= today && m.winnerViewsPerDay !== null).length >= MIN_SERIES_DAYS
    ? marketWindowAvg(comparableMarket, last7From, today) : null;
  evidence.push(`${fmt(own.viewsPerDay)} views/day over the last ${own.days} days`);
  if (marketVpd !== null) evidence.push(`Top listings: ${fmt(marketVpd)} views/day`);
  const photoGap =
    input.ownPhotoScore !== null && input.winnerPhotoScore !== null
      ? input.winnerPhotoScore - input.ownPhotoScore
      : null;
  if (input.ownPhotoScore !== null && input.winnerPhotoScore !== null) {
    evidence.push(
      `Main photo score: yours ${input.ownPhotoScore.toFixed(1)}, top listings ${input.winnerPhotoScore.toFixed(1)}`
    );
  }

  if (best !== null && best <= PAGE_ONE_SIZE && marketVpd !== null && own.viewsPerDay < marketVpd * 0.25) {
    // The seller's photo already out-scores the top listings' photos: the
    // photo is not the likely gap, so do not send them back to it.
    if (photoGap !== null && photoGap <= -PHOTO_BETTER_MARGIN) {
      return {
        state: "improve",
        fixTarget: "title_tags",
        headline: "Fewer views, but your photo already scores higher",
        detail: "Compare your price, reviews, and title with the top listings.",
        evidence,
      };
    }
    return {
      state: "click",
      fixTarget: "main_photo",
      headline: "Try a stronger main photo",
      detail:
        photoGap !== null && photoGap >= 1
          ? "You show up in search but get far fewer views, and top listings have stronger main photos."
          : "You show up in search but get far fewer views than the top listings.",
      evidence,
    };
  }

  // Lifetime competitor favorites are not comparable to this week's net
  // favorites. Do not diagnose trust from that mismatched denominator.
  const winnerFav = input.winnerRecentFavoriteRate ?? null;
  if (own.views >= 30 && own.favoritesPer100Views !== null) {
    evidence.push(`${own.favoritesPer100Views.toFixed(1)} favorites per 100 views`);
    if (winnerFav !== null) evidence.push(`Top listings: ${winnerFav.toFixed(1)} favorites per 100 views`);
    if (winnerFav !== null && own.favoritesPer100Views < winnerFav * 0.5) {
      return {
        state: "trust",
        fixTarget: "supporting_photos",
        headline: "Add photos that answer buyer questions",
        detail: "Visitors favorite this listing less than the top listings. Show size, details, and what is included.",
        evidence,
      };
    }
  }

  // No emergency, but the coach still names the next improvement (the loop
  // never stalls on "healthy" while a clear, concrete gap exists).
  if (marketVpd !== null && own.viewsPerDay < marketVpd * 0.6 && photoGap !== null && photoGap >= 1) {
    return {
      state: "improve",
      fixTarget: "main_photo",
      headline: "Improve your main photo",
      detail: "Top listings get more views and their main photos score higher.",
      evidence,
    };
  }
  const fromChecks = actionableResult();
  if (fromChecks) return fromChecks;
  if ((input.highSeverityChecks ?? 0) > 0) {
    return {
      state: "improve",
      fixTarget: "title_tags",
      headline: "Fix your title and tags",
      detail: "Your numbers are steady. A few title and tag gaps can still cost searches.",
      evidence,
    };
  }

  if (!latestKeywords.length || marketVpd === null) {
    return { state: "collecting", fixTarget: null, headline: "Waiting for top-listing data", detail: "Add keywords so Mavya can compare you with the top listings.", evidence };
  }
  return {
    state: "healthy",
    fixTarget: null,
    headline: "Looking good",
    detail: "No clear issue right now. Mavya keeps checking daily.",
    evidence,
  };
}

export function describeKinds(kinds: ChangeKind[]): string {
  const names: Record<ChangeKind, string> = {
    main_photo: "the main photo",
    title: "the title",
    tags: "the tags",
    description: "the description",
  };
  const parts = kinds.map((k) => names[k]);
  if (parts.length <= 1) return parts[0] ?? "the listing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Words and phrases that describe a listing's STATUS or logistics, not the
 * product. Sellers often lead titles with them ("PRE-ORDER | ...", "READY TO
 * SHIP | ..."); searching them returns unrelated listings (yarn, stockings),
 * which poisons ranking, comparisons, tests, and the rewrite. Stripped before
 * any phrase becomes a tracked keyword.
 */
const STATUS_PHRASES =
  /\b(pre[\s-]?orders?|ready[\s-]+to[\s-]+ship|rts|on[\s-]+sale|sale|free[\s-]+shipping|restock(ed)?|back[\s-]+in[\s-]+stock|in[\s-]+stock|made[\s-]+to[\s-]+order|limited(\s+edition)?|new|some|instant[\s-]+download|digital[\s-]+download|listing|sold[\s-]+out)\b/gi;

/** Generic words that say nothing about WHAT the product is. */
const GENERIC = new Set([
  "a", "an", "and", "the", "for", "of", "with", "to", "in", "on", "by", "or", "your", "my", "her", "him", "mom", "dad",
  "gift", "gifts", "handmade", "custom", "personalized", "unique", "cute", "best", "item", "set", "pack", "lot",
  "pre", "order", "preorder", "ready", "ship", "shipping", "sale", "new", "some", "stock", "free", "limited", "edition",
]);

const kwWords = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Remove status/logistics phrases from a title segment or tag. */
export function stripStatus(raw: string): string {
  return raw
    .replace(STATUS_PHRASES, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-']+|[-']+$/g, "")
    .trim();
}

/** Words that actually describe this listing (not status, not generic). */
export function distinctiveWords(title: string, tags: string[]): Set<string> {
  return new Set([title, ...tags].flatMap((t) => kwWords(stripStatus(t))).filter((w) => w.length > 2 && !GENERIC.has(w)));
}

/**
 * Suggest up to 3 search keywords from a listing: title segments (Etsy titles
 * are usually comma/pipe/dash separated) and multi-word tags, with status
 * words removed. Multi-word phrases first; a single word only as a last resort.
 */
export function suggestKeywords(title: string, tags: string[]): string[] {
  const out: string[] = [];
  const singles: string[] = [];
  const push = (raw: string) => {
    const parts = stripStatus(raw).split(" ").slice(0, 4);
    // Never end on a dangling joiner ("soy candle gift for").
    while (parts.length && /^(a|an|and|the|for|of|with|to|in|on|by|or)$/.test(parts[parts.length - 1])) parts.pop();
    const k = parts.join(" ");
    if (k.length < 3 || k.length > 60) return;
    const words = kwWords(k);
    if (!words.some((w) => w.length > 2 && !GENERIC.has(w))) return;
    if (words.length < 2) {
      if (!singles.includes(k)) singles.push(k);
      return;
    }
    if (!out.includes(k)) out.push(k);
  };
  // Order: the first real product phrase in the title, then the seller's
  // own multi-word tags, then the remaining title phrases.
  const segments = title.split(/[,|–—()/]| - /);
  let firstIdx = -1;
  for (let i = 0; i < segments.length && firstIdx < 0; i++) {
    const before = out.length;
    push(segments[i]);
    if (out.length > before) firstIdx = i;
  }
  for (const t of tags) {
    if (out.length >= 3) break;
    push(t);
  }
  for (let i = firstIdx + 1; i < segments.length && out.length < 3; i++) push(segments[i]);
  return [...out, ...singles].slice(0, 3);
}

/**
 * Two separate questions (Codex follow-up review, finding 4):
 * 1. keywordIsRelevant: does the KEYWORD describe this product? Keyword-side
 *    only, so a correct query whose results are mixed ("roblox forsaken" for a
 *    Forsaken keychain, where most results are plush and shirts) stays tracked.
 * 2. comparablePeers: which RESULTS are fair to compare against? Each result is
 *    filtered: same recognized product type, or (type not recognized) 2+ shared
 *    product words. Too few peers means comparisons are unavailable, never
 *    padded with unrelated listings.
 */
type PeerListing = { title: string | null; tags: string[]; etsy_listing_id?: number; listingId?: number };

// Conservative, explicit product nouns. Unknown types are not evidence of peers.
const PRODUCT_TYPES = [
  ["candle holder", "candle holders", "candlestick", "candlesticks"],
  ["candle mold", "candle molds", "candle mould", "candle moulds"],
  ["earring", "earrings", "stud", "studs"], ["necklace", "necklaces"],
  ["bracelet", "bracelets"], ["ring", "rings"], ["keychain", "keychains", "keyring", "keyrings"],
  ["candle", "candles"], ["mug", "mugs"], ["coaster", "coasters"],
  ["shirt", "shirts", "tshirt", "tshirts", "t-shirt", "t-shirts", "tee", "tees"],
  ["sweatshirt", "sweatshirts", "hoodie", "hoodies"], ["dress", "dresses"],
  ["bag", "bags", "tote", "totes"], ["wallet", "wallets"],
  ["poster", "posters", "print", "prints"], ["frame", "frames"], ["painting", "paintings"],
  ["sticker", "stickers", "decal", "decals"], ["label", "labels"],
  ["yarn", "yarns"], ["fabric", "fabrics"], ["pattern", "patterns"],
  ["template", "templates"], ["soap", "soaps"], ["vase", "vases"],
  ["pillow", "pillows", "cushion", "cushions"], ["blanket", "blankets", "throw", "throws"],
  ["table", "tables"], ["chair", "chairs"], ["rug", "rugs"],
  ["ornament", "ornaments"], ["wreath", "wreaths"], ["toy", "toys", "plush", "plushie", "plushies", "doll", "dolls", "amigurumi"],
  ["portrait", "portraits"], ["wall hanging", "wall hangings", "tapestry", "tapestries"],
  ["planner", "planners"], ["svg", "svgs"], ["collar", "collars"], ["leash", "leashes"],
  ["sweater", "sweaters", "cardigan", "cardigans", "jumper", "jumpers"], ["towel", "towels"],
  ["cutting board", "cutting boards", "charcuterie board", "charcuterie boards"], ["phone case", "phone cases"],
  ["pin", "pins"], ["patch", "patches"], ["bookmark", "bookmarks"], ["tumbler", "tumblers"],
  ["apron", "aprons"], ["brooch", "brooches"], ["quilt", "quilts"], ["basket", "baskets"],
  ["lamp", "lamps"], ["clock", "clocks"], ["bowl", "bowls"], ["plate", "plates"],
  ["hat", "hats", "beanie", "beanies"], ["scarf", "scarves"], ["shoe", "shoes"],
  ["invitation", "invitations", "invite", "invites"], ["card", "cards"],
  ["notebook", "notebooks", "journal", "journals"], ["charm", "charms"],
];

function peerKind(listing: PeerListing): string | null {
  let text = ` ${(listing.title ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, " ")} `;
  const forms = ["cover", "case", "wrap", "holder", "mold", "mould", "kit", "supply", "supplies", "blank", "refill"]
    .filter(word => new RegExp(`\\b${word}s?\\b`).test(text))
    .map(word => word === "mould" ? "mold" : word === "supplies" ? "supply" : word);
  const kinds: number[] = [];
  PRODUCT_TYPES.forEach((aliases, index) => {
    let found = false;
    for (const alias of aliases) {
      if (text.includes(` ${alias} `)) {
        found = true;
        text = text.replaceAll(` ${alias} `, " ");
      }
    }
    if (found) kinds.push(index);
  });
  if (!kinds.length) return null;
  const digital = /\b(digital|download|pdf|svg|png|printable)\b/i.test([listing.title, ...listing.tags].join(" "));
  return `${digital ? "digital" : "physical"}:${kinds.join(",")}:${[...new Set(forms)].sort().join(",")}`;
}

export function comparablePeers<T extends PeerListing & { id?: number }>(listing: PeerListing, top: T[]): T[] {
  const kind = peerKind(listing);
  const ownId = listing.etsy_listing_id ?? listing.listingId;
  const notSelf = (peer: T) => ownId === undefined || (peer.id ?? peer.listingId) !== ownId;
  if (kind !== null) return top.filter(peer => notSelf(peer) && peerKind(peer) === kind);
  // Type not recognized: a peer must share 2+ product words (not status or
  // generic words), so "tea set" is not a peer for "linen tea towel".
  const own = distinctiveWords(listing.title ?? "", listing.tags);
  if (own.size < 2) return [];
  return top.filter(peer => {
    if (!notSelf(peer)) return false;
    const words = distinctiveWords(peer.title ?? "", peer.tags ?? []);
    let shared = 0;
    for (const w of words) if (own.has(w)) shared += 1;
    return shared >= 2;
  });
}

export function comparableKeywordSnapshots(listing: PeerListing, snapshots: KeywordSnapshot[]): KeywordSnapshot[] {
  return snapshots.flatMap(k => {
    if (keywordIsRelevant(listing, k.keyword, k.top) === false) return [];
    const top = comparablePeers(listing, k.top);
    return top.length >= 3 ? [{ ...k, top }] : [];
  });
}

export function keywordIsRelevant(
  listing: { title: string | null; tags: string[] },
  keyword: string,
  // Kept for call compatibility; relevance is decided by the keyword alone.
  _top?: { title: string | null; tags: string[] }[]
): boolean {
  void _top;
  const own = distinctiveWords(listing.title ?? "", listing.tags);
  const queryKind = peerKind({ title: keyword, tags: [] });
  const listingKind = peerKind(listing);
  // Describes the product when one of its real words is in the listing, or it
  // names the same recognized product type ("pillow" for "Wool cushions").
  // Pure status or generic phrases ("pre-order", "gift for her") never do.
  return kwWords(keyword).some((w) => own.has(w)) || (queryKind !== null && listingKind !== null && queryKind.split(":")[1] === listingKind.split(":")[1]);
}

export function normalizeKeywords(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const k of raw) {
    if (typeof k !== "string") return null;
    const clean = k.toLowerCase().replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (clean.length > 80) return null;
    if (!out.includes(clean)) out.push(clean);
  }
  return out.length <= 3 ? out : null;
}
