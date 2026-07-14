import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ImageUp } from "lucide-react";
import { AddProductCard } from "@/components/dashboard/add-product";
import { ProductCard } from "@/components/dashboard/product-card";
import { createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

type AuditRow = {
  overall_score: number | null;
  created_at: string;
  rubric: { priority_action?: string } | null;
};
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

  // Paid-only beta gate (server-side, not a client redirect): no plan or an
  // expired/cancelled plan goes to the credits page. past_due stays here so
  // saved photos remain visible; the backend already blocks new AI usage.
  const entitlement = await getEntitlement(user.id);
  const pastDue = entitlement.reason === "past_due";
  if (!entitlement.active && !pastDue) redirect("/subscribe");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, name, position, created_at, photos(storage_path, role, created_at, audits(overall_score, created_at, rubric))"
    )
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const products = (data as ProductRow[] | null) ?? [];

  // Build a signed thumbnail URL for each product's main photo.
  const cards = await Promise.all(
    products.map(async (p, index) => {
      const main = (p.photos ?? []).find((ph) => ph.role === "main");
      let thumbnailUrl: string | null = null;
      let storagePath: string | null = null;
      let score: number | null = null;
      let topFix: string | null = null;
      if (main) {
        const { data: signed } = await supabase.storage
          .from("product-photos")
          .createSignedUrl(main.storage_path, 24 * 60 * 60);
        thumbnailUrl = signed?.signedUrl ?? null;
        storagePath = main.storage_path;
        const latest = [...(main.audits ?? [])].sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        )[0];
        score = typeof latest?.overall_score === "number" ? latest.overall_score : null;
        // Show the top recommended fix only when the photo still needs work.
        if (typeof score === "number" && score < 8) {
          topFix = latest?.rubric?.priority_action?.trim() || null;
        }
      }
      return {
        id: p.id,
        name: p.name?.trim() || `Product ${index + 1}`,
        thumbnailUrl,
        storagePath,
        score,
        topFix,
      };
    })
  );

  const pastDueBanner = pastDue ? (
    <div className="mx-auto mt-6 flex max-w-[1200px] items-start gap-2.5 rounded-[var(--radius-xl)] border border-[var(--color-weak)]/40 bg-[var(--color-weak-soft)] p-4">
      <AlertCircle
        className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--color-weak)]"
        aria-hidden="true"
      />
      <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
        Your payment did not go through, so new credits are paused. Your saved
        photos are safe.{" "}
        <Link href="/settings" className="font-semibold underline">
          Fix billing in Settings
        </Link>
        .
      </p>
    </div>
  ) : null;

  if (cards.length === 0) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1200px] flex-col items-center justify-center px-6 pb-20 text-center">
        {pastDueBanner}
        <span className="flex h-24 w-24 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-tint)] text-[var(--color-primary)] shadow-[var(--shadow-soft)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
          <ImageUp className="h-11 w-11" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1 className="mt-7 font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[38px]">
          {pastDue ? "Your credits are paused" : "Rate your first product thumbnail"}
        </h1>
        <p className="mt-3 max-w-[400px] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          {pastDue
            ? "Update your billing details to rate and improve a new photo."
            : "Get an honest score, then let Mavya improve the photo automatically."}
        </p>
        <div className="mt-7">
          {pastDue ? (
            <Link
              href="/settings"
              className="inline-flex rounded-full bg-[var(--color-primary)] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              Fix billing in Settings
            </Link>
          ) : (
            <AddProductCard variant="hero" />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      {pastDueBanner && <div className="mb-6">{pastDueBanner}</div>}
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
            storagePath={c.storagePath}
            score={c.score}
            topFix={c.topFix}
          />
        ))}
        {!pastDue && <AddProductCard />}
      </div>
    </main>
  );
}
