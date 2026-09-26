"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, ChevronRight, ChevronsUpDown, Clock, Eye, Heart, LayoutList, Lock, Percent, RefreshCw, Search, SlidersHorizontal, Store } from "lucide-react";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { cn } from "@/lib/utils";
import { MIN_HISTORY_DAYS, type FixAction, type ShopStatus } from "@/lib/shop-analytics";
import type { ShopHomeData } from "@/lib/shop-monitor";
import { FREE_CHECK_EVERY_DAYS } from "@/lib/plans";

// Same flat, single-column language as the listing tabs.
const card = "min-w-0 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white";
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
  const [error, setError] = useState<string | null>(null);
  async function setPref(listingId: number, action: "dismiss" | "protect" | "unprotect") {
    setPending(listingId);
    setError(null);
    try {
      const res = await fetch("/api/shop/listing-pref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, action }),
      });
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save your preference. Try again.");
      }
    } catch {
      setError("Could not save your preference. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }
  return { setPref, pending, error };
}

function RefreshShop({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: name }) });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Check failed. Try again shortly.");
      else router.refresh();
    } catch { setError("Check failed. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <div>
    <button type="button" className={btnQuiet} disabled={busy} onClick={() => void refresh()}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" />{busy ? "Checking..." : "Check shop again"}
    </button>
    {error && <p role="alert" className="mt-2 text-[14px] text-[var(--color-weak)]">{error}</p>}
  </div>;
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
  const { setPref, pending, error: prefError } = useListingPref();
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[var(--color-ink)]">{data.shop.name}</h2>
          <p className="text-[13.5px] text-[var(--color-ink-muted)]">
            {v ? `${v.listings.length} listings tracked · ` : ""}
            {checked}
          </p>
          {v && data.shop.activeListings != null && v.listings.length < data.shop.activeListings && (
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              {free ? `Showing ${v.listings.length} listings selected from up to 500 checked items.` : `Tracking your ${v.listings.length} most viewed of ${data.shop.activeListings} listings.`}
            </p>
          )}
        </div>
        <button type="button" onClick={() => setSwitching(true)} className={btnQuiet} disabled={!canEdit && !free}>
          Switch shop
        </button>
      </header>

      {prefError && <p role="alert" className="text-[14px] text-[var(--color-weak)]">{prefError}</p>}
      {(free || data.shop.lastError || !v) && (free || canEdit) && <RefreshShop name={data.shop.name} />}

      {!v ? (
        <p className={cn(card, "p-6 text-[15px] text-[var(--color-ink-muted)]")}>
          {data.shop.lastError ? "The last check did not finish. Try the shop check again." : "First shop check pending."}
        </p>
      ) : (
        <>
          <ShopNumbers v={v} />

          <div className="grid items-start gap-5 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          {v.shopWide && (
            <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="shopwide">
              <h3 id="shopwide" className={sectionTitle}>
                {v.shopWide.none === v.shopWide.count
                  ? `${v.shopWide.count} of your ${v.shopWide.total} listings have no tags`
                  : `${v.shopWide.count} of your ${v.shopWide.total} listings use 6 tags or fewer`}
              </h3>
              <p className="mt-0.5 text-[13.5px] text-[var(--color-ink)]">
                {v.shopWide.start.length ? "Each listing has 13 tag slots. Start with these listings:" : "No suggestions right now. Your saved preferences are being respected."}
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
                      <Unlock label={f.button} primary={i === 0 && !v.shopWide} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => open(f.listingId, f.action)}
                        disabled={busy !== null || !canEdit}
                        className={i === 0 && !v.shopWide ? cn(btnPrimary, "min-h-[40px] px-4") : btnQuiet}
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
          </div>
          <div className="flex min-w-0 flex-col gap-5">
          {!free && v.historyDays >= MIN_HISTORY_DAYS && <ThisWeek v={v} />}
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

          </div>
          </div>

          {free ? (
            <UpgradeCard lastChecked={data.shop.lastCheckedOn} />
          ) : (
            <>
              {data.shop.lastCheckedOn && <MetricChart title="Shop views" points={v.daily} endDate={data.shop.lastCheckedOn} />}
              {v.historyDays < MIN_HISTORY_DAYS ? <TrendsProgress days={v.historyDays} lastChecked={data.shop.lastCheckedOn} /> : <StatusTiles v={v} />}
            </>
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
  const noTags = v.listings.filter((l) => l.tagsUsed === 0).length;
  const cells = [
    { label: "Views", Icon: Eye, value: fmt(v.totals.views), sub: "All time, from Etsy" },
    { label: "Favorites", Icon: Heart, value: fmt(v.totals.favorites), sub: "All time, from Etsy" },
    { label: "Favorites per 100 views", Icon: Percent, value: rate === null ? "–" : rate.toFixed(1), sub: "How often viewers save it" },
    { label: "Listings tracked", Icon: LayoutList, value: String(v.listings.length), sub: noTags ? `${noTags} with no tags` : "All have tags" },
  ];
  return (
    <section aria-label="Shop numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className={cn(card, "min-w-0 p-4 sm:p-5")}>
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)]">
            <c.Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{c.label}</span>
          </p>
          <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--color-ink)] sm:text-[30px]">{c.value}</p>
          <p className="mt-2 truncate text-[12.5px] text-[var(--color-ink-muted)]">{c.sub}</p>
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

const VERDICT_LABEL = { better: "Better", worse: "Worse", no_change: "Too close to call", measuring: "Measuring", not_enough_data: "Can't tell", interrupted: "Changed again" } as const;
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
                {(c.verdict === "better" || c.verdict === "worse") && c.lift !== null &&
                  ` · about ${c.lift >= 1 ? "+" : ""}${Math.round((c.lift - 1) * 100)}% compared with your other listings`}
                {c.verdict === "better" && c.wasFalling && ". It was falling before, so part of this may be a natural bounce"}
                {c.verdict === "no_change" && c.liftLow !== null && c.liftHigh !== null &&
                  ` · somewhere between ${c.liftLow >= 1 ? "+" : ""}${Math.round((c.liftLow - 1) * 100)}% and ${c.liftHigh >= 1 ? "+" : ""}${Math.round((c.liftHigh - 1) * 100)}% compared with your other listings`}
                {c.verdict === "not_enough_data" && " · your other listings got too few views to compare with"}
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

type SortKey = "score" | "recs" | "sugs" | "total" | "perDay" | "favorites" | "trend";
type Row = View["listings"][number];
type ExtraCol = "total" | "perDay" | "favorites" | "trend";
const EXTRA_COLS: { key: ExtraCol; label: string }[] = [
  { key: "total", label: "Total views" },
  { key: "perDay", label: "Views/day" },
  { key: "favorites", label: "Favorites" },
  { key: "trend", label: "Trend" },
];
const COLS_KEY = "mavya.listings.cols";

/** Views/day for a row: real last-7-days once known, else the all-time average. */
function perDay(l: Row): { value: number | null; avg: boolean } {
  if (l.viewsPerDay !== null && l.trendDays >= 3) return { value: l.viewsPerDay, avg: false };
  return { value: l.avgPerDay, avg: l.avgPerDay !== null };
}

/** Higher = listed first. Score and counts put the listings needing work first. */
function sortValue(l: Row, key: SortKey): number {
  const none = Number.NEGATIVE_INFINITY;
  switch (key) {
    case "score":
      return -l.check.score;
    case "recs":
      return l.check.recommendations;
    case "sugs":
      return l.check.suggestions;
    case "total":
      return l.totalViews ?? none;
    case "perDay":
      return perDay(l).value ?? none;
    case "favorites":
      return l.totalFavorites ?? none;
    case "trend":
      return l.trendRatio ?? none;
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

/** Score colors: under 50 needs work, 50-79 okay, 80+ good. */
export function scoreTone(score: number) {
  return score >= 80
    ? { fg: "var(--color-strong)", bg: "var(--color-strong-soft)" }
    : score >= 50
      ? { fg: "var(--color-mid)", bg: "var(--color-mid-soft)" }
      : { fg: "var(--color-weak)", bg: "var(--color-weak-soft)" };
}

export function ScoreChip({ score }: { score: number }) {
  const t = scoreTone(score);
  return (
    <span className="inline-flex h-[30px] min-w-[44px] items-center justify-center rounded-[var(--radius-md)] px-2 text-[14px] font-semibold tabular-nums" style={{ color: t.fg, background: t.bg }}>
      {score}
    </span>
  );
}

export function ScoreCircle({ score, size = 64 }: { score: number; size?: number }) {
  const t = scoreTone(score);
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center rounded-full font-semibold tabular-nums"
      style={{ width: size, height: size, color: t.fg, background: t.bg, fontSize: size * 0.34 }}
      aria-label={`Listing check score ${score} of 100`}
    >
      {score}
    </span>
  );
}

export function CountChip({ children }: { children: ReactNode }) {
  return <span className="rounded-[var(--radius-sm)] bg-[var(--color-page-deep)] px-2 py-1 text-[12px] font-semibold text-[var(--color-ink-muted)]">{children}</span>;
}

const longDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

type Band = "all" | "weak" | "okay" | "good";
const BANDS: { key: Band; label: string }[] = [
  { key: "all", label: "All listings" },
  { key: "weak", label: "Needs work (under 50)" },
  { key: "okay", label: "Okay (50 to 79)" },
  { key: "good", label: "Good (80 and up)" },
];

/**
 * All listings, laid out like a listing helper (2026-09-26): the shop's
 * overall checklist score up top, then every listing with its
 * recommendations, suggestions, and score. Views columns can be added back
 * from Display. The score measures Mavya's listing checklist, not sales.
 */
export function ShopListings({ data, filter, canEdit, free = false }: { data: ShopHomeData; filter: string | null; canEdit: boolean; free?: boolean }) {
  const { open, busy, error } = useOpenListing(data.opened);
  const { setPref, pending, error: prefError } = useListingPref();
  const [sort, setSort] = useState<SortKey>("score");
  const [query, setQuery] = useState("");
  const [band, setBand] = useState<Band>("all");
  const [menu, setMenu] = useState<"filter" | "display" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [extra, setExtra] = useState<Set<ExtraCol>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLS_KEY);
      // Restoring a per-viewer preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setExtra(new Set((JSON.parse(raw) as string[]).filter((c): c is ExtraCol => EXTRA_COLS.some((x) => x.key === c))));
    } catch {
      // Preference only.
    }
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const v = data.view;
  if (!data.shop || !v) return <ConnectShop canEdit={canEdit || free} free={free} />;

  const toggleExtra = (c: ExtraCol) => {
    const next = new Set(extra);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setExtra(next);
    try {
      window.localStorage.setItem(COLS_KEY, JSON.stringify([...next]));
    } catch {
      // Preference only.
    }
  };

  const q = query.trim().toLowerCase();
  const rows = v.listings
    .filter((l) => !filter || !(filter in STATUS_META) || l.status === filter)
    .filter((l) => band === "all" || (band === "weak" ? l.check.score < 50 : band === "okay" ? l.check.score >= 50 && l.check.score < 80 : l.check.score >= 80))
    .filter((l) => !q || l.title.toLowerCase().includes(q))
    .sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || (b.totalViews ?? 0) - (a.totalViews ?? 0));

  const shopScore = v.listings.length ? Math.round(v.listings.reduce((s, l) => s + l.check.score, 0) / v.listings.length) : 0;
  const recs = v.listings.reduce((s, l) => s + l.check.recommendations, 0);
  const sugs = v.listings.reduce((s, l) => s + l.check.suggestions, 0);
  const worst = [...v.listings].filter((l) => !l.protected).sort((a, b) => a.check.score - b.check.score)[0];
  const trendsReady = v.historyDays >= MIN_HISTORY_DAYS;

  const head = (key: SortKey, label: string, cls = "") => (
    <th scope="col" aria-sort={sort === key ? "descending" : "none"} className={cn("whitespace-nowrap px-3 py-3.5 text-center font-semibold", cls)}>
      <button type="button" onClick={() => setSort(key)} className={cn("inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-[var(--color-ink)]", sort === key && "text-[var(--color-ink)]")}>
        {label}
        <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-border)] pb-5">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Listing optimization</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">Listing Helper</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data.shop.lastCheckedOn && (
            <span className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--color-ink-muted)]">
              <Clock className="h-4 w-4" aria-hidden="true" /> Updated {longDate(data.shop.lastCheckedOn)}
            </span>
          )}
          <Link href="/dashboard" className={cn(btnQuiet, "min-h-[42px] px-4 text-[14px]")}>
            Shop overview
          </Link>
          {free ? (
            <Unlock label="Fix listings" primary />
          ) : (
            worst && (
              <button type="button" onClick={() => open(worst.listingId, "write")} disabled={busy !== null || !canEdit} className={cn(btnPrimary, "min-h-[42px]")}>
                {busy === worst.listingId ? "Opening..." : "Fix lowest score"}
              </button>
            )
          )}
        </div>
      </header>
      {prefError && <p role="alert" className="text-[14px] text-[var(--color-weak)]">{prefError}</p>}
      {free && <UpgradeCard lastChecked={data.shop.lastCheckedOn} />}

      <section className={card}>
        <div className="flex items-center gap-4 p-5 sm:p-6">
          <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] bg-[var(--color-page)] text-[22px] font-semibold text-[var(--color-ink-muted)]">
            {data.shop.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[20px] font-semibold text-[var(--color-ink)]">{data.shop.name}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <CountChip>{recs.toLocaleString("en-US")} Recommendations</CountChip>
              <CountChip>{sugs.toLocaleString("en-US")} Suggestions</CountChip>
              <CountChip>{v.listings.length.toLocaleString("en-US")} Listings</CountChip>
            </div>
          </div>
          <ScoreCircle score={shopScore} />
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide shop views" : "Show shop views"}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink-muted)] hover:bg-[var(--color-page)] hover:text-[var(--color-ink)]"
          >
            <ChevronDown className={cn("h-5 w-5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
        {expanded && (
          <div className="border-t border-[var(--color-border-soft)] p-5 sm:p-6">
            <p className="mb-3 text-[13px] text-[var(--color-ink-muted)]">
              Shop score is the average of every listing&apos;s checklist score (title, tags, description, photos). It measures the checklist, not sales.
            </p>
            {data.shop.lastCheckedOn && !free && <MetricChart title="Shop views" points={v.daily} endDate={data.shop.lastCheckedOn} />}
          </div>
        )}
      </section>

      <section className={cn(card, "overflow-visible")}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border-soft)] px-4 py-3.5 sm:px-6">
          <label className="flex min-w-[200px] flex-1 items-center gap-2.5">
            <Search className="h-4.5 w-4.5 text-[var(--color-ink-soft)]" aria-hidden="true" />
            <span className="sr-only">Search listings</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full bg-transparent text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)]"
            />
          </label>
          <div className="relative flex items-center gap-2" ref={menuRef}>
            <button type="button" onClick={() => setMenu(menu === "filter" ? null : "filter")} aria-expanded={menu === "filter"} className={cn(btnQuiet, "min-h-[38px] px-3.5 text-[14px]")}>
              Filter <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setMenu(menu === "display" ? null : "display")} aria-expanded={menu === "display"} className={cn(btnQuiet, "min-h-[38px] px-3.5 text-[14px]")}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Display
            </button>
            {menu === "filter" && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[240px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-1.5 shadow-[var(--shadow-soft-strong)]">
                <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-[var(--color-ink-soft)]">Score</p>
                {BANDS.map((b) => (
                  <button key={b.key} type="button" onClick={() => { setBand(b.key); setMenu(null); }} className={cn("flex w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left text-[14px] hover:bg-[var(--color-page)]", band === b.key ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]")}>
                    {b.label}
                  </button>
                ))}
                <p className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-[var(--color-ink-soft)]">Views {trendsReady ? "" : `(after ${MIN_HISTORY_DAYS} days)`}</p>
                <Link href="/dashboard/shop" className={cn("flex rounded-[var(--radius-md)] px-2.5 py-2 text-[14px] hover:bg-[var(--color-page)]", !filter ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]")}>
                  Any
                </Link>
                {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => (
                  <Link key={k} href={`/dashboard/shop?filter=${k}`} className={cn("flex justify-between rounded-[var(--radius-md)] px-2.5 py-2 text-[14px] hover:bg-[var(--color-page)]", filter === k ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]")}>
                    {STATUS_META[k].label}
                    {(trendsReady || k === "dead") && <span className="tabular-nums text-[var(--color-ink-soft)]">{v.counts[k]}</span>}
                  </Link>
                ))}
              </div>
            )}
            {menu === "display" && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[220px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-1.5 shadow-[var(--shadow-soft-strong)]">
                <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-[var(--color-ink-soft)]">Also show</p>
                {EXTRA_COLS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[14px] text-[var(--color-ink)] hover:bg-[var(--color-page)]">
                    <input type="checkbox" checked={extra.has(c.key)} onChange={() => toggleExtra(c.key)} className="h-4 w-4 accent-[var(--color-primary)]" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-[15px]">
            <thead className="border-b border-[var(--color-border-soft)] text-[12px] text-[var(--color-ink-muted)]">
              <tr>
                <th scope="col" className="px-4 py-3.5 text-left font-semibold uppercase tracking-[0.06em] sm:px-6">
                  Listing
                </th>
                {extra.has("total") && head("total", "Views", "w-[110px]")}
                {extra.has("perDay") && head("perDay", "Views/day", "w-[120px]")}
                {extra.has("favorites") && head("favorites", "Favorites", "w-[120px]")}
                {extra.has("trend") && head("trend", "Trend", "w-[120px]")}
                {head("recs", "Recommendations", "w-[170px]")}
                {head("sugs", "Suggestions", "w-[140px]")}
                {head("score", "Score", "w-[110px] pr-4 sm:pr-6")}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-soft)]">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-[14px] text-[var(--color-ink-muted)]">
                    No listings match.
                  </td>
                </tr>
              ) : (
                rows.map((l) => {
                  const pd = perDay(l);
                  const openRow = () => {
                    if (free || !canEdit || busy !== null) return;
                    void open(l.listingId, "write");
                  };
                  return (
                    <tr
                      key={l.listingId}
                      onClick={openRow}
                      className={cn("align-middle transition-colors", !free && canEdit && "cursor-pointer hover:bg-[var(--color-page)]", busy === l.listingId && "opacity-60")}
                    >
                      <td className="px-4 py-3.5 sm:px-6">
                        <div className="flex min-w-0 items-center gap-3.5">
                          <Thumb url={l.mainImageUrl} small />
                          <div className="min-w-0">
                            {free ? (
                              <p className="truncate text-[15px] text-[var(--color-ink)]">{l.title}</p>
                            ) : (
                              <button type="button" onClick={(e) => { e.stopPropagation(); openRow(); }} className="block max-w-full truncate text-left text-[15px] text-[var(--color-ink)] hover:underline">
                                {l.title}
                              </button>
                            )}
                            <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-[var(--color-ink-soft)]">
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                              {longDate(l.createdOn) ?? "Listed date not known yet"}
                              {l.protected && (
                                <span className="ml-2 text-[var(--color-ink-muted)]">
                                  Protected.{" "}
                                  {canEdit && (
                                    <button type="button" className={linkBtn} disabled={pending !== null} onClick={(e) => { e.stopPropagation(); void setPref(l.listingId, "unprotect"); }}>
                                      Undo
                                    </button>
                                  )}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      {extra.has("total") && <td className="px-3 text-center tabular-nums text-[var(--color-ink)]">{fmt(l.totalViews)}</td>}
                      {extra.has("perDay") && (
                        <td className="px-3 text-center tabular-nums text-[var(--color-ink)]">
                          {fmt(pd.value)}
                          {pd.avg && <span className="ml-1 text-[11px] text-[var(--color-ink-soft)]">avg</span>}
                        </td>
                      )}
                      {extra.has("favorites") && <td className="px-3 text-center tabular-nums text-[var(--color-ink)]">{fmt(l.totalFavorites)}</td>}
                      {extra.has("trend") && (
                        <td className="px-3 text-center">
                          <TrendCell l={l} />
                        </td>
                      )}
                      <td className="px-3 text-center tabular-nums text-[var(--color-ink)]">{l.check.recommendations}</td>
                      <td className="px-3 text-center tabular-nums text-[var(--color-ink)]">{l.check.suggestions}</td>
                      <td className="py-3.5 pl-3 pr-4 text-center sm:pr-6">
                        <ScoreChip score={l.check.score} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {free && (
          <p className="flex items-center gap-1.5 border-t border-[var(--color-border-soft)] px-6 py-3 text-[13px] text-[var(--color-ink-muted)]">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Opening a listing and fixing it is on paid plans.
          </p>
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
