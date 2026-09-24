import { BarChart3, ImageIcon } from "lucide-react";

/**
 * Instant skeleton while the Analytics server page renders. Mirrors the real
 * single-column layout (switch, header row, next step, numbers, chart) so
 * nothing jumps when the data arrives. The switch here is visual only
 * (loading.tsx has no route params); the real one replaces it a moment later.
 */
export default function AnalyticsLoading() {
  const bar = "rounded bg-[var(--color-page-deep)]";
  const card = "rounded-[var(--radius-2xl)] border border-[var(--color-border-soft)] bg-white";
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
      <main className="mx-auto flex w-full max-w-[760px] animate-pulse flex-col gap-6 px-4 pb-20 pt-6 motion-reduce:animate-none sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 flex-shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-page-deep)]" />
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-2/3 ${bar}`} />
            <div className={`h-3 w-1/3 ${bar}`} />
          </div>
        </div>
        <div className={`${card} space-y-3 p-6`}>
          <div className={`h-3 w-24 ${bar}`} />
          <div className={`h-6 w-3/4 ${bar}`} />
          <div className={`h-4 w-1/2 ${bar}`} />
        </div>
        <div className={`${card} h-[92px]`} />
        <div className={`${card} h-[230px]`} />
      </main>
    </div>
  );
}
