import { ImageOff } from "lucide-react";

type Props = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
};

/**
 * One product tile in the dashboard grid. Clicking opens the product's rating
 * workspace. Server component (plain link) — no client JS needed.
 */
export function ProductCard({ id, name, thumbnailUrl }: Props) {
  return (
    <a
      href={`/dashboard/product/${id}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-soft)]"
    >
      <div className="relative aspect-square w-full bg-[var(--color-page-deep)]">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-ink-soft)]">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <span className="block truncate text-[14px] font-semibold text-[var(--color-ink)]">
          {name}
        </span>
      </div>
    </a>
  );
}
