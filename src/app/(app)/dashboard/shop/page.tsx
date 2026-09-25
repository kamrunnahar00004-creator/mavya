import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { loadShopHome } from "@/lib/shop-monitor";
import { todayUtc } from "@/lib/listing-monitor";
import { ShopListings } from "@/components/dashboard/shop-home";

export const dynamic = "force-dynamic";

/** Every tracked listing in the seller's shop, filterable by status. */
export default async function ShopListingsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");
  const { filter } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [entitlement, data] = await Promise.all([getEntitlement(user.id), loadShopHome(supabase, todayUtc())]);
  if (!entitlement.active && entitlement.reason !== "past_due") redirect("/subscribe");
  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-20 pt-6 sm:px-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Shop home
      </Link>
      <h1 className="mt-2 font-display text-[26px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
        {data.shop ? `All listings in ${data.shop.name}` : "Your listings"}
      </h1>
      <div className="mt-5">
        <ShopListings data={data} filter={filter ?? null} canEdit={entitlement.active} />
      </div>
    </main>
  );
}
