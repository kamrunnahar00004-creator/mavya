import { BarChart3, ImageIcon, Loader2 } from "lucide-react";

/**
 * Instant skeleton while the Analytics server page renders. Mirrors the real
 * layout (switch, header, next-fix card, stat row, chart) so nothing jumps
 * when the data arrives. The switch here is visual only (loading.tsx has no
 * route params); the real, clickable one replaces it a moment later.
 */
export default function AnalyticsLoading() {
  const block = "rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-white shadow-[var(--shadow-soft)]";
  return (
    <div aria-busy="true" aria-label="Loading analytics">
      <div className="mx-auto flex max-w-[1200px] justify-center px-6 pt-5">
        <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white p-1 shadow-[var(--shadow-soft)]">
          <span className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[14px] font-semibold text-[var(--color-ink-muted)]">
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Photo
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-neutral-dark)] px-5 py-2 text-[14px] font-semibold text-white">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Analytics
          </span>
        </div>
      </div>
      <main className="mx-auto flex max-w-[1200px] animate-pulse flex-col gap-5 px-4 pb-16 pt-6 sm:px-6">
        <div className={`${block} flex items-center gap-4 p-5 sm:p-6`}>
          <div className="h-20 w-20 flex-shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-page-deep)]" />
          <div className="flex-1 space-y-2.5">
            <div className="h-3 w-40 rounded bg-[var(--color-page-deep)]" />
            <div className="h-5 w-3/4 rounded bg-[var(--color-page-deep)]" />
            <div className="h-3 w-1/2 rounded bg-[var(--color-page-deep)]" />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[var(--radius-xl)] bg-[var(--color-page-deep)] p-6 text-[14px] font-medium text-[var(--color-ink-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading your listing&apos;s numbers…
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${block} h-[118px]`} />
          ))}
        </div>
        <div className={`${block} h-[260px]`} />
      </main>
    </div>
  );
}
