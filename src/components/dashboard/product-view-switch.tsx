"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";
import { BarChart3, ImageIcon, Loader2, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Photo | Write | Analytics switch at the top of a product page (Listing Coach,
 * docs/NORTH_STAR_LISTING_COACH.md). Lives on the product page, not in the
 * global header: it belongs to this one listing. Each view is its own URL
 * (survives refresh/back).
 *
 * Both views are dynamic server pages that re-render on every visit, and
 * switching between them keeps the old page on screen until the new one
 * arrives. So the clicked tab shows a spinner immediately (useTransition),
 * and hovering/focusing a tab prefetches it to give the render a head start.
 */
export function ProductViewSwitch({
  productId,
  active,
}: {
  productId: string;
  active: "photo" | "write" | "analytics";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<"photo" | "write" | "analytics" | null>(null);
  const base = `/dashboard/product/${productId}`;
  const items = [
    { key: "photo" as const, href: base, label: "Photo", Icon: ImageIcon },
    { key: "write" as const, href: `${base}/write`, label: "Write", Icon: PenLine },
    { key: "analytics" as const, href: `${base}/analytics`, label: "Analytics", Icon: BarChart3 },
  ];

  function go(e: MouseEvent<HTMLAnchorElement>, key: "photo" | "write" | "analytics", href: string) {
    // Let modified clicks (new tab/window) behave like normal links.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (key === active || pending) return;
    setTarget(key);
    startTransition(() => router.push(href));
  }

  return (
    <div className="mx-auto flex max-w-[1200px] justify-center px-6 pt-5">
      <nav
        aria-label="Product view"
        aria-busy={pending}
        className="inline-flex rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-1 shadow-[var(--shadow-soft)]"
      >
        {items.map(({ key, href, label, Icon }) => {
          const isActive = key === active;
          const loading = pending && target === key;
          return (
            <Link
              key={key}
              href={href}
              prefetch={false}
              onClick={(e) => go(e, key, href)}
              onMouseEnter={() => !isActive && router.prefetch(href)}
              onFocus={() => !isActive && router.prefetch(href)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-[var(--radius-md)] px-5 py-2 text-[14px] font-semibold transition-colors",
                isActive || loading
                  ? "bg-[var(--color-neutral-dark)] text-white"
                  : "text-[var(--color-ink-muted)] hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]",
                pending && isActive && "bg-transparent text-[var(--color-ink-muted)]"
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className="h-4 w-4" aria-hidden="true" />
              )}
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
