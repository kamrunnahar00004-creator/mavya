import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ImageUp } from "lucide-react";
import { AddProductCard } from "@/components/dashboard/add-product";
import { ProductCard } from "@/components/dashboard/product-card";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { signThumbUrls } from "@/lib/batch-sign-urls";
import { loadDashboardOverview } from "@/lib/dashboard-overview";
import { timed } from "@/lib/perf";

export const dynamic = "force-dynamic";

/**
 * Dashboard: the seller's products as a grid of cards. Each card shows the main
 * photo thumbnail (signed URL, private bucket) + name (or "Product N"). Clicking
 * opens /dashboard/product/[id]. The Add card runs the existing rating pipeline.
 */
export default async function DashboardPage() {
  const user = await timed("dashboard.auth", () => getProtectedPageIdentity());
  if (!user) redirect("/?auth=login");

  // Paid-only beta gate (server-side, not a client redirect): no plan or an
  // expired/cancelled plan goes to the credits page. past_due stays here so
  // saved photos remain visible; the backend already blocks new AI usage.
  const supabase = await createSupabaseServerClient();

  // Entitlement and RLS-scoped dashboard reads are independent once identity
  // is verified. Run them together, but render nothing until the paid gate
  // passes. This removes one serial Supabase round trip without weakening it.
  const [entitlement, rows] = await Promise.all([
    timed("dashboard.entitlement", () => getEntitlement(user.id)),
    timed("dashboard.hydrate", () => loadDashboardOverview(supabase)),
  ]);
  const pastDue = entitlement.reason === "past_due";
  if (!entitlement.active && !pastDue) redirect("/subscribe");

  // ONE compact round trip: dashboard_overview() (SECURITY INVOKER, RLS
  // enforced) returns exactly one deterministic row per product — main photo,
  // latest audit score + priority action, latest rating job. Full audit
  // history and rubric JSON never leave the database. If the RPC itself
  // fails, loadDashboardOverview falls back to the legacy hydration; if the
  // fallback also fails it throws, so a database failure fails visibly and
  // never renders a fake empty dashboard.
  // Private fixed 512px thumbnails for cards (full resolution stays on the
  // product page).
  const signedUrls = await timed("dashboard.sign", () =>
    signThumbUrls(
      supabase,
      rows.map((r) => r.storage_path)
    )
  );

  const cards = rows.map((r, index) => ({
    id: r.product_id,
    name: r.product_name?.trim() || `Product ${index + 1}`,
    thumbnailUrl: r.storage_path ? signedUrls.get(r.storage_path) ?? null : null,
    storagePath: r.storage_path,
    score: typeof r.score === "number" ? r.score : null,
    topFix: r.priority_action,
    ratingJobId: r.rating_job_id,
    ratingStatus: r.rating_status,
    ratingError: r.rating_error,
  }));

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
    if (pastDue) {
      return (
        <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1200px] flex-col items-center justify-center px-6 pb-20 text-center">
          {pastDueBanner}
          <span className="flex h-24 w-24 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-tint)] text-[var(--color-primary)] shadow-[var(--shadow-soft)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
            <ImageUp className="h-11 w-11" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h1 className="mt-7 font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[38px]">
            Your credits are paused
          </h1>
          <p className="mt-3 max-w-[400px] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
            Update your billing details to rate and improve a new photo.
          </p>
          <div className="mt-7">
            <Link
              href="/settings"
              className="inline-flex rounded-full bg-[var(--color-primary)] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              Fix billing in Settings
            </Link>
          </div>
        </main>
      );
    }

    return (
      <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1200px] flex-col items-center justify-center px-6 pt-12 pb-20 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-tint)] text-[var(--color-primary)] shadow-[var(--shadow-soft)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
          <ImageUp className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[38px]">
          Get More Etsy Clicks in 4 Simple Steps
        </h1>
        <ol className="mt-6 flex max-w-[440px] flex-col gap-3 text-left text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          {[
            "Upload all photos from the same Etsy listing, or add them one by one.",
            "See how every photo scores and what is hurting clicks.",
            "Fix weak photos in one click.",
            "Improve the full listing with stronger, more clickable images.",
          ].map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[13px] font-bold text-[var(--color-primary)]"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 w-full max-w-[520px]">
          <AddProductCard variant="dropzone" />
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
      {typeof entitlement.activeListingLimit === "number" && (
        <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
          {cards.length} of {entitlement.activeListingLimit} active listings used.
          {!pastDue && cards.length >= entitlement.activeListingLimit && (
            <span className="text-[var(--color-ink)]"> Delete a listing to add another.</span>
          )}
        </p>
      )}

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
            ratingJobId={c.ratingJobId}
            ratingStatus={c.ratingStatus}
            ratingError={c.ratingError}
          />
        ))}
        {!pastDue && <AddProductCard />}
      </div>
    </main>
  );
}
