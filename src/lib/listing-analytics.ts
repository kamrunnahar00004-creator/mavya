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
export const BETTER_LIFT = 1.15;
export const WORSE_LIFT = 0.87;
export const ETSY_TAG_MAX = 20;
export const ETSY_TAG_SLOTS = 13;

// ---------------------------------------------------------------------------
// Dates (UTC day strings)
// ---------------------------------------------------------------------------

export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
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
  /** Average new views per day since the previous valid snapshot. Null = unknown. */
  viewsPerDay: number | null;
  favoritesPerDay: number | null;
};

/**
 * Etsy's `views` is a lifetime counter tabulated once a day, and `0` can mean
 * "not tabulated yet", so a 0 (or a counter that went backwards) is treated as
 * missing, never as zero views. Gaps between snapshots are averaged.
 */
export function buildDailySeries(snapshots: ListingSnapshot[]): DailyPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const points: DailyPoint[] = [];
  let prev: ListingSnapshot | null = null;
  for (const s of sorted) {
    const validViews = typeof s.views === "number" && s.views > 0 ? s.views : null;
    let viewsPerDay: number | null = null;
    let favoritesPerDay: number | null = null;
    if (prev && validViews !== null && prev.etsy_listing_id === s.etsy_listing_id) {
      const days = dayNumber(s.snapshot_date) - dayNumber(prev.snapshot_date);
      if (days > 0 && typeof prev.views === "number" && validViews >= prev.views) {
        viewsPerDay = (validViews - prev.views) / days;
        if (typeof s.favorites === "number" && typeof prev.favorites === "number") {
          favoritesPerDay = Math.max(0, s.favorites - prev.favorites) / days;
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
    if (validViews !== null) prev = s;
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
  for (const p of series) {
    if (p.date < from || p.date > to || p.viewsPerDay === null) continue;
    days += 1;
    views += p.viewsPerDay;
    favorites += p.favoritesPerDay ?? 0;
  }
  return {
    days,
    views,
    favorites,
    viewsPerDay: days > 0 ? views / days : null,
    favoritesPer100Views: views >= 1 ? (favorites / views) * 100 : null,
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
export function buildMarketSeries(kwSnaps: KeywordSnapshot[], topN = 10): MarketPoint[] {
  const byKeyword = new Map<string, KeywordSnapshot[]>();
  for (const k of kwSnaps) {
    const list = byKeyword.get(k.keyword) ?? [];
    list.push(k);
    byKeyword.set(k.keyword, list);
  }
  const perDate = new Map<string, number[]>();
  for (const list of byKeyword.values()) {
    list.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const days = dayNumber(cur.snapshot_date) - dayNumber(prev.snapshot_date);
      if (days <= 0) continue;
      const prevViews = new Map(prev.top.map((t) => [t.id, t.views]));
      const deltas: number[] = [];
      for (const t of cur.top.slice(0, topN)) {
        const before = prevViews.get(t.id);
        if (typeof before === "number" && before > 0 && typeof t.views === "number" && t.views >= before) {
          deltas.push((t.views - before) / days);
        }
      }
      const m = median(deltas);
      if (m === null) continue;
      const arr = perDate.get(cur.snapshot_date) ?? [];
      arr.push(m);
      perDate.set(cur.snapshot_date, arr);
    }
  }
  return [...perDate.entries()]
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

// ---------------------------------------------------------------------------
// Change detection + before/after tests
// ---------------------------------------------------------------------------

export type ChangeKind = "main_photo" | "title" | "tags" | "description";

export type ChangeEvent = {
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
      date: cur.snapshot_date,
      kinds,
      before: { title: prev.title, tags: prev.tags, mainImageUrl: prev.main_image_url },
      after: { title: cur.title, tags: cur.tags, mainImageUrl: cur.main_image_url },
    });
  }
  return events;
}

export type TestVerdict = "running" | "better" | "worse" | "no_clear_change" | "interrupted" | "no_baseline";

export type TestResult = {
  event: ChangeEvent;
  verdict: TestVerdict;
  daysAfter: number;
  before: WindowStats;
  after: WindowStats;
  /** Listing views/day after ÷ before. */
  listingChange: number | null;
  /** Top listings views/day after ÷ before over the same dates. Null = no control data. */
  marketChange: number | null;
  /** listingChange ÷ marketChange (or listingChange when no control). */
  lift: number | null;
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
  today: string
): TestResult {
  const beforeFrom = addDays(event.date, -TEST_WINDOW_DAYS);
  const beforeTo = addDays(event.date, -1);
  const afterFrom = addDays(event.date, 1);
  let afterTo = addDays(event.date, TEST_WINDOW_DAYS);
  if (nextEventDate && addDays(nextEventDate, -1) < afterTo) afterTo = addDays(nextEventDate, -1);
  if (today < afterTo) afterTo = today;

  const before = windowStats(series, beforeFrom, beforeTo);
  const after = windowStats(series, afterFrom, afterTo);
  const daysAfter = Math.max(0, dayNumber(afterTo) - dayNumber(event.date));

  const base = { event, daysAfter, before, after, listingChange: null, marketChange: null, lift: null };

  const interrupted = nextEventDate !== null && addDays(nextEventDate, -1) < addDays(event.date, MIN_AFTER_DAYS);
  if (before.days < 3 || before.viewsPerDay === null) {
    return { ...base, verdict: interrupted ? "interrupted" : "no_baseline" };
  }
  if (after.days < MIN_AFTER_DAYS || after.views < MIN_AFTER_VIEWS) {
    return { ...base, verdict: interrupted ? "interrupted" : "running" };
  }

  const listingChange =
    before.viewsPerDay > 0 ? (after.viewsPerDay ?? 0) / before.viewsPerDay : null;
  const mBefore = marketWindowAvg(market, beforeFrom, beforeTo);
  const mAfter = marketWindowAvg(market, afterFrom, afterTo);
  const marketChange = mBefore && mAfter && mBefore > 0 ? mAfter / mBefore : null;
  const lift = listingChange === null ? null : marketChange ? listingChange / marketChange : listingChange;

  let verdict: TestVerdict = "no_clear_change";
  if (lift === null) verdict = (after.viewsPerDay ?? 0) > 0 ? "better" : "no_clear_change";
  else if (lift >= BETTER_LIFT) verdict = "better";
  else if (lift <= WORSE_LIFT) verdict = "worse";

  return { ...base, verdict, listingChange, marketChange, lift };
}

export function evaluateAllTests(
  events: ChangeEvent[],
  series: DailyPoint[],
  market: MarketPoint[],
  today: string
): TestResult[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return sorted
    .map((e, i) => evaluateTest(e, sorted[i + 1]?.date ?? null, series, market, today))
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
      detail: "Every empty tag slot is a search phrase your listing cannot be found for.",
    });
  }

  const maybeCut = tags.filter((t) => t.length >= ETSY_TAG_MAX);
  if (maybeCut.length > 0) {
    issues.push({
      id: "tags_may_be_cut",
      area: "tags",
      severity: "low",
      title: `${maybeCut.length} tag${maybeCut.length > 1 ? "s" : ""} may be cut off`,
      detail: `Etsy tags stop at ${ETSY_TAG_MAX} characters. Check these read as real search phrases.`,
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
      detail: "Only add the ones that are true for your product.",
      suggestions: missing,
    });
  }

  // Etsy matches search words across the title AND tags together. The
  // primary (first) keyword belongs in the title; the others only need to be
  // covered by the title or an exact tag.
  keywords.forEach((kw, i) => {
    const k = kw.toLowerCase();
    const inTitle = titleLower.includes(k);
    if (i === 0 && !inTitle) {
      issues.push({
        id: `title_missing_${kw}`,
        area: "title",
        severity: "high",
        title: `Your title does not contain "${kw}"`,
        detail: "This is your main search phrase. Put it near the start of the title, in the words buyers type.",
      });
    } else if (i === 0 && titleLower.indexOf(k) > 40) {
      issues.push({
        id: `title_late_${kw}`,
        area: "title",
        severity: "low",
        title: `"${kw}" appears late in your title`,
        detail: "Etsy search shows the start of the title. Lead with what the product is.",
      });
    } else if (i > 0 && !inTitle && !own.has(k)) {
      issues.push({
        id: `keyword_uncovered_${kw}`,
        area: "tags",
        severity: "medium",
        title: `"${kw}" is not in your title or tags`,
        detail: "You track this phrase, but nothing in the listing matches it. Add it as a tag if it is true for the product.",
      });
    }
  });

  if (title.length > 0 && title.length < 40) {
    issues.push({
      id: "title_short",
      area: "title",
      severity: "medium",
      title: "Your title is short",
      detail: `It has ${title.length} characters. Etsy allows 140. Add what it is, material, and who it is for.`,
    });
  }

  const winnerPhotoCounts = latestKeywords.flatMap((k) => k.top.slice(0, 10).map((t) => t.imageCount)).filter((n) => n > 0);
  const winnerPhotos = median(winnerPhotoCounts);
  const ownPhotos = latest.image_count ?? 0;
  if (winnerPhotos !== null && ownPhotos < winnerPhotos - 1) {
    issues.push({
      id: "fewer_photos",
      area: "photos",
      severity: ownPhotos <= 4 ? "high" : "medium",
      title: `Top listings show ${Math.round(winnerPhotos)} photos, you show ${ownPhotos}`,
      detail: "Supporting photos answer buyer questions: size, detail, packaging, what is included.",
    });
  }

  const desc = (latest.description ?? "").trim();
  if (desc.length > 0 && desc.length < 250) {
    issues.push({
      id: "description_short",
      area: "description",
      severity: "low",
      title: "Your description is short",
      detail: "Cover size, materials, care, and what arrives in the package.",
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
};

const fmt = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));

export function diagnose(input: DiagnosisInput): Diagnosis {
  const { linked, series, market, latestKeywords, tests, today } = input;
  if (!linked) {
    return {
      state: "not_linked",
      fixTarget: null,
      headline: "Link your Etsy listing to start",
      detail: "Paste the listing link. Mavya checks it once a day and tells you what to fix next.",
      evidence: [],
    };
  }

  const evidence: string[] = [];
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
      headline: "A test is running. Leave the listing as it is for now.",
      detail: `You changed ${describeKinds(running.event.kinds)} on ${running.event.date}. Changing something else now would mix up the result. Mavya needs about ${Math.max(0, MIN_AFTER_DAYS - running.daysAfter)} more day(s) and at least ${MIN_AFTER_VIEWS} views.`,
      evidence,
    };
  }

  // Findability does not need a view history: the search position is known day 1.
  if (latestKeywords.length > 0 && (best === null || best > PAGE_ONE_SIZE)) {
    return {
      state: "findability",
      fixTarget: "title_tags",
      headline: "Buyers cannot find this listing. Fix the title and tags first.",
      detail: `It is not on page 1 of Etsy search for any tracked keyword. A better photo cannot help if buyers never see it.`,
      evidence,
    };
  }

  const last7From = addDays(today, -7);
  const own = windowStats(series, last7From, today);
  const knownDays = series.filter((p) => p.viewsPerDay !== null).length;
  if (knownDays < MIN_SERIES_DAYS || own.viewsPerDay === null) {
    return {
      state: "collecting",
      fixTarget: null,
      headline: "Mavya is watching this listing",
      detail: `It needs about ${Math.max(1, MIN_SERIES_DAYS - knownDays)} more day(s) of Etsy data before it can judge clicks and trust.`,
      evidence,
    };
  }

  const marketVpd = marketWindowAvg(market, last7From, today);
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

  if (marketVpd !== null && own.viewsPerDay < marketVpd * 0.25) {
    return {
      state: "click",
      fixTarget: "main_photo",
      headline: "Buyers see this listing but do not click. Fix the main photo.",
      detail:
        photoGap !== null && photoGap >= 1
          ? "You rank on page 1, but get far fewer views than the top listings, and their main photos score higher than yours."
          : "You rank on page 1, but get far fewer views than the top listings. The thumbnail is the first thing buyers judge.",
      evidence,
    };
  }

  const winnerFav = winnerFavoriteRate(latestKeywords);
  if (own.views >= 30 && own.favoritesPer100Views !== null) {
    evidence.push(`${own.favoritesPer100Views.toFixed(1)} favorites per 100 views`);
    if (winnerFav !== null) evidence.push(`Top listings: ${winnerFav.toFixed(1)} favorites per 100 views`);
    if (winnerFav !== null && own.favoritesPer100Views < winnerFav * 0.5) {
      return {
        state: "trust",
        fixTarget: "supporting_photos",
        headline: "Buyers click but are not convinced. Add supporting photos.",
        detail: "Far fewer visitors favorite this listing than the top listings. Show size, detail, and what is included.",
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
      headline: "Next: bring your main photo up to the top listings",
      detail: "Your views are below the top listings and their main photos score clearly higher than yours.",
      evidence,
    };
  }
  if ((input.highSeverityChecks ?? 0) > 0) {
    return {
      state: "improve",
      fixTarget: "title_tags",
      headline: "Next: fix the title and tag gaps",
      detail: "Numbers look steady. The title and tag check found gaps that can cost you search traffic.",
      evidence,
    };
  }

  return {
    state: "healthy",
    fixTarget: null,
    headline: "This listing is holding up well",
    detail: "Views and favorites are in line with the top listings. Mavya keeps watching and will flag any drop.",
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
 * Suggest up to 3 search keywords from a listing: the first title phrase
 * (Etsy titles are usually comma/pipe separated) plus multi-word tags.
 */
export function suggestKeywords(title: string, tags: string[]): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const k = raw.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
    if (k.length < 3 || k.length > 60) return;
    const words = k.split(" ");
    const trimmed = words.slice(0, 5).join(" ");
    if (!out.includes(trimmed)) out.push(trimmed);
  };
  const first = title.split(/[,|–—]| - /)[0] ?? "";
  if (first.trim()) push(first);
  for (const t of tags) {
    if (out.length >= 3) break;
    if (t.trim().split(/\s+/).length >= 2) push(t);
  }
  return out.slice(0, 3);
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
