"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronRight, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_HISTORY_DAYS, type FixAction, type ShopStatus } from "@/lib/shop-analytics";
import type { ShopHomeData } from "@/lib/shop-monitor";

// Same flat, single-column language as the listing tabs.
const card = "min-w-0 rounded-[var(--radius-2xl)] border border-[var(--color-border-soft)] bg-white";
const sectionTitle = "text-[15px] font-semibold text-[var(--color-ink)]";
const addDaysUtc = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:cursor-default disabled:opacity-50";
const btnGhost =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:opacity-50";
const input =
  "min-h-[44px] w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-4 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-neutral-dark)] disabled:opacity-60";

const thumb = (url: string | null) => (url && url.includes("/il_570xN.") ? url.replace("/il_570xN.", "/il_170x135.") : url);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (n: number | null) => (n === null ? "–" : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1).replace(/\.0$/, ""));

export const STATUS_META: Record<Exclude<ShopStatus, "steady" | "collecting">, { label: string; hint: string; cls: string }> = {
  rising: { label: "Rising", hint: "More views than usual", cls: "text-[var(--color-strong)]" },
  falling: { label: "Falling", hint: "Fewer views than usual", cls: "text-[var(--color-weak)]" },
  seen_not_liked: { label: "Seen, not liked", hint: "Views but few favorites", cls: "text-[#7a4f0f]" },
  dead: { label: "No views", hint: "Almost none in 30 days", cls: "text-[var(--color-ink-muted)]" },
};

const ACTION_LABEL: Record<FixAction, string> = { write: "Write", photo: "Photo", analytics: "Open" };
const ACTION_PATH: Record<FixAction, string> = { write: "/write", photo: "", analytics: "/analytics" };

/** Open a shop listing: existing product, or import it (main photo + link). */
function useOpenListing(opened: Record<number, string>) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function open(listingId: number, action: FixAction) {
    setError(null);
    const known = opened[listingId];
    if (known) {
      router.push(`/dashboard/product/${known}${ACTION_PATH[action]}`);
      return;
    }
    setBusy(listingId);
    try {
      const res = await fetch("/api/shop/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; productId?: string; error?: string };
      if (!res.ok || !json.productId) {
        setError(json.error ?? "Could not open that listing. Try again.");
        setBusy(null);
        return;
      }
      // A new import always lands on the Photo tab, where its main photo is
      // being scored; Write and Analytics are one tap away from there.
      router.push(`/dashboard/product/${json.productId}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(null);
    }
  }
  return { open, busy, error };
}

function ConnectShop({ canEdit, onCancel, current }: { canEdit: boolean; onCancel?: () => void; current?: string }) {
  const router = useRouter();
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!shop.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop: shop.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not connect that shop.");
        return;
      }
      onCancel?.();
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={cn(card, "p-6 sm:p-7")}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
        <Store className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-[22px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
        {current ? "Switch shop" : "Connect your Etsy shop"}
      </h2>
      <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">
        Mavya checks every listing daily and tells you which ones to fix first. No Etsy login needed.
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="shop-name" className="sr-only">
          Etsy shop name
        </label>
        <input
          id="shop-name"
          className={input}
          placeholder="Your shop name or etsy.com/shop/..."
          autoComplete="off"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          disabled={busy || !canEdit}
        />
        <button type="submit" className={cn(btnPrimary, "flex-shrink-0")} disabled={busy || !canEdit || !shop.trim()}>
          {busy ? "Reading your shop…" : "Connect shop"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-[var(--color-weak)]">
          {error}
        </p>
      )}
      {onCancel && (
        <button type="button" onClick={onCancel} className={cn(btnGhost, "-ml-3 mt-2")}>
          Cancel
        </button>
      )}
    </section>
  );
}

export function ShopHome({ data, canEdit }: { data: ShopHomeData | null; canEdit: boolean }) {
  const [switching, setSwitching] = useState(false);
  const { open, busy, error } = useOpenListing(data?.opened ?? {});
  if (!data) {
    return (
      <p className={cn(card, "p-6 text-[15px] text-[var(--color-ink-muted)]")}>
        Shop tracking is unavailable right now. Your listings below still work.
      </p>
    );
  }
  if (!data.shop) return <ConnectShop canEdit={canEdit} />;
  if (switching) return <ConnectShop canEdit={canEdit} current={data.shop.name} onCancel={() => setSwitching(false)} />;

  const v = data.view;
  const checked = data.shop.lastCheckedOn ? `Checked ${shortDate(data.shop.lastCheckedOn)}` : "First check pending";
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-[26px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">{data.shop.name}</h2>
          <p className="text-[13.5px] text-[var(--color-ink-muted)]">
            {v ? `${v.listings.length} listings tracked · ` : ""}
            {checked}
          </p>
          {v && data.shop.activeListings != null && v.listings.length < data.shop.activeListings && (
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              Tracking your {v.listings.length} most viewed of {data.shop.activeListings} listings.
            </p>
          )}
        </div>
        <button type="button" onClick={() => setSwitching(true)} className={btnGhost} disabled={!canEdit}>
          Switch shop
        </button>
      </header>

      {!v ? (
        <p className={cn(card, "p-6 text-[15px] text-[var(--color-ink-muted)]")}>
          {data.shop.lastError ? "The last check did not finish. Mavya will retry on the next daily run." : "First shop check pending."}
        </p>
      ) : (
        <>
          <ShopNumbers v={v} />
          <ShopViewsChart v={v} />
          {v.historyDays < MIN_HISTORY_DAYS ? <TrendsProgress days={v.historyDays} lastChecked={data.shop.lastCheckedOn} /> : <StatusTiles v={v} />}

          <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="fix3">
            <h3 id="fix3" className={sectionTitle}>
              {v.fixQueue.length ? `Fix these ${v.fixQueue.length} first` : "Fix first"}
            </h3>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Picked from title, photos, and tags, weighted by how many people see each listing.</p>
            {v.fixQueue.length === 0 ? (
              <p className="mt-3 flex items-center gap-2 text-[14px] text-[var(--color-strong)]">
                <Check className="h-4 w-4" aria-hidden="true" /> Nothing urgent. Check back tomorrow.
              </p>
            ) : (
              <ol className="mt-2 divide-y divide-[var(--color-border-soft)]">
                {v.fixQueue.map((f) => (
                  <li key={f.listingId} className="flex items-center gap-3 py-3">
                    <Thumb url={f.mainImageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-[var(--color-ink)]">{f.title}</p>
                      <p className="text-[13px] text-[var(--color-ink-muted)]">{f.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => open(f.listingId, f.action)}
                      disabled={busy !== null || !canEdit}
                      className={cn(btnPrimary, "min-h-[40px] px-4")}
                    >
                      {busy === f.listingId ? "Opening..." : ACTION_LABEL[f.action]}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {error && (
              <p role="alert" className="mt-2 text-[13.5px] text-[var(--color-weak)]">
                {error}
              </p>
            )}
          </section>

          {v.top.length > 0 && (
            <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="top3">
              <h3 id="top3" className={sectionTitle}>
                Most viewed
              </h3>
              <ol className="mt-2 divide-y divide-[var(--color-border-soft)]">
                {v.top.map((t) => (
                  <li key={t.listingId} className="flex items-center gap-3 py-3">
                    <Thumb url={t.mainImageUrl} />
                    <p className="min-w-0 flex-1 truncate text-[15px] text-[var(--color-ink)]">{t.title}</p>
                    <p className="flex-shrink-0 text-right text-[13px] tabular-nums text-[var(--color-ink-muted)]">
                      <span className="font-semibold text-[var(--color-ink)]">{fmt(t.views)}</span> views
                      {t.favorites !== null && <span className="block">{fmt(t.favorites)} favorites</span>}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {v.changes.length > 0 && <ChangesSummary v={v} />}

          <Link href="/dashboard/shop" className="inline-flex items-center gap-1 self-start text-[14px] font-semibold text-[var(--color-ink)] hover:underline">
            See all {v.listings.length} listings <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </>
      )}
    </div>
  );
}

type View = NonNullable<ShopHomeData["view"]>;

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb(url) ?? undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

/** Day-1 numbers: Etsy's all-time counters, so a new shop is never empty. */
function ShopNumbers({ v }: { v: View }) {
  const rate = v.totals.views >= 30 ? (v.totals.favorites / v.totals.views) * 100 : null;
  const cells = [
    { label: "Views", sub: "all time", value: fmt(v.totals.views) },
    { label: "Favorites", sub: "all time", value: fmt(v.totals.favorites) },
    { label: "Favorites", sub: "per 100 views", value: rate === null ? "–" : rate.toFixed(1) },
  ];
  return (
    <section aria-label="Shop numbers" className={cn(card, "grid grid-cols-3 divide-x divide-[var(--color-border-soft)]")}>
      {cells.map((c) => (
        <div key={c.label + c.sub} className="min-w-0 px-3 py-4 sm:px-5">
          <p className="text-[22px] font-bold leading-none tabular-nums text-[var(--color-ink)] sm:text-[26px]">{c.value}</p>
          <p className="mt-2 text-[13px] font-semibold text-[var(--color-ink)]">{c.label}</p>
          <p className="text-[12px] text-[var(--color-ink-muted)]">{c.sub}</p>
        </div>
      ))}
    </section>
  );
}

function ShopViewsChart({ v }: { v: View }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = v.daily;
  const known = points.filter((p) => p.views !== null);
  const W = 720;
  const H = 140;
  const padT = 14;
  const plotH = H - padT - 2;
  const max = Math.max(1, ...known.map((p) => p.views as number));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const slot = W / Math.max(points.length, 1);
  const barW = Math.max(3, Math.min(16, slot - 3));
  const last7 = known.slice(-7).reduce((s, p) => s + (p.views as number), 0);
  const hovered = hover !== null ? points[hover] : null;
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="shop-views">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="shop-views" className={sectionTitle}>
          Shop views a day
        </h3>
        {known.length > 0 && <p className="text-[13px] tabular-nums text-[var(--color-ink-muted)]">{fmt(last7)} in the last {Math.min(7, known.length)} days</p>}
      </div>
      {known.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-page)] px-4 py-8 text-center">
          <p className="text-[15px] font-semibold text-[var(--color-ink)]">Your chart starts tomorrow</p>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">Etsy only shows total views, so Mavya needs two daily checks to count one day.</p>
        </div>
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Shop views a day, last ${points.length} days`}>
            <line x1={0} x2={W} y1={padT + plotH} y2={padT + plotH} stroke="var(--color-border-soft)" strokeWidth={1} />
            <line x1={0} x2={W} y1={padT} y2={padT} stroke="var(--color-border-soft)" strokeWidth={1} strokeDasharray="4 4" />
            {points.map((p, i) => {
              const cx = slot * i + slot / 2;
              const h = p.views === null ? 0 : Math.max(2, (p.views / niceMax) * plotH);
              const r = Math.min(4, barW / 2, h);
              const x = cx - barW / 2;
              const y = padT + plotH - h;
              return (
                <g key={p.date}>
                  {p.views !== null && (
                    <path
                      d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                      fill={hover === i ? "var(--color-primary)" : "var(--color-neutral-dark)"}
                      opacity={hover === null || hover === i ? 1 : 0.5}
                    />
                  )}
                  <rect
                    x={slot * i}
                    y={0}
                    width={slot}
                    height={H}
                    fill="transparent"
                    tabIndex={0}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    aria-label={`${shortDate(p.date)}: ${p.views === null ? "no data" : `${fmt(p.views)} views`}`}
                  />
                </g>
              );
            })}
          </svg>
          <span className="pointer-events-none absolute left-0 top-0 -translate-y-1/2 bg-white pr-1.5 text-[11.5px] tabular-nums text-[var(--color-ink-soft)]">{niceMax}</span>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-[var(--color-ink-soft)]">
            <span>{shortDate(points[0].date)}</span>
            <span>{shortDate(points[points.length - 1].date)}</span>
          </div>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] text-white"
              style={{ left: `${((slot * hover + slot / 2) / W) * 100}%` }}
            >
              <span className="font-semibold">{shortDate(hovered.date)}</span> · {hovered.views === null ? "no data" : `${fmt(hovered.views)} views`}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Before 14 days: say exactly when trends arrive instead of showing dashes. */
function TrendsProgress({ days, lastChecked }: { days: number; lastChecked: string | null }) {
  const left = Math.max(0, MIN_HISTORY_DAYS - days);
  const ready = lastChecked ? shortDate(addDaysUtc(lastChecked, left)) : null;
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="trends">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="trends" className={sectionTitle}>
          Trends
        </h3>
        <p className="text-[13px] tabular-nums text-[var(--color-ink-muted)]">
          Day {days} of {MIN_HISTORY_DAYS}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-page-deep)]" role="progressbar" aria-valuemin={0} aria-valuemax={MIN_HISTORY_DAYS} aria-valuenow={days}>
        <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.min(100, (days / MIN_HISTORY_DAYS) * 100)}%` }} />
      </div>
      <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">
        {ready ? `On ${ready}` : "In about two weeks"} Mavya shows which listings are rising, falling, or seen but not liked. Two weeks of daily numbers keep one busy day from fooling it.
      </p>
    </section>
  );
}

function StatusTiles({ v }: { v: View }) {
  return (
    <section aria-label="This week in your shop" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => (
        <Link key={k} href={`/dashboard/shop?filter=${k}`} className={cn(card, "block p-4 transition-colors hover:border-[var(--color-border-strong)]")}>
          <p className={cn("text-[26px] font-bold leading-none tabular-nums", v.counts[k] ? STATUS_META[k].cls : "text-[var(--color-ink-soft)]")}>{v.counts[k]}</p>
          <p className="mt-2 text-[14px] font-semibold text-[var(--color-ink)]">{STATUS_META[k].label}</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)]">{STATUS_META[k].hint}</p>
        </Link>
      ))}
    </section>
  );
}

const VERDICT_LABEL = { better: "Better", worse: "Worse", no_change: "No change", measuring: "Measuring", not_enough_data: "Can't measure", interrupted: "Changed again" } as const;
const VERDICT_CLS = {
  interrupted: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
  better: "bg-[var(--color-strong-soft)] text-[var(--color-strong)]",
  worse: "bg-[var(--color-weak-soft)] text-[var(--color-weak)]",
  no_change: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
  measuring: "bg-[var(--color-mid-soft)] text-[#7a4f0f]",
  not_enough_data: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
} as const;

function ChangesSummary({ v }: { v: NonNullable<ShopHomeData["view"]> }) {
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="shop-changes">
      <h3 id="shop-changes" className="text-[15px] font-semibold text-[var(--color-ink)]">
        Your changes
        {v.summary.measured > 0 && (
          <span className="ml-1.5 font-normal text-[var(--color-ink-soft)]">
            {v.summary.better} of {v.summary.measured} look better
          </span>
        )}
      </h3>
      <ul className="mt-2 divide-y divide-[var(--color-border-soft)]">
        {v.changes.slice(0, 3).map((c) => (
          <li key={`${c.listingId}-${c.date}`} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] text-[var(--color-ink)]">{c.title}</p>
              <p className="text-[13px] text-[var(--color-ink-muted)]">
                {c.kinds.map((k) => ({ main_photo: "Main photo", title: "Title", tags: "Tags", description: "Description" })[k]).join(", ")} · {shortDate(c.date)}
                {c.beforePerDay !== null && c.afterPerDay !== null && ` · ${fmt(c.beforePerDay)} → ${fmt(c.afterPerDay)} views a day`}
              </p>
            </div>
            <span className={cn("flex-shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-semibold", VERDICT_CLS[c.verdict])}>{VERDICT_LABEL[c.verdict]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-[var(--color-ink-soft)]">Compared with the rest of your shop over the same days. Shows what changed after, not why.</p>
    </section>
  );
}

/** Full list of tracked listings, with an optional status filter. */
export function ShopListings({ data, filter, canEdit }: { data: ShopHomeData; filter: string | null; canEdit: boolean }) {
  const { open, busy, error } = useOpenListing(data.opened);
  const v = data.view;
  if (!data.shop || !v) return <ConnectShop canEdit={canEdit} />;
  const rows = filter && filter in STATUS_META ? v.listings.filter((l) => l.status === filter) : v.listings;
  const chips: { key: string | null; label: string }[] = [{ key: null, label: `All ${v.listings.length}` }, ...(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => ({ key: k, label: `${STATUS_META[k].label} ${v.counts[k]}` }))];
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={c.key ? `/dashboard/shop?filter=${c.key}` : "/dashboard/shop"}
            aria-current={(filter ?? null) === c.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold",
              (filter ?? null) === c.key ? "border-[var(--color-neutral-dark)] bg-[var(--color-neutral-dark)] text-white" : "border-[var(--color-border)] bg-white text-[var(--color-ink)]"
            )}
          >
            {c.label}
          </Link>
        ))}
      </nav>
      <section className={cn(card, "px-4 py-2 sm:px-5")}>
        <div className="flex items-center gap-3 border-b border-[var(--color-border-soft)] py-2 text-[12px] text-[var(--color-ink-soft)]">
          <span className="min-w-0 flex-1">Listing</span>
          <span className="w-16 text-right sm:w-20">Views/day</span>
          <span className="hidden w-16 text-right sm:block">Tags</span>
          <span className="hidden w-16 text-right sm:block">Photos</span>
          <span className="w-[72px]" />
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-[var(--color-ink-muted)]">No listings here right now.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-soft)]">
            {rows.map((l) => (
              <li key={l.listingId} className="flex items-center gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
                    {l.mainImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb(l.mainImageUrl) ?? undefined} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-[var(--color-ink)]">{l.title}</span>
                    <span className="block text-[12px] text-[var(--color-ink-muted)]">
                      {l.status in STATUS_META ? STATUS_META[l.status as keyof typeof STATUS_META].label : l.issues[0]?.text ?? " "}
                    </span>
                  </span>
                </div>
                <span className="w-16 text-right text-[14px] tabular-nums text-[var(--color-ink)] sm:w-20">{fmt(l.viewsPerDay)}</span>
                <span className="hidden w-16 text-right text-[14px] tabular-nums text-[var(--color-ink)] sm:block">{l.tagsUsed}/13</span>
                <span className="hidden w-16 text-right text-[14px] tabular-nums text-[var(--color-ink)] sm:block">{l.imageCount ?? "–"}</span>
                <button type="button" onClick={() => open(l.listingId, "analytics")} disabled={busy !== null || !canEdit} className={cn(btnGhost, "w-[72px] border border-[var(--color-border)]")}>
                  {busy === l.listingId ? "…" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && (
        <p role="alert" className="text-[13.5px] text-[var(--color-weak)]">
          {error}
        </p>
      )}
    </div>
  );
}
