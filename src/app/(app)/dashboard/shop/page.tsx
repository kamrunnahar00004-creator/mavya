import { redirect } from "next/navigation";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { loadShopHome } from "@/lib/shop-monitor";
import { todayUtc } from "@/lib/listing-monitor";
import { ShopListings } from "@/components/dashboard/shop-home";
import { PageBar } from "@/components/page-bar";

export const dynamic = "force-dynamic";

/** Every tracked listing in the seller's shop, filterable by status. */
export default async function ShopListingsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");
  const { filter } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [entitlement, data] = await Promise.all([getEntitlement(user.id), loadShopHome(supabase, todayUtc())]);
  // Free accounts see their free Shop check here too; paid actions are locked.
  const free = !entitlement.active && entitlement.reason !== "past_due";
  return (
    <>
      <PageBar crumbs={[{ label: "Overview", href: "/dashboard" }, { label: data.shop ? `All listings in ${data.shop.name}` : "All listings" }]} />
      <main className="mx-auto max-w-[1280px] px-4 pb-20 pt-6 sm:px-8">
        <ShopListings data={data} filter={filter ?? null} canEdit={entitlement.active} free={free} />
      </main>
    </>
  );
}
