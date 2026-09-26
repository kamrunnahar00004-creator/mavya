"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, ChevronRight, Lock, Store } from "lucide-react";
import { MetricChart, Sparkline } from "@/components/dashboard/metric-chart";
import { cn } from "@/lib/utils";
import { MIN_HISTORY_DAYS, type FixAction, type ShopStatus } from "@/lib/shop-analytics";
import type { ShopHomeData } from "@/lib/shop-monitor";
import { FREE_CHECK_EVERY_DAYS } from "@/lib/plans";

// Same flat, single-column language as the listing tabs.
const card = "min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white";
const sectionTitle = "text-[15px] font-semibold text-[var(--color-ink)]";
const addDaysUtc = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:cursor-default disabled:opacity-50";
const btnQuiet =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:cursor-default disabled:opacity-50";
const btnGhost =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[13px] font-semibold text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:opacity-50";
const input =
  "min-h-[44px] w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-4 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-neutral-dark)] disabled:opacity-60";

const thumb = (url: string | null) => (url && url.includes("/il_570xN.") ? url.replace("/il_570xN.", "/il_170x135.") : url);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (n: number | null) => (n === null ? "–" : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1).replace(/\.0$/, ""));

export const STATUS_META: Record<Exclude<ShopStatus, "steady" | "collecting">, { label: string; hint: string; cls: string }> = {
  rising: { label: "Rising", hint: "More views than usual", cls: "text-[var(--color-strong)]" },
  falling: { label: "Falling", hint: "Fewer views than usual", cls: "text-[var(--color-weak)]" },
  seen_not_liked: { label: "Seen, not liked", hint: "Views but few favorites", cls: "text-[#8A5A12]" },
  dead: { label: "No views", hint: "Almost none in 30 days", cls: "text-[var(--color-ink-muted)]" },
};

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
      // Land where the button said (Add tags -> Write). The main photo keeps
      // scoring in the background and shows on the Photo tab.
      router.push(`/dashboard/product/${json.productId}${ACTION_PATH[action]}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(null);
    }
  }
  return { open, busy, error };
}

/** "Not now" / "Don't touch" / undo for a listing's fix tip. */
function useListingPref() {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  async function setPref(listingId: number, action: "dismiss" | "protect" | "unprotect") {
    setPending(listingId);
    try {
      const res = await fetch("/api/shop/listing-pref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, action }),
      });
      if (res.ok) router.refresh();
    } finally {
      setPending(null);
    }
  }
  return { setPref, pending };
}

const linkBtn =
  "text-[12.5px] font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline disabled:opacity-50";

function ConnectShop({ canEdit, onCancel, current, free }: { canEdit: boolean; onCancel?: () => void; current?: string; free?: boolean }) {
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
      <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-tint)] text-[var(--color-primary)]">
        <Store className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="font-display mt-4 text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
        {current ? "Switch shop" : free ? "Free shop check" : "Connect your Etsy shop"}
      </h2>
      <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">
        {free
          ? "Type your shop name. Mavya reads your public listings and shows what to fix first. No Etsy login, no card."
          : "Mavya checks every listing daily and tells you which ones to fix first. No Etsy login needed."}
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
          {busy ? "Reading your shop…" : free ? "Check my shop" : "Connect shop"}
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

/** A paid action shown to a free account: same words, leads to the plans page. */
function Unlock({ label, primary }: { label: string; primary?: boolean }) {
  return (
    <Link href="/subscribe" className={primary ? cn(btnPrimary, "min-h-[40px] px-4") : btnQuiet}>
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}

/** Free accounts see this where daily tracking would be. */
function UpgradeCard({ lastChecked }: { lastChecked: string | null }) {
  const next = lastChecked ? shortDate(addDaysUtc(lastChecked, FREE_CHECK_EVERY_DAYS)) : null;
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="upgrade">
      <h3 id="upgrade" className={sectionTitle}>
        See what happens after you fix it
      </h3>
      <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
        Paid plans check your shop every day: a views chart that fills in, which listings are rising or falling, and whether each change you make was followed by more views. Plus AI rewrites and photo fixes.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/subscribe" className={btnPrimary}>
          Start tracking daily
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        {next && <span className="text-[13px] text-[var(--color-ink-muted)]">Your free check refreshes on {next}.</span>}
      </div>
    </section>
  );
}

export function ShopHome({ data, canEdit, free = false }: { data: ShopHomeData | null; canEdit: boolean; free?: boolean }) {
  const [switching, setSwitching] = useState(false);
  const { open, busy, error } = useOpenListing(data?.opened ?? {});
  const { setPref, pending } = useListingPref();
  if (!data) {
    return (
      <p className={cn(card, "p-6 text-[15px] text-[var(--color-ink-muted)]")}>
        Shop tracking is unavailable right now. Your listings below still work.
      </p>
    );
  }
  if (!data.shop) return <ConnectShop canEdit={canEdit || free} free={free} />;
  if (switching) return <ConnectShop canEdit={canEdit || free} free={free} current={data.shop.name} onCancel={() => setSwitching(false)} />;

  const v = data.view;
  const checked = data.shop.lastCheckedOn ? `Checked ${shortDate(data.shop.lastCheckedOn)}` : "First check pending";
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-[30px] leading-tight text-[var(--color-ink)]">{data.shop.name}</h2>
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
        <button type="button" onClick={() => setSwitching(true)} className={btnGhost} disabled={!canEdit && !free}>
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
          {!free && v.historyDays >= MIN_HISTORY_DAYS && <ThisWeek v={v} />}

          {v.shopWide && (
            <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="shopwide">
              <h3 id="shopwide" className={sectionTitle}>
                {v.shopWide.none === v.shopWide.count
                  ? `${v.shopWide.count} of your ${v.shopWide.total} listings have no tags`
                  : `${v.shopWide.count} of your ${v.shopWide.total} listings use 6 tags or fewer`}
              </h3>
              <p className="mt-0.5 text-[13.5px] text-[var(--color-ink)]">
                Each listing gets 13 free tags, and each one is another search it can show up in. Start with your most viewed:
              </p>
              <ol className="mt-2 divide-y divide-[var(--color-border-soft)]">
                {v.shopWide.start.map((f, i) => (
                  <li key={f.listingId} className="flex items-center gap-3 py-3">
                    <Thumb url={f.mainImageUrl} />
                    <p className="min-w-0 flex-1 truncate text-[15px] text-[var(--color-ink)]">{f.title}</p>
                    {free ? (
                      <Unlock label="Add tags" primary={i === 0} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => open(f.listingId, "write")}
                        disabled={busy !== null || !canEdit}
                        className={i === 0 ? cn(btnPrimary, "min-h-[40px] px-4") : btnQuiet}
                      >
                        {busy === f.listingId ? "Opening..." : "Add tags"}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="fix3">
            <h3 id="fix3" className={sectionTitle}>
              {v.fixQueue.length ? `Fix these ${v.fixQueue.length} first` : "Fix first"}
            </h3>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Biggest gaps on your most seen listings. Fix it in Mavya, then paste into Etsy.</p>
            {v.fixQueue.length === 0 ? (
              <p className="mt-3 flex items-center gap-2 text-[14px] text-[var(--color-strong)]">
                <Check className="h-4 w-4" aria-hidden="true" /> Nothing urgent. Check back tomorrow.
              </p>
            ) : (
              <ol className="mt-2 divide-y divide-[var(--color-border-soft)]">
                {v.fixQueue.map((f, i) => (
                  <li key={f.listingId} className="flex items-center gap-3 py-3">
                    <Thumb url={f.mainImageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-[var(--color-ink)]">{f.title}</p>
                      <p className="text-[13.5px] text-[var(--color-ink)]">{f.todo}</p>
                      {canEdit && (
                        <p className="mt-1 flex gap-3">
                          <button type="button" className={linkBtn} disabled={pending !== null} onClick={() => void setPref(f.listingId, "dismiss")}>
                            Not now
                          </button>
                          <button type="button" className={linkBtn} disabled={pending !== null} onClick={() => void setPref(f.listingId, "protect")} title="Mavya will stop suggesting changes to this listing">
                            Don&apos;t touch, it works
                          </button>
                        </p>
                      )}
                    </div>
                    {free ? (
                      <Unlock label={f.button} primary={i === 0} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => open(f.listingId, f.action)}
                        disabled={busy !== null || !canEdit}
                        className={i === 0 ? cn(btnPrimary, "min-h-[40px] px-4") : btnQuiet}
                      >
                        {busy === f.listingId ? "Opening..." : f.button}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
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

          {free ? (
            <UpgradeCard lastChecked={data.shop.lastCheckedOn} />
          ) : (
            <>
              {data.shop.lastCheckedOn && <MetricChart title="Shop views" points={v.daily} endDate={data.shop.lastCheckedOn} />}
              {v.historyDays < MIN_HISTORY_DAYS ? <TrendsProgress days={v.historyDays} lastChecked={data.shop.lastCheckedOn} /> : <StatusTiles v={v} />}
            </>
          )}

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

          {!free && v.changes.length > 0 && <ChangesSummary v={v} />}

          <Link href="/dashboard/shop" className="inline-flex items-center gap-1 self-start text-[14px] font-semibold text-[var(--color-ink)] hover:underline">
            See all {v.listings.length} listings <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </>
      )}
    </div>
  );
}

type View = NonNullable<ShopHomeData["view"]>;

/** Once trends exist: the week in three lines, before any detail. */
function ThisWeek({ v }: { v: View }) {
  const pctText = (r: number) => `${r >= 1 ? "+" : ""}${Math.round((r - 1) * 100)}%`;
  const rising = v.listings.filter((l) => l.status === "rising" && l.trendRatio !== null).sort((a, b) => (b.trendRatio ?? 0) - (a.trendRatio ?? 0)).slice(0, 3);
  const falling = v.listings.filter((l) => l.status === "falling" && l.trendRatio !== null).sort((a, b) => (a.trendRatio ?? 0) - (b.trendRatio ?? 0)).slice(0, 3);
  const measured = v.summary.measured;
  if (!rising.length && !falling.length && !measured) return null;
  const row = (label: string, list: typeof rising, cls: string) =>
    list.length > 0 && (
      <li className="py-2.5">
        <p className="text-[13px] font-semibold text-[var(--color-ink-muted)]">{label}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {list.map((l) => (
            <li key={l.listingId} className="flex items-center justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate text-[var(--color-ink)]">{l.title}</span>
              <span className={cn("flex-shrink-0 font-semibold tabular-nums", cls)}>{pctText(l.trendRatio as number)}</span>
            </li>
          ))}
        </ul>
      </li>
    );
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="thisweek">
      <h3 id="thisweek" className={sectionTitle}>
        This week
      </h3>
      <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">Last 7 days compared with the 4 weeks before.</p>
      <ul className="mt-1 divide-y divide-[var(--color-border-soft)]">
        {row("Rising", rising, "text-[var(--color-strong)]")}
        {row("Falling", falling, "text-[var(--color-weak)]")}
        {measured > 0 && (
          <li className="py-2.5 text-[14px] text-[var(--color-ink)]">
            Your changes: {v.summary.better} of {measured} measured look better.
          </li>
        )}
      </ul>
    </section>
  );
}

function Thumb({ url, small }: { url: string | null; small?: boolean }) {
  return (
    <span className={cn("flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]", small ? "h-10 w-10" : "h-12 w-12")}>
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
    <section aria-label="This week in your shop" className={cn(card, "grid grid-cols-2 overflow-hidden sm:grid-cols-4 [&>*]:border-[var(--color-border-soft)] [&>*:nth-child(odd)]:border-r sm:[&>*]:border-r sm:[&>*:last-child]:border-r-0 [&>*:nth-child(-n+2)]:border-b sm:[&>*]:border-b-0")}>
      {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => (
        <Link key={k} href={`/dashboard/shop?filter=${k}`} className="block p-4 transition-colors hover:bg-[var(--color-page)]">
          <p className={cn("text-[26px] font-bold leading-none tabular-nums", v.counts[k] ? STATUS_META[k].cls : "text-[var(--color-ink-soft)]")}>{v.counts[k]}</p>
          <p className="mt-2 text-[14px] font-semibold text-[var(--color-ink)]">{STATUS_META[k].label}</p>
          <p className="text-[12.5px] text-[var(--color-ink-muted)]">{STATUS_META[k].hint}</p>
        </Link>
      ))}
    </section>
  );
}

const VERDICT_LABEL = { better: "Better", worse: "Worse", no_change: "No clear change", measuring: "Measuring", not_enough_data: "Can't measure", interrupted: "Changed again" } as const;
const VERDICT_CLS = {
  interrupted: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
  better: "bg-[var(--color-strong-soft)] text-[var(--color-strong)]",
  worse: "bg-[var(--color-weak-soft)] text-[var(--color-weak)]",
  no_change: "bg-[var(--color-page-deep)] text-[var(--color-ink-muted)]",
  measuring: "bg-[var(--color-mid-soft)] text-[#8A5A12]",
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
                {c.verdict === "better" && c.wasFalling && " · it was falling before, so part of this may be a natural bounce"}
                {c.verdict === "no_change" && c.liftLow !== null && c.liftHigh !== null &&
                  ` · likely between ${c.liftLow >= 1 ? "+" : ""}${Math.round((c.liftLow - 1) * 100)}% and ${c.liftHigh >= 1 ? "+" : ""}${Math.round((c.liftHigh - 1) * 100)}%`}
              </p>
            </div>
            <span className={cn("flex-shrink-0 rounded-[var(--radius-md)] px-2.5 py-1 text-[12.5px] font-semibold", VERDICT_CLS[c.verdict])}>{VERDICT_LABEL[c.verdict]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-[var(--color-ink-soft)]">Compared with the rest of your shop over the same days. Shows what changed after, not why.</p>
    </section>
  );
}

type SortKey = "total" | "perDay" | "favorites" | "trend" | "tags" | "photos";
type Row = View["listings"][number];

const SORTS: { key: SortKey; label: string; desc: string }[] = [
  { key: "total", label: "Total views", desc: "Most viewed first" },
  { key: "perDay", label: "Views/day", desc: "Most views a day first" },
  { key: "favorites", label: "Favorites", desc: "Most favorited first" },
  { key: "trend", label: "Trend", desc: "Rising first" },
  { key: "tags", label: "Tags", desc: "Fewest tags first" },
  { key: "photos", label: "Photos", desc: "Fewest photos first" },
];

/** Views/day for a row: real last-7-days once known, else the all-time average. */
function perDay(l: Row): { value: number | null; avg: boolean } {
  if (l.viewsPerDay !== null && l.trendDays >= 3) return { value: l.viewsPerDay, avg: false };
  return { value: l.avgPerDay, avg: l.avgPerDay !== null };
}

function sortValue(l: Row, key: SortKey): number {
  const none = Number.NEGATIVE_INFINITY;
  switch (key) {
    case "total":
      return l.totalViews ?? none;
    case "perDay":
      return perDay(l).value ?? none;
    case "favorites":
      return l.totalFavorites ?? none;
    case "trend":
      return l.trendRatio ?? none;
    case "tags":
      return -l.tagsUsed;
    case "photos":
      return -(l.imageCount ?? 99);
  }
}

function TrendCell({ l }: { l: Row }) {
  if (l.trendDays < MIN_HISTORY_DAYS) {
    return <span className="text-[12.5px] text-[var(--color-ink-soft)]">Day {l.trendDays || 1} of {MIN_HISTORY_DAYS}</span>;
  }
  if (l.trendRatio === null) return <span className="text-[12.5px] text-[var(--color-ink-soft)]">–</span>;
  const pct = Math.round((l.trendRatio - 1) * 100);
  const cls = pct >= 15 ? "text-[var(--color-strong)]" : pct <= -15 ? "text-[var(--color-weak)]" : "text-[var(--color-ink-muted)]";
  return <span className={cn("text-[13px] font-semibold tabular-nums", cls)}>{pct > 0 ? `+${pct}%` : `${pct}%`}</span>;
}

/** Full list of tracked listings: sortable columns and an optional status filter. */
export function ShopListings({ data, filter, canEdit, free = false }: { data: ShopHomeData; filter: string | null; canEdit: boolean; free?: boolean }) {
  const { open, busy, error } = useOpenListing(data.opened);
  const { setPref, pending } = useListingPref();
  const [sort, setSort] = useState<SortKey>("total");
  const v = data.view;
  if (!data.shop || !v) return <ConnectShop canEdit={canEdit || free} free={free} />;
  const filtered = filter && filter in STATUS_META ? v.listings.filter((l) => l.status === filter) : v.listings;
  const rows = [...filtered].sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || (b.totalViews ?? 0) - (a.totalViews ?? 0));
  const trendsReady = v.historyDays >= MIN_HISTORY_DAYS;
  const chips: { key: string | null; label: string }[] = [
    { key: null, label: `All ${v.listings.length}` },
    ...(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => ({ key: k, label: `${STATUS_META[k].label} ${trendsReady || k === "dead" ? v.counts[k] : ""}`.trim() })),
  ];
  const head = (key: SortKey, label: string, cls: string) => (
    <th scope="col" aria-sort={sort === key ? "descending" : "none"} className={cn("px-2 py-2 text-right font-medium", cls)}>
      <button
        type="button"
        onClick={() => setSort(key)}
        className={cn("inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5 hover:text-[var(--color-ink)]", sort === key && "text-[var(--color-ink)]")}
      >
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5", sort === key ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      </button>
    </th>
  );
  return (
    <div className="flex flex-col gap-5">
      {free ? (
        <UpgradeCard lastChecked={data.shop.lastCheckedOn} />
      ) : (
        data.shop.lastCheckedOn && <MetricChart title="Shop views" points={v.daily} endDate={data.shop.lastCheckedOn} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <Link
              key={c.label}
              href={c.key ? `/dashboard/shop?filter=${c.key}` : "/dashboard/shop"}
              aria-current={(filter ?? null) === c.key ? "page" : undefined}
              className={cn(
                "rounded-[var(--radius-md)] border px-3 py-1.5 text-[13px] font-semibold",
                (filter ?? null) === c.key ? "border-[var(--color-neutral-dark)] bg-[var(--color-neutral-dark)] text-white" : "border-[var(--color-border)] bg-white text-[var(--color-ink)]"
              )}
            >
              {c.label}
            </Link>
          ))}
        </nav>
        <label className="flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)] md:hidden">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="min-h-[36px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2 text-[13px] font-semibold text-[var(--color-ink)]"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.desc}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!trendsReady && (
        <p className="-mt-2 text-[13px] text-[var(--color-ink-muted)]">
          {`Rising and falling need ${MIN_HISTORY_DAYS} days of daily numbers (day ${v.historyDays} now). `}Views/day marked &quot;avg&quot; is all-time views divided by days live.
        </p>
      )}

      <section className={cn(card, "overflow-hidden")}>
        <table className="w-full table-fixed text-[14px]">
          <thead className="border-b border-[var(--color-border-soft)] text-[12px] text-[var(--color-ink-soft)]">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">
                Listing
              </th>
              {head("total", "Total views", "hidden w-[108px] md:table-cell")}
              {head("perDay", "Views/day", "w-[92px] sm:w-[104px]")}
              {head("favorites", "Favorites", "hidden w-[96px] lg:table-cell")}
              {head("trend", "Trend", "hidden w-[104px] md:table-cell")}
              {head("tags", "Tags", "hidden w-[72px] md:table-cell")}
              {head("photos", "Photos", "hidden w-[80px] lg:table-cell")}
              <th scope="col" className="w-[96px] px-3 py-2 sm:w-[108px] sm:px-4">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-soft)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-[14px] text-[var(--color-ink-muted)]">
                  No listings here right now.
                </td>
              </tr>
            ) : (
              rows.map((l) => {
                const pd = perDay(l);
                const problem = [...l.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1))[0];
                return (
                  <tr key={l.listingId} className="align-middle">
                    <td className="px-4 py-2.5 sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <Thumb url={l.mainImageUrl} small />
                        <div className="min-w-0">
                          <p className="truncate text-[14px] text-[var(--color-ink)]">{l.title}</p>
                          {l.protected && (
                            <p className="text-[12px] text-[var(--color-ink-muted)]">
                              Protected: no fix suggestions.{" "}
                              {canEdit && (
                                <button type="button" className={linkBtn} disabled={pending !== null} onClick={() => void setPref(l.listingId, "unprotect")}>
                                  Undo
                                </button>
                              )}
                            </p>
                          )}
                          {(l.spark.some((x) => x !== null) || l.status in STATUS_META || problem) && (
                            <div className="mt-0.5 flex items-center gap-2">
                              {l.spark.some((x) => x !== null) && <Sparkline values={l.spark} />}
                              {l.status in STATUS_META ? (
                                <span className="truncate text-[12px] text-[var(--color-ink-muted)]">{STATUS_META[l.status as keyof typeof STATUS_META].label}</span>
                              ) : (
                                problem && <span className="truncate text-[12px] text-[var(--color-ink-muted)] md:hidden">{problem.text}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-2 text-right tabular-nums text-[var(--color-ink)] md:table-cell">{fmt(l.totalViews)}</td>
                    <td className="px-2 text-right tabular-nums text-[var(--color-ink)]">
                      {fmt(pd.value)}
                      {pd.avg && <span className="ml-1 text-[11px] text-[var(--color-ink-soft)]">avg</span>}
                    </td>
                    <td className="hidden px-2 text-right tabular-nums text-[var(--color-ink)] lg:table-cell">{fmt(l.totalFavorites)}</td>
                    <td className="hidden px-2 text-right md:table-cell">
                      <TrendCell l={l} />
                    </td>
                    <td className={cn("hidden px-2 text-right tabular-nums md:table-cell", l.tagsUsed === 0 ? "font-semibold text-[var(--color-weak)]" : "text-[var(--color-ink)]")}>{l.tagsUsed}/13</td>
                    <td className="hidden px-2 text-right tabular-nums text-[var(--color-ink)] lg:table-cell">{l.imageCount ?? "–"}</td>
                    <td className="px-3 text-right sm:px-4">
                      {free ? (
                        <Link href="/subscribe" aria-label="Open (paid plans)" className={cn(btnQuiet, "min-h-[36px] px-3")}>
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          Open
                        </Link>
                      ) : (
                        <button type="button" onClick={() => open(l.listingId, "analytics")} disabled={busy !== null || !canEdit} className={cn(btnQuiet, "min-h-[36px] px-3")}>
                          {busy === l.listingId ? "..." : "Open"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
      {error && (
        <p role="alert" className="text-[13.5px] text-[var(--color-weak)]">
          {error}
        </p>
      )}
    </div>
  );
}
