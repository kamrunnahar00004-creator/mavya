import { redirect } from "next/navigation";
import { ImageUp } from "lucide-react";
import { AddProductCard } from "@/components/dashboard/add-product";
import { ProductCard } from "@/components/dashboard/product-card";
import { createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuditRow = { overall_score: number | null; created_at: string };
type PhotoRow = {
  storage_path: string;
  role: string;
  created_at: string;
  audits: AuditRow[] | null;
};
type ProductRow = {
  id: string;
  name: string | null;
  position: number;
  created_at: string;
  photos: PhotoRow[] | null;
};

/**
 * Dashboard: the seller's products as a grid of cards. Each card shows the main
 * photo thumbnail (signed URL, private bucket) + name (or "Product N"). Clicking
 * opens /dashboard/product/[id]. The Add card runs the existing rating pipeline.
 */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/?auth=login");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, name, position, created_at, photos(storage_path, role, created_at, audits(overall_score, created_at))"
    )
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const products = (data as ProductRow[] | null) ?? [];

  // Build a signed thumbnail URL for each product's main photo.
  const cards = await Promise.all(
    products.map(async (p, index) => {
      const main = (p.photos ?? []).find((ph) => ph.role === "main");
      let thumbnailUrl: string | null = null;
      let score: number | null = null;
      if (main) {
        const { data: signed } = await supabase.storage
          .from("product-photos")
          .createSignedUrl(main.storage_path, 3600);
        thumbnailUrl = signed?.signedUrl ?? null;
        const latest = [...(main.audits ?? [])].sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        )[0];
        score = typeof latest?.overall_score === "number" ? latest.overall_score : null;
      }
      return {
        id: p.id,
        name: p.name?.trim() || `Product ${index + 1}`,
        thumbnailUrl,
        score,
      };
    })
  );

  if (cards.length === 0) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1200px] flex-col items-center justify-center px-6 pb-20 text-center">
        <span className="flex h-24 w-24 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-tint)] text-[var(--color-primary)] shadow-[var(--shadow-soft)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
          <ImageUp className="h-11 w-11" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1 className="mt-7 font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[38px]">
          Rate your first listing
        </h1>
        <p className="mt-3 max-w-[400px] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          Upload your main photo and see its score at a glance.
        </p>
        <div className="mt-7">
          <AddProductCard variant="hero" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <h1 className="font-display text-[30px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
        Your products
      </h1>
      <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">
        Each product is one Etsy listing.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {cards.map((c) => (
          <ProductCard
            key={c.id}
            id={c.id}
            name={c.name}
            thumbnailUrl={c.thumbnailUrl}
            score={c.score}
          />
        ))}
        <AddProductCard />
      </div>
    </main>
  );
}
