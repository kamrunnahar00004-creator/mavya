import Link from "next/link";
import { BarChart3, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Photo | Analytics switch at the top of a product page (Listing Coach,
 * docs/NORTH_STAR_LISTING_COACH.md). Lives on the product page, not in the
 * global header: it belongs to this one listing. Plain links, so each view is
 * its own URL and survives refresh/back.
 */
export function ProductViewSwitch({
  productId,
  active,
}: {
  productId: string;
  active: "photo" | "analytics";
}) {
  const base = `/dashboard/product/${productId}`;
  const items = [
    { key: "photo" as const, href: base, label: "Photo", Icon: ImageIcon },
    { key: "analytics" as const, href: `${base}/analytics`, label: "Analytics", Icon: BarChart3 },
  ];
  return (
    <div className="mx-auto flex max-w-[1200px] justify-center px-6 pt-5">
      <nav
        aria-label="Product view"
        className="inline-flex rounded-full border border-[var(--color-border)] bg-white p-1 shadow-[var(--shadow-soft)]"
      >
        {items.map(({ key, href, label, Icon }) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-5 py-2 text-[14px] font-semibold transition-colors",
                isActive
                  ? "bg-[var(--color-neutral-dark)] text-white"
                  : "text-[var(--color-ink-muted)] hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
