"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FlaskConical,
  Heart,
  Link2,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckIssue, ChangeKind, Diagnosis, TestVerdict, TopEntry } from "@/lib/listing-analytics";

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
    top: (TopEntry & { photoScore: number | null })[];
  }[];
  ownPhotoScore: number | null;
  winnerPhotoScore: number | null;
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

const card =
  "min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6";
const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]";
const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-default disabled:opacity-60";
const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:cursor-default disabled:opacity-60";
const input =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-neutral-dark)]";

const fmt = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "–" : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(digits);
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
    <main className="mx-auto flex min-w-0 max-w-[1200px] flex-col gap-5 break-words px-4 pb-16 pt-6 sm:px-6">
      {!vm.monitor ? (
        <LinkListingCard productId={vm.productId} canEdit={vm.canEdit} />
      ) : (
        <>
          <ListingHeader vm={vm} />
          <NextFixCard vm={vm} />
          <StatRow vm={vm} />
          <ViewsChart vm={vm} />
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <SearchCard vm={vm} />
            <ChecksCard vm={vm} />
          </div>
          <WinnersCard vm={vm} />
          <TestsCard vm={vm} />
          <p className="px-1 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            Numbers come from Etsy&apos;s public data, updated once a day. Search position is approximate: Etsy
            personalizes results and mixes in ads. Etsy does not share how often a listing is shown, so Mavya
            compares views instead of click rate. Before/after results compare your listing to the top listings over
            the same days. They are not A/B tests and do not prove a change caused the result.
          </p>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Link listing
// ---------------------------------------------------------------------------

function LinkListingCard({
  productId,
  canEdit,
  onCancel,
}: {
  productId: string;
  canEdit: boolean;
  onCancel?: () => void;
}) {
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
    <section className={cn(card, "mx-auto w-full max-w-[720px]")}>
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
          <Link2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>Listing coach</p>
          <h1 className="mt-1 text-[22px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
            Link this product to your Etsy listing
          </h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Paste the listing link. Mavya checks it once a day, compares it to the top listings for the same search,
            tells you the next thing to fix, and checks whether your change worked. No Etsy login needed.
          </p>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="etsy-link" className="sr-only">
              Etsy listing link
            </label>
            <input
              id="etsy-link"
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://www.etsy.com/listing/123456789/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!canEdit || busy}
              className={input}
            />
            <button type="submit" className={cn(btnPrimary, "flex-shrink-0")} disabled={!canEdit || busy || !url.trim()}>
              {busy ? "Checking Etsy…" : "Start monitoring"}
            </button>
          </form>
          {onCancel && (
            <button type="button" onClick={onCancel} className="mt-3 text-[13px] font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:underline">
              Cancel
            </button>
          )}
          {!canEdit && (
            <p className="mt-3 text-[13px] text-[var(--color-weak)]">Your subscription is past due. Update billing to link listings.</p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-[13.5px] text-[var(--color-weak)]">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header: listing + monitoring switch
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
      setError(res.error ?? "Could not change monitoring.");
      return;
    }
    router.refresh();
  }

  if (relinking) {
    return <LinkListingCard productId={vm.productId} canEdit={vm.canEdit} onCancel={() => setRelinking(false)} />;
  }

  return (
    <section className={cn(card, "flex flex-col gap-4 sm:flex-row sm:items-center")}>
      {vm.listing?.mainImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={etsyThumb(vm.listing.mainImageUrl, "il_170x135") ?? undefined}
          alt=""
          decoding="async"
          className="h-20 w-20 flex-shrink-0 rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] object-cover"
        />
      ) : (
        <div className="h-20 w-20 flex-shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-page-deep)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className={eyebrow}>Monitored Etsy listing</p>
        <h1 className="mt-1 line-clamp-2 text-[17px] font-bold leading-snug text-[var(--color-ink)]">
          {vm.listing?.title ?? `Listing ${monitor.listingId}`}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
          {vm.listing?.url && (
            <a href={vm.listing.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--color-ink)] hover:underline">
              View on Etsy <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {monitor.lastCheckedOn ? `Last checked ${shortDate(monitor.lastCheckedOn)}` : "First check pending"}
          </span>
          {vm.listing?.state && vm.listing.state !== "active" && (
            <span className="font-semibold text-[var(--color-weak)]">Listing is {vm.listing.state} on Etsy</span>
          )}
          <button type="button" onClick={() => setRelinking(true)} disabled={!vm.canEdit} className="font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:underline disabled:opacity-60">
            Change listing
          </button>
        </div>
        {monitor.lastError === "listing_not_found" && (
          <p className="mt-2 text-[13px] text-[var(--color-weak)]">Etsy could not find this listing on the last check. It may be deleted or inactive.</p>
        )}
        {monitor.lastError && monitor.lastError !== "listing_not_found" && (
          <p role="status" className="mt-2 text-[13px] text-[var(--color-weak)]">The last Etsy check was incomplete. Mavya will retry; some saved numbers may be out of date.</p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-[var(--color-weak)]">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Daily monitoring"
          onClick={toggle}
          disabled={busy || (!enabled && !vm.canEdit)}
          className={cn(
            "relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
            enabled ? "bg-[var(--color-strong)]" : "bg-[var(--color-border-strong)]"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-6" : "translate-x-1"
            )}
          />
        </button>
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">
          {enabled ? "Monitoring daily" : "Monitoring paused"}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Next best fix
// ---------------------------------------------------------------------------

function NextFixCard({ vm }: { vm: AnalyticsViewModel }) {
  const d = vm.diagnosis;
  const tone =
    d.state === "healthy"
      ? { bg: "bg-[var(--color-strong-soft)]", fg: "text-[var(--color-strong)]", Icon: CheckCircle2, label: "Healthy" }
      : d.state === "collecting" || d.state === "testing"
        ? { bg: "bg-[var(--color-page-deep)]", fg: "text-[var(--color-ink-muted)]", Icon: d.state === "testing" ? FlaskConical : Clock, label: d.state === "testing" ? "Test running" : "Collecting data" }
        : { bg: "bg-[var(--color-tint)]", fg: "text-[var(--color-primary)]", Icon: Sparkles, label: "Next best fix" };
  const photoHref = `/dashboard/product/${vm.productId}`;
  const cta =
    d.fixTarget === "main_photo"
      ? { href: photoHref, label: "Improve the main photo" }
      : d.fixTarget === "supporting_photos"
        ? { href: photoHref, label: "Add supporting photos" }
        : d.fixTarget === "title_tags"
          ? { href: "#title-tags", label: "See title and tag fixes" }
          : null;

  return (
    <section className={cn("min-w-0 rounded-[var(--radius-xl)] p-5 sm:p-6", tone.bg)}>
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white">
          <tone.Icon className={cn("h-5 w-5", tone.fg)} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[12px] font-semibold uppercase tracking-[0.12em]", tone.fg)}>{tone.label}</p>
          <h2 className="mt-1 text-[19px] font-bold leading-snug text-[var(--color-ink)]">{d.headline}</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-[var(--color-ink-muted)]">{d.detail}</p>
          {d.evidence.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {d.evidence.map((e) => (
                <li key={e} className="rounded-full bg-white/80 px-3 py-1 text-[12.5px] font-medium text-[var(--color-ink)]">
                  {e}
                </li>
              ))}
            </ul>
          )}
          {cta && (
            <Link href={cta.href} className={cn(btnPrimary, "mt-4")}>
              {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stat row
// ---------------------------------------------------------------------------

function StatRow({ vm }: { vm: AnalyticsViewModel }) {
  const best = vm.keywords
    .filter((k) => k.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number))[0];
  const stats = [
    {
      Icon: Eye,
      label: "Views per day",
      value: fmt(vm.last7.viewsPerDay),
      note: vm.last7.days ? `Last ${vm.last7.days} day${vm.last7.days > 1 ? "s" : ""}` : "Needs 2 daily checks",
    },
    {
      Icon: Heart,
      label: "Net favorites per 100 views",
      value: fmt(vm.last7.favoritesPer100Views),
      note: vm.last7.favoritesPer100Views === null ? "Needs 30+ views and favorite counts" : "Last 7 days, including unfavorites",
    },
    {
      Icon: Search,
      label: "Best search position",
      value: best ? `#${best.position}` : vm.keywords.length ? "Not in top 100" : "–",
      note: best ? `"${best.keyword}" (approx.)` : vm.keywords.length ? "For tracked keywords" : "Add keywords below",
    },
  ];
  return (
    <section className="grid min-w-0 gap-4 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className={card}>
          <p className={cn(eyebrow, "flex items-center gap-1.5")}>
            <s.Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {s.label}
          </p>
          <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.02em] text-[var(--color-ink)]">{s.value}</p>
          <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">{s.note}</p>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Views per day chart (single series, change markers, hover, table view)
// ---------------------------------------------------------------------------

function ViewsChart({ vm }: { vm: AnalyticsViewModel }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = vm.series;
  const known = points.filter((p) => p.viewsPerDay !== null);
  const W = 720;
  const H = 180;
  const padL = 36;
  const padB = 22;
  const padT = 12;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const max = Math.max(1, ...known.map((p) => p.viewsPerDay as number));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const n = Math.max(points.length, 1);
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(18, slot - 2));
  const changeByDate = new Map(vm.changeDates.map((c) => [c.date, c.kinds]));
  const hovered = hover !== null ? points[hover] : null;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold text-[var(--color-ink)]">Views per day</h2>
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
          <span className="inline-block h-3 w-0.5 bg-[var(--color-primary)]" aria-hidden="true" /> Listing changed
        </p>
      </div>
      {known.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-page)] px-4 py-8 text-center text-[14px] text-[var(--color-ink-muted)]">
          The chart starts after the second daily check. Etsy updates view counts once a day.
        </p>
      ) : (
        <div className="relative mt-3 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[480px]" role="img" aria-label="Views per day for the last 30 days">
            {[0, 0.5, 1].map((f) => {
              const y = padT + plotH * (1 - f);
              return (
                <g key={f}>
                  <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="var(--color-border-soft)" strokeWidth={1} />
                  <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-soft)">
                    {Math.round(niceMax * f)}
                  </text>
                </g>
              );
            })}
            {points.map((p, i) => {
              const cx = padL + slot * i + slot / 2;
              const kinds = changeByDate.get(p.date);
              const v = p.viewsPerDay;
              const h = v === null ? 0 : Math.max(2, (v / niceMax) * plotH);
              return (
                <g key={p.date}>
                  {kinds && (
                    <line x1={cx} x2={cx} y1={padT} y2={padT + plotH} stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="4 3" />
                  )}
                  {v !== null && (
                    <path
                      d={roundedTopBar(cx - barW / 2, padT + plotH - h, barW, h, Math.min(4, barW / 2))}
                      fill={hover === i ? "var(--color-ink)" : "var(--color-neutral-dark)"}
                    />
                  )}
                  {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
                    <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-soft)">
                      {shortDate(p.date)}
                    </text>
                  )}
                  <rect
                    x={padL + slot * i}
                    y={padT}
                    width={slot}
                    height={plotH}
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
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-[12.5px] shadow-[var(--shadow-soft-strong)]"
              style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}
            >
              <p className="font-semibold text-[var(--color-ink)]">{shortDate(hovered.date)}</p>
              <p className="text-[var(--color-ink-muted)]">
                {hovered.viewsPerDay === null ? "No Etsy data" : `${fmt(hovered.viewsPerDay)} views, ${fmt(hovered.favoritesPerDay)} favorites`}
              </p>
              {changeByDate.get(hovered.date) && (
                <p className="font-semibold text-[var(--color-primary)]">
                  Changed: {changeByDate.get(hovered.date)!.map((k) => KIND_LABEL[k]).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {known.length > 0 && (
        <details className="mt-3 text-[13px] text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--color-ink)]">Show as table</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[var(--color-ink-soft)]">
                  <th className="py-1 pr-4 font-semibold">Date</th>
                  <th className="py-1 pr-4 font-semibold">Views</th>
                  <th className="py-1 pr-4 font-semibold">Favorites</th>
                  <th className="py-1 font-semibold">Change</th>
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
      )}
    </section>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// ---------------------------------------------------------------------------
// Search keywords
// ---------------------------------------------------------------------------

function SearchCard({ vm }: { vm: AnalyticsViewModel }) {
  const router = useRouter();
  const current = vm.monitor!.keywords;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([...current, "", "", ""].slice(0, 3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson("/api/listings/settings", {
      productId: vm.productId,
      keywords: draft.map((k) => k.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save keywords.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold text-[var(--color-ink)]">Search position</h2>
        {!editing && (
          <button type="button" onClick={() => { setDraft([...current, "", "", ""].slice(0, 3)); setError(null); setEditing(true); }} disabled={!vm.canEdit} className={btnSecondary}>
            Edit keywords
          </button>
        )}
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        Where this listing shows up when buyers search these phrases (approx., top 100 checked daily).
      </p>
      {editing ? (
        <form onSubmit={save} className="mt-4 flex flex-col gap-2.5">
          {draft.map((k, i) => (
            <div key={i}>
              <label htmlFor={`kw-${i}`} className="sr-only">
                Keyword {i + 1}
              </label>
              <input
                id={`kw-${i}`}
                value={k}
                maxLength={80}
                disabled={busy}
                placeholder={i === 0 ? "e.g. crochet bunny plush" : "Optional"}
                onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
                className={input}
              />
            </div>
          ))}
          <p className="text-[12.5px] text-[var(--color-ink-soft)]">New keywords start fresh search comparisons. Views and completed results are kept; unfinished tests using the old keywords stop.</p>
          {error && (
            <p role="alert" className="text-[13px] text-[var(--color-weak)]">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={busy}>
              {busy ? "Checking Etsy…" : "Save and check now"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : vm.keywords.length === 0 ? (
        <p className="mt-4 text-[14px] text-[var(--color-ink-muted)]">
          {current.length ? "Checking these keywords on the next daily run." : "No keywords yet. Add up to 3 search phrases."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-[var(--color-border-soft)]">
          {vm.keywords.map((k) => {
            const onPageOne = k.position !== null && k.position <= 48;
            return (
              <li key={k.keyword} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0 truncate text-[14.5px] font-semibold text-[var(--color-ink)]">&ldquo;{k.keyword}&rdquo;</span>
                <span
                  className={cn(
                    "flex-shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold",
                    onPageOne ? "bg-[var(--color-strong-soft)] text-[var(--color-strong)]" : "bg-[var(--color-weak-soft)] text-[var(--color-weak)]"
                  )}
                >
                  {k.position === null ? `Not in top ${k.depth}` : `#${k.position}${onPageOne ? " · top 48" : ""}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Title / tags / photos checks
// ---------------------------------------------------------------------------

function ChecksCard({ vm }: { vm: AnalyticsViewModel }) {
  const sev = {
    high: "bg-[var(--color-weak-soft)] text-[var(--color-weak)]",
    medium: "bg-[var(--color-mid-soft)] text-[#8a5a12]",
    low: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
  } as const;
  const sevLabel = { high: "Fix first", medium: "Worth fixing", low: "Small win" } as const;
  return (
    <section id="title-tags" className={cn(card, "scroll-mt-24")}>
      <h2 className="text-[16px] font-bold text-[var(--color-ink)]">Title, tags and photos check</h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Compared with the top listings for your keywords.</p>
      {vm.checks.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[14px] text-[var(--color-strong)]">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {vm.listing ? "No title or tag problems found." : "Runs after the first check."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {vm.checks.map((c) => (
            <li key={c.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 text-[14.5px] font-semibold text-[var(--color-ink)]">{c.title}</p>
                <span className={cn("flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", sev[c.severity])}>
                  {sevLabel[c.severity]}
                </span>
              </div>
              <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">{c.detail}</p>
              {c.suggestions && c.suggestions.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {c.suggestions.map((s) => (
                    <li key={s} className="rounded-full bg-[var(--color-page-deep)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--color-ink)]">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compared to top listings
// ---------------------------------------------------------------------------

function WinnersCard({ vm }: { vm: AnalyticsViewModel }) {
  const [active, setActive] = useState(0);
  if (vm.keywords.length === 0) return null;
  const k = vm.keywords[Math.min(active, vm.keywords.length - 1)];
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-[var(--color-ink)]">Compared to top listings</h2>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Up to 5 comparison listings for &ldquo;{k.keyword}&rdquo;, excluding yours. Photo score uses the same Mavya rubric as your photos.
          </p>
        </div>
        {vm.keywords.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Keyword">
            {vm.keywords.map((kw, i) => (
              <button
                key={kw.keyword}
                type="button"
                aria-pressed={i === Math.min(active, vm.keywords.length - 1)}
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12.5px] font-semibold",
                  i === Math.min(active, vm.keywords.length - 1) ? "bg-[var(--color-neutral-dark)] text-white" : "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]"
                )}
              >
                {kw.keyword}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <WinnerTile
          label="Your listing"
          highlight
          imageUrl={vm.listing?.mainImageUrl ?? null}
          title={vm.listing?.title ?? ""}
          photoScore={vm.ownPhotoScore}
          views={vm.listing?.totalViews ?? null}
          favorites={vm.listing?.totalFavorites ?? null}
          photos={vm.listing?.imageCount ?? null}
          href={vm.listing?.url ?? null}
        />
        {k.top.map((t, i) => (
          <WinnerTile
            key={t.id}
            label={t.position ? `#${t.position}` : `Comparison ${i + 1}`}
            imageUrl={t.mainImageUrl}
            title={t.title}
            photoScore={t.photoScore}
            views={t.views}
            favorites={t.favorites}
            photos={t.imageCount}
            href={t.url}
          />
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-[var(--color-ink-soft)]">
        Views and favorites are lifetime totals from Etsy. Photo scores are collected gradually as monitoring runs.
      </p>
    </section>
  );
}

function WinnerTile(props: {
  label: string;
  highlight?: boolean;
  imageUrl: string | null;
  title: string;
  photoScore: number | null;
  views: number | null;
  favorites: number | null;
  photos: number | null;
  href: string | null;
}) {
  const body = (
    <>
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
        {props.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={etsyThumb(props.imageUrl, "il_340x270") ?? undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        )}
        <span
          className={cn(
            "absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold",
            props.highlight ? "bg-[var(--color-primary)] text-white" : "bg-white/90 text-[var(--color-ink)]"
          )}
        >
          {props.label}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-snug text-[var(--color-ink)]">{props.title}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--color-ink-muted)]">
        <dt>Photo score</dt>
        <dd className="text-right font-semibold text-[var(--color-ink)]">{props.photoScore === null ? "–" : props.photoScore.toFixed(1)}</dd>
        <dt>Views</dt>
        <dd className="text-right font-semibold text-[var(--color-ink)]">{fmt(props.views, 0)}</dd>
        <dt>Favorites</dt>
        <dd className="text-right font-semibold text-[var(--color-ink)]">{fmt(props.favorites, 0)}</dd>
        <dt>Photos</dt>
        <dd className="text-right font-semibold text-[var(--color-ink)]">{props.photos ?? "–"}</dd>
      </dl>
    </>
  );
  const cls = cn(
    "block rounded-[var(--radius-lg)] border p-2",
    props.highlight ? "border-[var(--color-primary)] bg-[var(--color-tint)]" : "border-[var(--color-border-soft)] bg-white hover:border-[var(--color-border-strong)]"
  );
  return props.href ? (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
// Before/after tests
// ---------------------------------------------------------------------------

const VERDICT: Record<TestVerdict, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  better: { label: "Looks better", cls: "bg-[var(--color-strong-soft)] text-[var(--color-strong)]", Icon: ArrowUpRight },
  worse: { label: "Looks worse", cls: "bg-[var(--color-weak-soft)] text-[var(--color-weak)]", Icon: ArrowDownRight },
  no_clear_change: { label: "No clear change", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]", Icon: ArrowRight },
  running: { label: "Still running", cls: "bg-[var(--color-mid-soft)] text-[#8a5a12]", Icon: Clock },
  interrupted: { label: "Interrupted", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]", Icon: AlertTriangle },
  no_baseline: { label: "No before data", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]", Icon: AlertTriangle },
  insufficient_data: { label: "Not enough comparable data", cls: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]", Icon: AlertTriangle },
};

function TestsCard({ vm }: { vm: AnalyticsViewModel }) {
  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 text-[16px] font-bold text-[var(--color-ink)]">
        <FlaskConical className="h-4 w-4" aria-hidden="true" /> Before/after tests
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        When you change the main photo, title, or tags on Etsy, Mavya spots it the next day and compares up to 14 days
        before with up to 14 days after. Change one thing at a time for a clear answer.
      </p>
      {vm.tests.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-page)] px-4 py-6 text-center text-[14px] text-[var(--color-ink-muted)]">
          No changes yet. Make the fix above on Etsy and the test starts on its own.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {vm.tests.map((t) => {
            const v = VERDICT[t.verdict];
            return (
              <li key={t.date} className="rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14.5px] font-semibold text-[var(--color-ink)]">
                    {t.kinds.map((k) => KIND_LABEL[k]).join(", ")} changed · {shortDate(t.date)}
                  </p>
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-semibold", v.cls)}>
                    <v.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {v.label}
                  </span>
                </div>
                <p className="mt-1.5 text-[13.5px] text-[var(--color-ink-muted)]">{testSentence(t)}</p>
                {t.kinds.includes("main_photo") && t.beforeImage && t.afterImage && (
                  <div className="mt-3 flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={etsyThumb(t.beforeImage, "il_170x135") ?? undefined} alt="Main photo before" loading="lazy" decoding="async" className="h-16 w-16 rounded-[var(--radius-md)] object-cover" />
                    <ArrowRight className="h-4 w-4 text-[var(--color-ink-soft)]" aria-hidden="true" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={etsyThumb(t.afterImage, "il_170x135") ?? undefined} alt="Main photo after" loading="lazy" decoding="async" className="h-16 w-16 rounded-[var(--radius-md)] object-cover" />
                  </div>
                )}
                {t.kinds.includes("title") && t.beforeTitle && t.afterTitle && (
                  <div className="mt-3 grid gap-1 text-[12.5px]">
                    <p className="text-[var(--color-ink-soft)] line-through">{t.beforeTitle}</p>
                    <p className="text-[var(--color-ink)]">{t.afterTitle}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function testSentence(t: AnalyticsViewModel["tests"][number]): string {
  const before = `${fmt(t.beforeViewsPerDay)} views/day before`;
  const after = `${fmt(t.afterViewsPerDay)} after`;
  switch (t.verdict) {
    case "running":
      return `Day ${t.daysAfter} of up to 14. Results appear after 7 days and at least 20 views. So far: ${before}, ${after}.`;
    case "interrupted":
      if (t.interruptionReason === "keywords_changed") return "Tracked keywords changed before this comparison had enough data. Its original history is kept, but the test has stopped.";
      return "Another change came too soon after this one, so this result cannot be measured on its own.";
    case "no_baseline":
      return "There was not enough data from before this change (your views or the top listings for your keywords) to compare, so this change cannot be measured.";
    case "insufficient_data":
      return "This window could not support a comparison. It needs daily listing and market observations, enough views, and a nonzero baseline. No improvement or decline is claimed.";
    default: {
      const market =
        t.marketChange === null
          ? "No top-listing data for the same days."
          : `Top listings changed ${pct(t.marketChange)} over the same days.`;
      const lift = t.lift === null || t.marketChange === null ? "" : ` Compared with them, your listing moved ${pct(t.lift)}.`;
      return `${before}, ${after}. ${market}${lift}`;
    }
  }
}

function pct(ratio: number): string {
  const p = Math.round((ratio - 1) * 100);
  return `${p >= 0 ? "+" : ""}${p}%`;
}
