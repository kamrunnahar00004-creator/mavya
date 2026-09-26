import Link from "next/link";
import { ArrowRight, ExternalLink, Lock, Search, Sparkles, Store, TrendingUp, Tag, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeywordResearch } from "@/lib/keyword-research";

/**
 * Keyword research screen. Server-rendered: the search box is a plain GET
 * form, so it works without JavaScript and every search has its own URL.
 */

const card = "min-w-0 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]";
const chip =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]";
const n = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1).replace(/\.0$/, ""));
const money = (cents: number | null, currency: string | null) =>
  cents === null ? "–" : new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 0 }).format(cents / 100);
const href = (q: string, valid?: boolean) => `/dashboard/keywords?q=${encodeURIComponent(q)}${valid ? "&valid=1" : ""}`;

function SearchBox({ q, big }: { q?: string; big?: boolean }) {
  return (
    <form action="/dashboard/keywords" method="get" role="search" className={cn("flex w-full items-center gap-2", big ? "max-w-[720px]" : "max-w-[560px]")}>
      <label className="relative flex-1">
        <span className="sr-only">Search phrase</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-[var(--color-ink-soft)]" aria-hidden="true" />
        <input
          name="q"
          defaultValue={q}
          maxLength={80}
          autoFocus={big}
          placeholder="Search a keyword buyers type, like sticker pack"
          className={cn(
            "w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white pl-11 pr-4 text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-ink)]",
            big ? "min-h-[56px] text-[16px] shadow-[var(--shadow-soft)]" : "min-h-[44px] text-[15px]"
          )}
        />
      </label>
      <button type="submit" className={cn(btnPrimary, big && "min-h-[56px] px-6")}>
        Search <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}

export function KeywordResearchView({
  q,
  research,
  error,
  locked,
  suggestions,
  validOnly,
}: {
  q: string | null;
  research: KeywordResearch | null;
  error: string | null;
  locked: boolean;
  suggestions: string[];
  validOnly: boolean;
}) {
  if (!q || locked) {
    return (
      <div className="mx-auto flex max-w-[860px] flex-col items-center px-4 pt-16 text-center sm:pt-24">
        <h1 className="text-[34px] font-semibold tracking-[-0.02em] text-[var(--color-ink)] sm:text-[40px]">Keyword research</h1>
        <p className="mt-2 max-w-[52ch] text-[15px] text-[var(--color-ink-muted)]">
          Live numbers from Etsy for any phrase: how many listings compete, how busy the top ones are, and the tags they use.
        </p>
        {locked ? (
          <div className={cn(card, "mt-8 w-full max-w-[560px] p-6 text-left")}>
            <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
              <Lock className="h-4 w-4" aria-hidden="true" /> Keyword research is on paid plans
            </p>
            <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">Search any phrase and see real Etsy competition, top listings, and the tags they use.</p>
            <Link href="/subscribe" className={cn(btnPrimary, "mt-4")}>
              See plans <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-8 flex w-full justify-center">
              <SearchBox big />
            </div>
            {suggestions.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <span className="self-center text-[13px] text-[var(--color-ink-soft)]">From your listings:</span>
                {suggestions.map((s) => (
                  <Link key={s} href={href(s)} className={chip}>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {s}
                  </Link>
                ))}
              </div>
            )}
            {error && <p role="alert" className="mt-4 text-[14px] text-[var(--color-weak)]">{error}</p>}
          </>
        )}
      </div>
    );
  }

  if (!research) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
        <SearchBox q={q} />
        <p role="alert" className={cn(card, "mt-6 p-6 text-[15px] text-[var(--color-weak)]")}>
          {error ?? "Could not load this search. Try again."}
        </p>
      </div>
    );
  }

  const r = research;
  const similar = validOnly ? r.similar.filter((s) => s.valid) : r.similar;
  const stats = [
    { Icon: Store, label: "Competing listings", value: r.competition.toLocaleString("en-US"), sub: "Active Etsy listings matching this search" },
    { Icon: TrendingUp, label: "Top listings' views a day", value: n(r.topViewsPerDay), sub: "Median of the top 10, since listed" },
    { Icon: Users, label: "New listings in the top 25", value: r.newShare === null ? "–" : `${Math.round(r.newShare * 100)}%`, sub: "Listed in the last 90 days" },
    { Icon: Tag, label: "Typical price", value: money(r.medianPriceCents, r.currency), sub: "Median of the top 25" },
  ];

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
      <SearchBox q={q} />
      <div>
        <h1 className="text-[30px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">{r.keyword}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Etsy does not share how many people search a phrase, so Mavya shows what the top listings actually get. Numbers are from today.
        </p>
      </div>

      <section aria-label="Stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={cn(card, "p-4 sm:p-5")}>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)]">
              <s.Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{s.label}</span>
            </p>
            <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--color-ink)]">{s.value}</p>
            <p className="mt-2 text-[12.5px] text-[var(--color-ink-muted)]">{s.sub}</p>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-6 2xl:grid-cols-5">
        <section className={cn(card, "overflow-hidden 2xl:col-span-2")} aria-labelledby="similar-h">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] px-5 py-4">
            <h2 id="similar-h" className="text-[15px] font-semibold text-[var(--color-ink)]">Similar keywords</h2>
            <Link
              href={href(q, !validOnly)}
              role="switch"
              aria-checked={validOnly}
              className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              Valid Etsy tag
              <span className={cn("relative h-5 w-9 rounded-full transition-colors", validOnly ? "bg-[var(--color-ink)]" : "bg-[var(--color-border-strong)]")} aria-hidden="true">
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", validOnly ? "left-[18px]" : "left-0.5")} />
              </span>
            </Link>
          </div>
          {similar.length === 0 ? (
            <p className="px-5 py-8 text-center text-[14px] text-[var(--color-ink-muted)]">No shared tags among the top listings.</p>
          ) : (
            <table className="w-full text-[14px]">
              <thead className="text-[12px] text-[var(--color-ink-soft)]">
                <tr className="border-b border-[var(--color-border-soft)]">
                  <th scope="col" className="px-5 py-2 text-left font-medium">Keyword</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Used by top listings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-soft)]">
                {similar.slice(0, 20).map((s) => (
                  <tr key={s.tag}>
                    <td className="px-5 py-2.5">
                      <Link href={href(s.tag, validOnly)} className="font-medium text-[var(--color-ink)] hover:underline">
                        {s.tag}
                      </Link>
                      {!s.valid && <span className="ml-2 text-[11.5px] text-[var(--color-ink-soft)]">too long for a tag</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-page-deep)]" aria-hidden="true">
                          <span className="block h-full rounded-full bg-[var(--color-ink)]" style={{ width: `${(s.count / s.total) * 100}%` }} />
                        </span>
                        <span className="w-12 text-right tabular-nums text-[var(--color-ink)]">
                          {s.count}/{s.total}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={cn(card, "overflow-hidden 2xl:col-span-3")} aria-labelledby="top-h">
          <div className="border-b border-[var(--color-border-soft)] px-5 py-4">
            <h2 id="top-h" className="text-[15px] font-semibold text-[var(--color-ink)]">Top listings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead className="text-[12px] text-[var(--color-ink-soft)]">
                <tr className="border-b border-[var(--color-border-soft)]">
                  <th scope="col" className="w-10 px-3 py-2 text-left font-medium">#</th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Listing</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Views</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Views/day</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Favorites</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-soft)]">
                {r.top.map((t) => (
                  <tr key={t.listingId}>
                    <td className="px-3 py-2.5 tabular-nums text-[var(--color-ink-muted)]">{t.rank}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
                          {t.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          )}
                        </span>
                        {t.url ? (
                          <a href={t.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 max-w-[36ch] items-center gap-1 text-[var(--color-ink)] hover:underline">
                            <span className="truncate">{t.title}</span>
                            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-ink-soft)]" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="max-w-[36ch] truncate text-[var(--color-ink)]">{t.title}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{n(t.views)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{n(t.viewsPerDay)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{n(t.favorites)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{money(t.priceCents, t.currency)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink-muted)]">
                      {t.ageDays === null ? "–" : t.ageDays >= 365 ? `${Math.floor(t.ageDays / 365)}y` : `${t.ageDays}d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
