import Link from "next/link";
import { ExternalLink, Store, Tag, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeywordResearch } from "@/lib/keyword-research";
import { ageLabel, compact, money, researchHref } from "@/lib/research";
import { SearchField, StatTiles } from "@/components/research/research-ui";
import { SaveButton } from "@/components/research/save-button";

/**
 * One keyword: real Etsy competition, how busy the top listings are, the tags
 * they share, and the top 25 listings. Etsy does not publish search volume,
 * so none is shown or estimated.
 */

const card = "min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white";

export function KeywordDetail({ r, validOnly, saved }: { r: KeywordResearch; validOnly: boolean; saved: boolean }) {
  const similar = validOnly ? r.similar.filter((s) => s.valid) : r.similar;
  const link = (q: string, valid?: boolean) => researchHref("keyword", { q, valid: valid ? 1 : null });

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
      <SearchField kind="keyword" q={r.keyword} placeholder="Search for keywords or niches" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">{r.keyword}</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Etsy does not share how many people search a phrase, so Mavya shows what the top listings actually get. Numbers are from today.
          </p>
        </div>
        <SaveButton kind="keyword" refId={r.keyword.toLowerCase()} label={r.keyword} initial={saved} withText />
      </div>

      <StatTiles
        items={[
          { Icon: Store, label: "Competing listings", value: r.competition.toLocaleString("en-US"), sub: "Active Etsy listings for this search" },
          { Icon: TrendingUp, label: "Top listings' views a day", value: compact(r.topViewsPerDay), sub: "Median of the top 10, since listed" },
          { Icon: Users, label: "New listings in the top 25", value: r.newShare === null ? "–" : `${Math.round(r.newShare * 100)}%`, sub: "Listed in the last 90 days" },
          { Icon: Tag, label: "Typical price", value: money(r.medianPriceCents, r.currency), sub: "Median of the top 25" },
        ]}
      />

      <div className="grid items-start gap-6 2xl:grid-cols-5">
        <section className={cn(card, "overflow-hidden 2xl:col-span-2")} aria-labelledby="similar-h">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] px-5 py-4">
            <h2 id="similar-h" className="text-[15px] font-semibold text-[var(--color-ink)]">Similar keywords</h2>
            <Link
              href={link(r.keyword, !validOnly)}
              role="switch"
              aria-checked={validOnly}
              className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              Valid Etsy tag
              <span className={cn("relative h-5 w-9 rounded-full transition-colors", validOnly ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]")} aria-hidden="true">
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", validOnly ? "left-[18px]" : "left-0.5")} />
              </span>
            </Link>
          </div>
          {similar.length === 0 ? (
            <p className="px-5 py-8 text-center text-[14px] text-[var(--color-ink-muted)]">No shared tags among the top listings.</p>
          ) : (
            <table className="w-full text-[14px]">
              <thead className="text-[12.5px] text-[var(--color-ink-muted)]">
                <tr className="border-b border-[var(--color-border-soft)]">
                  <th scope="col" className="px-5 py-2.5 text-left font-medium">Keyword</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Used by top listings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-soft)]">
                {similar.slice(0, 20).map((s) => (
                  <tr key={s.tag} className="hover:bg-[var(--color-page)]">
                    <td className="px-5 py-3">
                      <Link href={link(s.tag, validOnly)} className="font-semibold text-[var(--color-ink)] hover:underline">
                        {s.tag}
                      </Link>
                      {!s.valid && <span className="ml-2 text-[11.5px] text-[var(--color-ink-soft)]">too long for a tag</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-page-deep)]" aria-hidden="true">
                          <span className="block h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${(s.count / s.total) * 100}%` }} />
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
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] px-5 py-4">
            <h2 id="top-h" className="text-[15px] font-semibold text-[var(--color-ink)]">Top listings</h2>
            <Link href={researchHref("product", { q: r.keyword })} className="text-[13px] font-semibold text-[var(--color-primary)] hover:underline">
              Open in Product Research
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead className="text-[12.5px] text-[var(--color-ink-muted)]">
                <tr className="border-b border-[var(--color-border-soft)]">
                  <th scope="col" className="w-10 px-3 py-2.5 text-left font-medium">#</th>
                  <th scope="col" className="px-2 py-2.5 text-left font-medium">Listing</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Views</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Views/day</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Favorites</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-soft)]">
                {r.top.map((t) => (
                  <tr key={t.listingId} className="hover:bg-[var(--color-page)]">
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{compact(t.views)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{compact(t.viewsPerDay)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{compact(t.favorites)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink)]">{money(t.priceCents, t.currency)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink-muted)]">{ageLabel(t.ageDays)}</td>
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
