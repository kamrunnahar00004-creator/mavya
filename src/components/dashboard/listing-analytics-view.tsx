"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ArrowRight, Check, Clock, ExternalLink, Info, Link2, Pencil, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckIssue, ChangeKind, Diagnosis, TestVerdict, TopEntry } from "@/lib/listing-analytics";
import { LABEL_TEXT, type KeywordIdea, type KeywordLabel } from "@/lib/keyword-finder";

export type AnalyticsViewModel = {
  productId: string;
  productName: string | null;
  today: string;
  monitor: {
    listingId: number;
    keywords: string[];
    enabled: boolean;
    lastCheckedOn: string | null;
    lastError: string | null;
  } | null;
  listing: {
    title: string | null;
    url: string | null;
    mainImageUrl: string | null;
    imageCount: number | null;
    tags: string[];
    state: string | null;
    totalViews: number | null;
    totalFavorites: number | null;
  } | null;
  last7: { days: number; viewsPerDay: number | null; favoritesPer100Views: number | null };
  series: { date: string; viewsPerDay: number | null; favoritesPerDay: number | null }[];
  changeDates: { date: string; kinds: ChangeKind[] }[];
  keywords: {
    keyword: string;
    position: number | null;
    depth: number;
    date: string;
    top: TopEntry[];
  }[];
  diagnosis: Diagnosis;
  checks: CheckIssue[];
  tests: {
    date: string;
    kinds: ChangeKind[];
    verdict: TestVerdict;
    interruptionReason?: "keywords_changed";
    daysAfter: number;
    beforeViewsPerDay: number | null;
    afterViewsPerDay: number | null;
    marketChange: number | null;
    lift: number | null;
    beforeTitle: string | null;
    afterTitle: string | null;
    beforeImage: string | null;
    afterImage: string | null;
  }[];
  canEdit: boolean;
};

// ---------------------------------------------------------------------------
// Design language (ui-ux-pro-max "minimal single column"): one column, one
// question per section, one primary action, big numbers, short words.
// Cards are flat (hairline border, no heavy shadow); color is used only for
// meaning (next step, good/bad results), always paired with text.
// ---------------------------------------------------------------------------

const card = "min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white";
const sectionTitle = "text-[15px] font-semibold text-[var(--color-ink)]";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:cursor-default disabled:opacity-50";
const btnGhost =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[13px] font-semibold text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-ink)] disabled:cursor-default disabled:opacity-50";
const input =
  "min-h-[44px] w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-4 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-neutral-dark)] disabled:opacity-60";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1).replace(/\.0$/, "");
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const KIND_LABEL: Record<ChangeKind, string> = {
  main_photo: "Main photo",
  title: "Title",
  tags: "Tags",
  description: "Description",
};

/**
 * Etsy's CDN serves every listing photo in fixed sizes (il_75x75,
 * il_170x135, il_340x270, il_570xN). Snapshots store the 570px URL; the small
 * tiles on this page only need 170-340px, which is 3-8x fewer bytes to fetch
 * and decode. Falls back to the original URL for any other format.
 */
export function etsyThumb(url: string | null, size: "il_170x135" | "il_340x270"): string | null {
  if (!url) return null;
  return url.includes("/il_570xN.") ? url.replace("/il_570xN.", `/${size}.`) : url;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return res.ok && json.ok !== false ? { ok: true } : { ok: false, error: json.error ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

export function ListingAnalyticsView({ vm }: { vm: AnalyticsViewModel }) {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-6 break-words px-4 pb-20 pt-6 sm:px-6">
      <h1 className="sr-only">Listing analytics</h1>
      {!vm.monitor ? (
        <LinkListingCard productId={vm.productId} canEdit={vm.canEdit} />
      ) : (
        <>
          <ListingHeader vm={vm} />
          <NextStep vm={vm} />
          <Numbers vm={vm} />
          <ViewsChart vm={vm} />
          <ThingsToFix vm={vm} />
          <Search vm={vm} />
          <KeywordIdeas vm={vm} />
          <Changes vm={vm} />
          <p className="flex items-start gap-2 px-1 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Etsy updates numbers once a day. Search rank is approximate. Results show what changed, not why.
          </p>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Link a listing (empty state)
// ---------------------------------------------------------------------------

function LinkListingCard({ productId, canEdit, onCancel }: { productId: string; canEdit: boolean; onCancel?: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await postJson("/api/listings/link", { productId, listing: url.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not link that listing.");
      return;
    }
    onCancel?.();
    startTransition(() => router.refresh());
  }

  return (
    <section className={cn(card, "p-6 sm:p-8")}>
      <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-tint)] text-[var(--color-primary)]">
        <Link2 className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="font-display mt-4 text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">Track this listing on Etsy</h2>
      <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">Paste your listing link. Mavya checks it every day and tells you what to fix.</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="etsy-link" className="sr-only">
          Etsy listing link
        </label>
        <input
          id="etsy-link"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="etsy.com/listing/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={!canEdit || busy}
          className={input}
        />
        <button type="submit" className={cn(btnPrimary, "flex-shrink-0")} disabled={!canEdit || busy || !url.trim()}>
          {busy ? "Checking…" : "Start tracking"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-[var(--color-weak)]">
          {error}
        </p>
      )}
      {!canEdit && <p className="mt-3 text-[14px] text-[var(--color-weak)]">Update your billing to track listings.</p>}
      {onCancel && (
        <button type="button" onClick={onCancel} className={cn(btnGhost, "mt-2 -ml-3")}>
          Cancel
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header: which listing, and the daily check switch
// ---------------------------------------------------------------------------

function ListingHeader({ vm }: { vm: AnalyticsViewModel }) {
  const router = useRouter();
  const monitor = vm.monitor!;
  const [enabled, setEnabled] = useState(monitor.enabled);
  const [previousEnabled, setPreviousEnabled] = useState(monitor.enabled);
  if (previousEnabled !== monitor.enabled) {
    setPreviousEnabled(monitor.enabled);
    setEnabled(monitor.enabled);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next);
    const res = await postJson("/api/listings/settings", { productId: vm.productId, enabled: next });
    setBusy(false);
    if (!res.ok) {
      setEnabled(!next);
      setError(res.error ?? "Could not change the daily check.");
      return;
    }
    router.refresh();
  }

  if (relinking) {
    return <LinkListingCard productId={vm.productId} canEdit={vm.canEdit} onCancel={() => setRelinking(false)} />;
  }

  const checked = monitor.lastCheckedOn
    ? monitor.lastCheckedOn === vm.today
      ? "Checked today"
      : `Checked ${shortDate(monitor.lastCheckedOn)}`
    : "First check pending";

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {vm.listing?.mainImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={etsyThumb(vm.listing.mainImageUrl, "il_170x135") ?? undefined}
            alt=""
            decoding="async"
            className="h-12 w-12 flex-shrink-0 rounded-[var(--radius-lg)] object-cover"
          />
        ) : (
          <div className="h-12 w-12 flex-shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-page-deep)]" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-1 text-[15px] font-semibold text-[var(--color-ink)]" title={vm.listing?.title ?? undefined}>
            {vm.listing?.title ?? `Listing ${monitor.listingId}`}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 text-[13px] text-[var(--color-ink-muted)]">
            <span>{checked}</span>
            {vm.listing?.url && (
              <a href={vm.listing.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--color-ink)] hover:underline">
                Etsy <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
            <button type="button" onClick={() => setRelinking(true)} disabled={!vm.canEdit} className="hover:text-[var(--color-ink)] hover:underline disabled:opacity-50">
              Change
            </button>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={busy || (!enabled && !vm.canEdit)}
          className="flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-full pl-2 text-[13px] font-medium text-[var(--color-ink-muted)] disabled:opacity-50"
        >
          <span className="hidden sm:inline">Daily check</span>
          <span
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200",
              enabled ? "bg-[var(--color-strong)]" : "bg-[var(--color-border-strong)]"
            )}
            aria-hidden="true"
          >
            <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200", enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
          </span>
          <span className="sr-only sm:hidden">Daily check</span>
        </button>
      </div>
      {vm.listing?.state && vm.listing.state !== "active" && (
        <p className="text-[13px] text-[var(--color-weak)]">This listing is {vm.listing.state} on Etsy.</p>
      )}
      {monitor.lastError === "listing_not_found" && <p className="text-[13px] text-[var(--color-weak)]">Etsy could not find this listing on the last check.</p>}
      {monitor.lastError && monitor.lastError !== "listing_not_found" && (
        <p role="status" className="text-[13px] text-[var(--color-ink-muted)]">The last check did not finish. Mavya will try again.</p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-[var(--color-weak)]">
          {error}
        </p>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// The one thing to do next
// ---------------------------------------------------------------------------

function NextStep({ vm }: { vm: AnalyticsViewModel }) {
  const d = vm.diagnosis;
  const waiting = d.state === "collecting" || d.state === "testing";
  const good = d.state === "healthy";
  const photoHref = `/dashboard/product/${vm.productId}`;
  const cta =
    d.fixTarget === "main_photo"
      ? { href: photoHref, label: "Improve main photo" }
      : d.fixTarget === "supporting_photos"
        ? { href: photoHref, label: "Add photos" }
        : d.fixTarget === "title_tags"
          ? { href: "#things-to-fix", label: "See what to fix" }
          : null;
  const label = good ? "All good" : waiting ? (d.state === "testing" ? "Measuring your change" : "Getting started") : "Your next step";
  const Icon = good ? Check : waiting ? Clock : Sparkles;

  return (
    <section
      aria-labelledby="next-step"
      className={cn(
        "rounded-[var(--radius-2xl)] p-6 sm:p-7",
        good ? "bg-[var(--color-strong-soft)]" : waiting ? "bg-white border border-[var(--color-border-soft)]" : "bg-[var(--color-tint)]"
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-[13px] font-semibold",
          good ? "text-[var(--color-strong)]" : waiting ? "text-[var(--color-ink-muted)]" : "text-[var(--color-primary)]"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </p>
      <h2 id="next-step" className="font-display mt-2 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--color-ink)] sm:text-[24px]">
        {d.headline}
      </h2>
      <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-[var(--color-ink-muted)]">{d.detail}</p>
      {cta && (
        <Link href={cta.href} className={cn(btnPrimary, "mt-5")}>
          {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Three numbers
// ---------------------------------------------------------------------------

// Search rank is deliberately NOT a headline number: it is the order of
// Etsy API results, not a verified shopper view (north star 11.2 rule 6).
function Numbers({ vm }: { vm: AnalyticsViewModel }) {
  const tags = vm.listing?.tags.length;
  const items = [
    { value: fmt(vm.last7.viewsPerDay), label: "views a day" },
    { value: fmt(vm.last7.favoritesPer100Views), label: "net favorites per 100 views" },
    { value: tags === undefined ? "–" : `${tags}/13`, label: "tags used" },
  ];
  return (
    <section aria-label="Last 7 days" className={cn(card, "grid grid-cols-3 divide-x divide-[var(--color-border-soft)]")}>
      {items.map((s) => (
        <div key={s.label} className="px-3 py-5 text-center sm:px-5">
          <p className="text-[26px] font-bold leading-none tracking-[-0.02em] text-[var(--color-ink)] tabular-nums sm:text-[30px]">{s.value}</p>
          <p className="mt-2 text-[12.5px] leading-tight text-[var(--color-ink-muted)]">{s.label}</p>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Views a day (single series; a dot marks days the listing changed)
// ---------------------------------------------------------------------------

function ViewsChart({ vm }: { vm: AnalyticsViewModel }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = vm.series;
  const known = points.filter((p) => p.viewsPerDay !== null);
  const W = 720;
  const H = 140;
  // Axis text is HTML (below), not SVG: SVG text scales down with the chart
  // and becomes unreadable on phones.
  const padL = 0;
  const padB = 2;
  const padT = 14;
  const plotW = W;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...known.map((p) => p.viewsPerDay as number));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const n = Math.max(points.length, 1);
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(14, slot - 3));
  const changeByDate = new Map(vm.changeDates.map((c) => [c.date, c.kinds]));
  const hovered = hover !== null ? points[hover] : null;

  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="views-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="views-title" className={sectionTitle}>
          Views a day
        </h2>
        {vm.changeDates.length > 0 && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden="true" /> you changed something
          </p>
        )}
      </div>
      {known.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-page)] px-4 py-10 text-center text-[14px] text-[var(--color-ink-muted)]">
          Your chart starts tomorrow.
        </p>
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Views a day, last ${points.length} days`}>
            {[0, 1].map((f) => {
              const y = padT + plotH * (1 - f);
              return <line key={f} x1={0} x2={W} y1={y} y2={y} stroke="var(--color-border-soft)" strokeWidth={1} />;
            })}
            {points.map((p, i) => {
              const cx = padL + slot * i + slot / 2;
              const v = p.viewsPerDay;
              const h = v === null ? 0 : Math.max(2, (v / niceMax) * plotH);
              return (
                <g key={p.date}>
                  {v !== null && (
                    <path
                      d={roundedTopBar(cx - barW / 2, padT + plotH - h, barW, h, Math.min(4, barW / 2))}
                      fill={hover === i ? "var(--color-ink)" : "var(--color-neutral-dark)"}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  )}
                  {changeByDate.has(p.date) && <circle cx={cx} cy={padT - 6} r={4} fill="var(--color-primary)" />}
                  <rect
                    x={padL + slot * i}
                    y={0}
                    width={slot}
                    height={padT + plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${shortDate(p.date)}: ${v === null ? "no data" : `${fmt(v)} views`}`}
                  />
                </g>
              );
            })}
          </svg>
          <span className="pointer-events-none absolute left-0 top-0 -translate-y-1/2 bg-white pr-1.5 text-[11.5px] tabular-nums text-[var(--color-ink-soft)]">
            {niceMax}
          </span>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-[var(--color-ink-soft)]">
            <span>{points.length ? shortDate(points[0].date) : ""}</span>
            <span>{points.length ? shortDate(points[points.length - 1].date) : ""}</span>
          </div>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] text-white shadow-[var(--shadow-soft-strong)]"
              style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}
            >
              <span className="font-semibold">{shortDate(hovered.date)}</span>
              {" · "}
              {hovered.viewsPerDay === null ? "no data" : `${fmt(hovered.viewsPerDay)} views`}
              {changeByDate.get(hovered.date) ? ` · ${changeByDate.get(hovered.date)!.map((k) => KIND_LABEL[k]).join(", ")} changed` : ""}
            </div>
          )}
          <details className="mt-2 text-[13px] text-[var(--color-ink-muted)]">
            <summary className="cursor-pointer select-none hover:text-[var(--color-ink)]">See numbers</summary>
            <div className="mt-2 max-h-56 overflow-auto">
              <table className="w-full text-left tabular-nums">
                <thead>
                  <tr className="text-[var(--color-ink-soft)]">
                    <th className="py-1 pr-4 font-medium">Day</th>
                    <th className="py-1 pr-4 font-medium">Views</th>
                    <th className="py-1 pr-4 font-medium">Favorites</th>
                    <th className="py-1 font-medium">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.date} className="border-t border-[var(--color-border-soft)]">
                      <td className="py-1 pr-4">{shortDate(p.date)}</td>
                      <td className="py-1 pr-4">{fmt(p.viewsPerDay)}</td>
                      <td className="py-1 pr-4">{fmt(p.favoritesPerDay)}</td>
                      <td className="py-1">{changeByDate.get(p.date)?.map((k) => KIND_LABEL[k]).join(", ") ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// ---------------------------------------------------------------------------
// Things to fix (title, tags, photo count)
// ---------------------------------------------------------------------------

const SEVERITY_DOT = {
  high: "bg-[var(--color-weak)]",
  medium: "bg-[var(--color-mid)]",
  low: "bg-[var(--color-border-strong)]",
} as const;
const SEVERITY_LABEL = { high: "Important", medium: "Worth fixing", low: "Small" } as const;
const FIX_PREVIEW = 3;

function ThingsToFix({ vm }: { vm: AnalyticsViewModel }) {
  const [showAll, setShowAll] = useState(false);
  if (!vm.listing) return null;
  const shown = showAll ? vm.checks : vm.checks.slice(0, FIX_PREVIEW);
  return (
    <section id="things-to-fix" className={cn(card, "scroll-mt-24 p-5 sm:p-6")} aria-labelledby="fix-title">
      <h2 id="fix-title" className={sectionTitle}>
        Things to fix{vm.checks.length > 0 && <span className="ml-1.5 font-normal text-[var(--color-ink-soft)]">{vm.checks.length}</span>}
      </h2>
      {vm.checks.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-[14px] text-[var(--color-strong)]">
          <Check className="h-4 w-4" aria-hidden="true" /> Nothing to fix in your title and tags.
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-[var(--color-border-soft)]">
            {shown.map((c) => (
              <li key={c.id} className="flex gap-3 py-3.5">
                <span className={cn("mt-[7px] h-2 w-2 flex-shrink-0 rounded-full", SEVERITY_DOT[c.severity])} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-[var(--color-ink)]">
                    <span className="sr-only">{SEVERITY_LABEL[c.severity]}: </span>
                    {c.title}
                  </p>
                  <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">{c.detail}</p>
                  {c.suggestions && c.suggestions.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggestions">
                      {c.suggestions.map((s) => (
                        <li key={s} className="rounded-[var(--radius-md)] bg-[var(--color-page-deep)] px-2.5 py-1 text-[12.5px] text-[var(--color-ink)]">
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {vm.checks.length > FIX_PREVIEW && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className={cn(btnGhost, "-ml-3 mt-1")} aria-expanded={showAll}>
              {showAll ? "Show less" : `Show all ${vm.checks.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Search: your keywords, your rank, and the top listings next to yours
// ---------------------------------------------------------------------------

function Search({ vm }: { vm: AnalyticsViewModel }) {
  const router = useRouter();
  const current = vm.monitor!.keywords;
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([...current, "", "", ""].slice(0, 3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idx = Math.min(active, Math.max(0, vm.keywords.length - 1));
  const k = vm.keywords[idx];

  function startEdit() {
    setDraft([...current, "", "", ""].slice(0, 3));
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/listings/settings", {
      productId: vm.productId,
      keywords: draft.map((x) => x.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="search-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="search-title" className={sectionTitle}>
          Etsy search
        </h2>
        {!editing && (
          <button type="button" onClick={startEdit} disabled={!vm.canEdit} className={cn(btnGhost, "-mr-3")}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Keywords
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-3 flex flex-col gap-2.5">
          <p className="text-[13.5px] text-[var(--color-ink-muted)]">What would a buyer type to find this? Up to 3.</p>
          {draft.map((x, i) => (
            <div key={i}>
              <label htmlFor={`kw-${i}`} className="sr-only">
                Keyword {i + 1}
              </label>
              <input
                id={`kw-${i}`}
                value={x}
                maxLength={80}
                disabled={busy}
                placeholder={i === 0 ? "crochet bunny plush" : "Optional"}
                onChange={(e) => setDraft((d) => d.map((y, j) => (j === i ? e.target.value : y)))}
                className={input}
              />
            </div>
          ))}
          <p className="text-[12.5px] text-[var(--color-ink-soft)]">Your views history is kept. Open tests using old keywords stop.</p>
          {error && (
            <p role="alert" className="text-[13.5px] text-[var(--color-weak)]">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={busy}>
              {busy ? "Checking…" : "Save"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : !k ? (
        <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">
          {current.length ? "Checking your keywords with the next daily check." : "Add a keyword to see your rank and the top listings."}
        </p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Where you show up when buyers search these words. From Mavya&apos;s daily check, so what you see on Etsy may differ a little.</p>
          <ul className="mt-3 flex flex-col gap-1.5" role="group" aria-label="Your keywords">
            {vm.keywords.map((kw, i) => {
              const selected = i === idx;
              const found = kw.position !== null;
              return (
                <li key={kw.keyword}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActive(i)}
                    className={cn(
                      "flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border px-4 text-left transition-colors",
                      selected
                        ? "border-[var(--color-neutral-dark)] bg-[var(--color-page)]"
                        : "border-[var(--color-border-soft)] hover:border-[var(--color-border-strong)]"
                    )}
                  >
                    <span className="min-w-0 truncate text-[15px] text-[var(--color-ink)]">&ldquo;{kw.keyword}&rdquo;</span>
                    <span
                      className={cn(
                        "flex-shrink-0 text-[14px] font-semibold tabular-nums",
                        found ? "text-[var(--color-ink)]" : "text-[var(--color-weak)]"
                      )}
                    >
                      {found ? `About #${kw.position}` : `Not in first ${kw.depth}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <RankingTable
            keyword={k.keyword}
            you={{
              id: -1,
              position: k.position ?? undefined,
              title: vm.listing?.title ?? "Your listing",
              tags: [],
              views: vm.listing?.totalViews ?? null,
              favorites: vm.listing?.totalFavorites ?? null,
              imageCount: vm.listing?.imageCount ?? 0,
              mainImageId: null,
              mainImageUrl: vm.listing?.mainImageUrl ?? null,
              url: vm.listing?.url ?? null,
            }}
            depth={k.depth}
            top={k.top.slice(0, 5)}
          />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Keyword ideas (keyword finder): no AI, public Etsy data, shared daily cache
// ---------------------------------------------------------------------------

const LABEL_STYLE: Record<KeywordLabel, string> = {
  unknown: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
  winning: "bg-[var(--color-strong-soft)] text-[var(--color-strong)]",
  add: "bg-[var(--color-tint)] text-[var(--color-primary)]",
  keep: "bg-[var(--color-page-deep)] text-[var(--color-ink)]",
  crowded: "bg-[var(--color-weak-soft)] text-[var(--color-weak)]",
  quiet: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
};

function KeywordIdeas({ vm }: { vm: AnalyticsViewModel }) {
  const router = useRouter();
  const tracked = vm.monitor!.keywords;
  const [ideas, setIdeas] = useState<KeywordIdea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/listings/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: vm.productId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; ideas?: KeywordIdea[]; error?: string };
      if (!res.ok || !json.ideas) setError(json.error ?? "Could not check keywords. Try again.");
      else setIdeas(json.ideas);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function track(keyword: string) {
    setSaving(keyword);
    setError(null);
    const res = await postJson("/api/listings/settings", { productId: vm.productId, keywords: [...tracked, keyword].slice(-3) });
    setSaving(null);
    if (!res.ok) setError(res.error ?? "Could not track that keyword.");
    else router.refresh();
  }

  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="ideas-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ideas-title" className={sectionTitle}>
          Keyword ideas
        </h2>
        {ideas && (
          <button type="button" onClick={find} disabled={busy} className={cn(btnGhost, "-mr-3")}>
            {busy ? "Checking…" : "Check again"}
          </button>
        )}
      </div>
      {!ideas ? (
        <>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
            Mavya checks phrases from your listing and from top listings, then marks which are worth a tag.
          </p>
          <button type="button" onClick={find} disabled={busy || !vm.canEdit} className={cn(btnPrimary, "mt-4")}>
            {busy ? "Checking Etsy…" : "Find keyword ideas"}
          </button>
        </>
      ) : ideas.length === 0 ? (
        <p className="mt-2 text-[14px] text-[var(--color-ink-muted)]">No ideas found for this listing yet.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-[var(--color-border-soft)]">
            {ideas.map((i) => {
              const isTracked = tracked.includes(i.keyword);
              return (
                <li key={i.keyword} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] text-[var(--color-ink)]">&ldquo;{i.keyword}&rdquo;</p>
                    <p className="text-[12.5px] tabular-nums text-[var(--color-ink-muted)]">
                      {compact.format(i.competition)} listings
                      {i.interest !== null && ` · top listings ${compact.format(i.interest)} views`}
                      {i.position !== null ? ` · you about #${i.position}` : " · you not in first 100"}
                    </p>
                  </div>
                  <span className={cn("rounded-[var(--radius-md)] px-2.5 py-1 text-[12px] font-semibold", LABEL_STYLE[i.label])}>{LABEL_TEXT[i.label]}</span>
                  {(i.label === "add" || i.label === "winning" || i.label === "keep") && !isTracked && (
                    <button
                      type="button"
                      onClick={() => track(i.keyword)}
                      disabled={saving !== null || !vm.canEdit}
                      className={cn(btnGhost, "border border-[var(--color-border)]")}
                    >
                      {saving === i.keyword ? "Saving…" : "Track"}
                    </button>
                  )}
                  {isTracked && <span className="text-[12.5px] text-[var(--color-ink-soft)]">Tracked</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[12px] text-[var(--color-ink-soft)]">
            &ldquo;Views&rdquo; means the top listings for that phrase, all time. Etsy does not share search volume. Tracking keeps your 3 newest keywords.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13.5px] text-[var(--color-weak)]">
          {error}
        </p>
      )}
    </section>
  );
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const num = (n: number | null) => (n === null ? "–" : n >= 10_000 ? compact.format(n) : n.toLocaleString("en-US"));

/**
 * The top listings for one keyword as a ranked list, with the seller's own
 * row placed at its real rank (or after the list when outside the top 100).
 * Numbers sit in aligned columns so they can be compared at a glance.
 */
function RankingTable({ keyword, you, depth, top }: { keyword: string; you: TopEntry; depth: number; top: TopEntry[] }) {
  const rows = [...top.map((t, i) => ({ ...t, position: t.position ?? i + 1, mine: false })), { ...you, mine: true }];
  const ranked = rows
    .filter((r) => r.position !== undefined)
    .sort((a, b) => (a.position as number) - (b.position as number));
  const unranked = rows.filter((r) => r.position === undefined);
  const col = "w-16 flex-shrink-0 text-right tabular-nums sm:w-20";
  return (
    <div className="mt-6">
      <p className="text-[13px] font-medium text-[var(--color-ink)]">Top listings for &ldquo;{keyword}&rdquo;</p>
      <div className="mt-2 flex items-center gap-3 border-b border-[var(--color-border-soft)] pb-2 text-[12px] text-[var(--color-ink-soft)]">
        <span className="w-8 flex-shrink-0">Rank</span>
        <span className="min-w-0 flex-1">Listing</span>
        <span className={col}>Views</span>
        <span className={col}>Favorites</span>
        <span className={cn(col, "hidden sm:block")}>Photos</span>
      </div>
      <ol className="divide-y divide-[var(--color-border-soft)]">
        {[...ranked, ...unranked].map((r) => (
          <li
            key={r.mine ? "you" : r.id}
            className={cn("flex items-center gap-3 py-2.5", r.mine && "-mx-3 rounded-[var(--radius-lg)] bg-[var(--color-tint)] px-3")}
          >
            <span className="w-8 flex-shrink-0 text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">
              {r.position !== undefined ? `#${r.position}` : "–"}
            </span>
            <a
              href={r.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
              title={r.title}
            >
              <span className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
                {r.mainImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={etsyThumb(r.mainImageUrl, "il_170x135") ?? undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] text-[var(--color-ink)]">{r.title}</span>
                {r.mine && (
                  <span className="block text-[12px] font-semibold text-[var(--color-primary)]">
                    {r.position !== undefined ? "Your listing" : `Your listing · not in top ${depth}`}
                  </span>
                )}
              </span>
            </a>
            <span className={cn(col, "text-[14px] text-[var(--color-ink)]")}>{num(r.views)}</span>
            <span className={cn(col, "text-[14px] text-[var(--color-ink)]")}>{num(r.favorites)}</span>
            <span className={cn(col, "hidden text-[14px] text-[var(--color-ink)] sm:block")}>{r.imageCount || "–"}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-[var(--color-ink-soft)]">All-time numbers from Etsy.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your changes and what happened after
// ---------------------------------------------------------------------------

const VERDICT: Record<TestVerdict, { label: string; cls: string }> = {
  better: { label: "Better", cls: "bg-[var(--color-strong-soft)] text-[var(--color-strong)]" },
  worse: { label: "Worse", cls: "bg-[var(--color-weak-soft)] text-[var(--color-weak)]" },
  no_clear_change: { label: "No change", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]" },
  running: { label: "Measuring", cls: "bg-[var(--color-mid-soft)] text-[#8A5A12]" },
  interrupted: { label: "Stopped", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]" },
  no_baseline: { label: "Can't measure", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]" },
  insufficient_data: { label: "Can't measure", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]" },
};

function Changes({ vm }: { vm: AnalyticsViewModel }) {
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="changes-title">
      <h2 id="changes-title" className={sectionTitle}>
        Your changes
      </h2>
      {vm.tests.length === 0 ? (
        <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">Change your photo, title, or tags on Etsy. Mavya measures it for you.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--color-border-soft)]">
          {vm.tests.map((t) => {
            const v = VERDICT[t.verdict];
            const photo = t.kinds.includes("main_photo") && t.afterImage;
            return (
              <li key={t.date} className="flex items-center gap-3 py-3.5">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={etsyThumb(t.afterImage, "il_170x135") ?? undefined}
                    alt="New main photo"
                    loading="lazy"
                    decoding="async"
                    className="h-11 w-11 flex-shrink-0 rounded-[var(--radius-md)] object-cover"
                  />
                ) : (
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-[var(--color-ink)]">
                    {t.kinds.map((x) => KIND_LABEL[x]).join(", ")} <span className="font-normal text-[var(--color-ink-soft)]">· {shortDate(t.date)}</span>
                  </p>
                  <p className="text-[13.5px] text-[var(--color-ink-muted)]">{changeSentence(t)}</p>
                </div>
                <span className={cn("flex-shrink-0 rounded-[var(--radius-md)] px-2.5 py-1 text-[12.5px] font-semibold", v.cls)}>{v.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function changeSentence(t: AnalyticsViewModel["tests"][number]): string {
  const views = `${fmt(t.beforeViewsPerDay)} → ${fmt(t.afterViewsPerDay)} views a day`;
  switch (t.verdict) {
    case "running":
      return `Day ${t.daysAfter} of 14.`;
    case "interrupted":
      return t.interruptionReason === "keywords_changed" ? "Stopped because your keywords changed." : "Another change came too soon to measure this one.";
    case "no_baseline":
      return "Not enough data from before the change.";
    case "insufficient_data":
      return "Not enough data to compare.";
    default:
      return t.lift === null ? views : `${views} · ${pct(t.lift)} vs top listings`;
  }
}

function pct(ratio: number): string {
  const p = Math.round((ratio - 1) * 100);
  return `${p >= 0 ? "+" : ""}${p}%`;
}
