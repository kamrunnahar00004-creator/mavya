import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Page top bar (2026-09-26): breadcrumb on the left, the page's tabs beside it,
 * optional actions on the right. Same height and style on every app page.
 */
export function PageBar({
  crumbs,
  tabs,
  actions,
}: {
  crumbs: { label: string; href?: string }[];
  tabs?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-[97px] z-20 border-b border-[var(--color-border)] bg-white/95 backdrop-blur-sm lg:top-0">
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-8">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[14.5px]">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {c.href && !last ? (
                  <Link href={c.href} className="flex-shrink-0 font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                    {c.label}
                  </Link>
                ) : (
                  <span className="max-w-[40ch] truncate font-semibold text-[var(--color-ink)]" aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
                {!last && <ChevronRight className="h-4 w-4 flex-shrink-0 text-[var(--color-ink-soft)]" aria-hidden="true" />}
              </span>
            );
          })}
        </nav>
        {tabs}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Tab style shared by every page bar: rectangular, current one outlined. */
export const tabClass = (active: boolean) =>
  [
    "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[13.5px] font-semibold transition-colors",
    active
      ? "border-[var(--color-ink)] bg-white text-[var(--color-ink)]"
      : "border-[var(--color-border)] bg-white text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]",
  ].join(" ");
