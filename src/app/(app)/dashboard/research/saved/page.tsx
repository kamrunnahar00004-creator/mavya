import Link from "next/link";
import { Heart, Package, Search, Store } from "lucide-react";
import { researchContext } from "@/lib/research-context";
import { savedDetails } from "@/lib/research-store";
import { MAX_SAVED_SHOPS, researchHref } from "@/lib/research";
import { PageBar } from "@/components/page-bar";
import { EmptyState, KeywordTable, ProductRows, ShopRows, btn } from "@/components/research/research-ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Kind = "keywords" | "products" | "shops";
const KINDS: { key: Kind; label: string; Icon: typeof Heart }[] = [
  { key: "keywords", label: "Keywords", Icon: Search },
  { key: "products", label: "Products", Icon: Package },
  { key: "shops", label: "Shops", Icon: Store },
];

/** Everything this account saved from research, in one place. */
export default async function SavedResearchPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: rawKind } = await searchParams;
  const kind: Kind = KINDS.find((k) => k.key === rawKind)?.key ?? "keywords";
  const ctx = await researchContext();
  const saved = await savedDetails(ctx.userId, ctx.today);
  const counts: Record<Kind, number> = { keywords: saved.counts.keyword, products: saved.counts.product, shops: saved.counts.shop };

  return (
    <>
      <PageBar
        crumbs={[{ label: "Saved" }]}
        tabs={
          <nav aria-label="Saved items" className="flex items-center gap-1.5">
            {KINDS.map((k) => (
              <Link
                key={k.key}
                href={k.key === "keywords" ? "/dashboard/research/saved" : `/dashboard/research/saved?kind=${k.key}`}
                aria-current={kind === k.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-[13.5px] font-semibold transition-colors",
                  kind === k.key
                    ? "border-[var(--color-primary)] bg-[var(--color-tint)] text-[var(--color-ink)]"
                    : "border-[var(--color-border)] bg-white text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]"
                )}
              >
                <k.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {k.label}
                <span className="tabular-nums text-[var(--color-ink-soft)]">{counts[k.key]}</span>
              </Link>
            ))}
          </nav>
        }
      />
      {kind === "keywords" &&
        (saved.keywords.length ? (
          <div className="pt-2">
            <KeywordTable rows={saved.keywords} saved={new Set(saved.keywords.map((k) => k.keyword))} />
          </div>
        ) : (
          <EmptyState Icon={Heart} title="No saved keywords yet" body="Tap the heart on any keyword to keep it here." action={<Link href={researchHref("keyword", {})} className={btn}>Keyword Research</Link>} />
        ))}
      {kind === "products" &&
        (saved.products.length ? (
          <ProductRows rows={saved.products} saved={new Set(saved.products.map((p) => String(p.listingId)))} />
        ) : (
          <EmptyState Icon={Heart} title="No saved products yet" body="Tap the heart on any listing to keep it here." action={<Link href={researchHref("product", {})} className={btn}>Product Research</Link>} />
        ))}
      {kind === "shops" &&
        (saved.shops.length ? (
          <>
            <p className="px-4 pt-5 text-[13.5px] text-[var(--color-ink-muted)] sm:px-8">
              {saved.shops.length} of {MAX_SAVED_SHOPS} shops. {ctx.paid ? "Checked every day for real sales a day." : "Daily checks for sales a day run on paid plans."}
            </p>
            <ShopRows rows={saved.shops} saved={new Set(saved.shops.map((s) => String(s.shopId)))} />
          </>
        ) : (
          <EmptyState Icon={Heart} title="No saved shops yet" body={`Save up to ${MAX_SAVED_SHOPS} shops. Mavya checks them every day, so you see their real sales a day.`} action={<Link href={researchHref("shop", {})} className={btn}>Shop Research</Link>} />
        ))}
    </>
  );
}
