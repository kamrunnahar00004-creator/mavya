import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { loadShopHome } from "@/lib/shop-monitor";
import { todayUtc } from "@/lib/listing-monitor";
import type { ShopChangeResult } from "@/lib/shop-analytics";
import { PageBar } from "@/components/page-bar";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A/B tests (Optimization, 2026-09-26). Etsy does not let apps swap two
 * versions of a listing, so each "test" is a change the seller made on Etsy
 * (title, tags, description, main photo): Mavya measures the listing's
 * views for 14 days after against the 14 before, compared with the rest of
 * the shop over the same days, and calls it only when the difference is
 * clear (the validated daily-ratio test in listing-analytics).
 */

const RESULT: Record<ShopChangeResult["verdict"], { label: string; fg: string; bg: string }> = {
  better: { label: "Better", fg: "var(--color-strong)", bg: "var(--color-strong-soft)" },
  worse: { label: "Worse", fg: "var(--color-weak)", bg: "var(--color-weak-soft)" },
  no_change: { label: "Too close to call", fg: "var(--color-ink-muted)", bg: "var(--color-page-deep)" },
  measuring: { label: "Running", fg: "var(--color-mid)", bg: "var(--color-mid-soft)" },
  not_enough_data: { label: "Can't tell", fg: "var(--color-ink-muted)", bg: "var(--color-page-deep)" },
  interrupted: { label: "Changed again", fg: "var(--color-ink-muted)", bg: "var(--color-page-deep)" },
};
const KIND = { main_photo: "Main photo", title: "Title", tags: "Tags", description: "Description" } as const;
const TABS = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "finished", label: "Finished" },
] as const;

const card = "min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white";
const fmt = (v: number | null) => (v === null ? "–" : v >= 10 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1));
const pct = (x: number) => `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function TestsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");
  const { show } = await searchParams;
  const tab = TABS.find((t) => t.key === show)?.key ?? "all";
  const supabase = await createSupabaseServerClient();
  const data = await loadShopHome(supabase, todayUtc());
  const changes = data.view?.changes ?? [];
  const images = new Map((data.view?.listings ?? []).map((l) => [l.listingId, l.mainImageUrl]));
  const rows = changes.filter((c) => tab === "all" || (tab === "running" ? c.verdict === "measuring" : c.verdict !== "measuring"));
  const count = (v: ShopChangeResult["verdict"]) => changes.filter((c) => c.verdict === v).length;

  return (
    <>
      <PageBar crumbs={[{ label: "A/B Tests" }]} />
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 pb-20 pt-6 sm:px-8">
        <header className="border-b border-[var(--color-border)] pb-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Listing optimization</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">A/B Tests</h1>
          <p className="mt-1.5 max-w-[80ch] text-[14.5px] text-[var(--color-ink-muted)]">
            Change a title, tags, description, or main photo on Etsy and Mavya starts a test the next day: 14 days after against 14 days before, compared with the rest of your shop over the same days. A result shows only when the difference is clear.
          </p>
        </header>

        <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              ["measuring", "Running"],
              ["better", "Better"],
              ["worse", "Worse"],
              ["no_change", "Too close to call"],
            ] as [ShopChangeResult["verdict"], string][]
          ).map(([v, label]) => (
            <div key={v} className={cn(card, "p-4 sm:p-5")}>
              <p className="text-[13px] font-medium text-[var(--color-ink-muted)]">{label}</p>
              <p className="mt-2 text-[28px] font-semibold leading-none tabular-nums" style={{ color: count(v) ? RESULT[v].fg : "var(--color-ink)" }}>
                {count(v)}
              </p>
            </div>
          ))}
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-soft)] px-4 py-3.5 sm:px-6">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.key === "all" ? "/dashboard/tests" : `/dashboard/tests?show=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-[var(--radius-md)] border px-3.5 text-[14px] font-semibold",
                  tab === t.key ? "border-[var(--color-primary)] bg-[var(--color-tint)] text-[var(--color-ink)]" : "border-[var(--color-border)] bg-white text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
          {rows.length === 0 ? (
            <div className="mx-auto flex max-w-[460px] flex-col items-center px-4 py-16 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] text-[var(--color-ink-muted)]">
                <FlaskConical className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-[16px] font-semibold text-[var(--color-ink)]">{changes.length ? "Nothing here" : "No tests yet"}</p>
              <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
                {data.shop
                  ? "Change a listing's title, tags, description, or main photo on Etsy. Mavya notices the next day and starts measuring."
                  : "Connect your shop first. Mavya then notices every change you make on Etsy and measures it."}
              </p>
              <Link href="/dashboard/shop" className="mt-5 inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-[14px] font-semibold text-white hover:bg-[var(--color-primary-hover)]">
                {data.shop ? "Open Listing Helper" : "Connect your shop"}
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] table-fixed text-[15px]">
                <thead className="border-b border-[var(--color-border-soft)] text-[12px] text-[var(--color-ink-muted)]">
                  <tr>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold uppercase tracking-[0.06em] sm:px-6">Listing</th>
                    <th scope="col" className="w-[170px] px-3 py-3.5 text-left font-semibold uppercase tracking-[0.06em]">Changed</th>
                    <th scope="col" className="w-[130px] px-3 py-3.5 text-left font-semibold uppercase tracking-[0.06em]">Started</th>
                    <th scope="col" className="w-[150px] px-3 py-3.5 text-right font-semibold uppercase tracking-[0.06em]">Views/day</th>
                    <th scope="col" className="w-[150px] px-3 py-3.5 text-right font-semibold uppercase tracking-[0.06em]">Vs your shop</th>
                    <th scope="col" className="w-[170px] py-3.5 pl-3 pr-4 text-right font-semibold uppercase tracking-[0.06em] sm:pr-6">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-soft)]">
                  {rows.map((c) => {
                    const r = RESULT[c.verdict];
                    const img = images.get(c.listingId) ?? null;
                    return (
                      <tr key={`${c.listingId}-${c.date}`} className="align-middle">
                        <td className="px-4 py-3.5 sm:px-6">
                          <div className="flex min-w-0 items-center gap-3.5">
                            <span className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
                              {img && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
                              )}
                            </span>
                            <p className="truncate text-[15px] text-[var(--color-ink)]">{c.title}</p>
                          </div>
                        </td>
                        <td className="px-3">
                          <div className="flex flex-wrap gap-1">
                            {c.kinds.map((k) => (
                              <span key={k} className="rounded-[var(--radius-sm)] bg-[var(--color-page-deep)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-ink-muted)]">
                                {KIND[k]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 text-[14px] text-[var(--color-ink-muted)]">{day(c.date)}</td>
                        <td className="px-3 text-right tabular-nums text-[var(--color-ink)]">
                          {fmt(c.beforePerDay)} <span className="text-[var(--color-ink-soft)]">→</span> {fmt(c.afterPerDay)}
                        </td>
                        <td className="px-3 text-right tabular-nums">
                          {(c.verdict === "better" || c.verdict === "worse") && c.lift !== null ? (
                            <span style={{ color: r.fg }} className="font-semibold">{pct(c.lift)}</span>
                          ) : c.verdict === "no_change" && c.liftLow !== null && c.liftHigh !== null ? (
                            <span className="text-[13px] text-[var(--color-ink-muted)]">
                              {pct(c.liftLow)} to {pct(c.liftHigh)}
                            </span>
                          ) : (
                            <span className="text-[var(--color-ink-soft)]">–</span>
                          )}
                        </td>
                        <td className="py-3.5 pl-3 pr-4 text-right sm:pr-6">
                          <span className="inline-flex h-[30px] items-center rounded-[var(--radius-md)] px-2.5 text-[13px] font-semibold" style={{ color: r.fg, background: r.bg }}>
                            {r.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-[var(--color-border-soft)] px-4 py-3 text-[12.5px] text-[var(--color-ink-soft)] sm:px-6">
            Shows what changed after, not why. Etsy traffic moves with seasons and ads, so the rest of your shop is the comparison.
          </p>
        </section>
      </main>
    </>
  );
}
