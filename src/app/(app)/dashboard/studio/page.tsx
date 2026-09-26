import { redirect } from "next/navigation";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { loadShopHome } from "@/lib/shop-monitor";
import { todayUtc } from "@/lib/listing-monitor";
import { batchSignUrls } from "@/lib/batch-sign-urls";
import { PageBar } from "@/components/page-bar";
import { StudioClient, type StudioListing, type StudioPhoto } from "@/components/studio/studio-client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AI Studio (Optimization, 2026-09-26): one place to work on a listing with
 * Mavya's AI. Type what you want, pick a listing and a photo, then Score it,
 * polish it (one-click fix, with your request as the edit), or write new
 * title, tags, and description. The actions are the same pipelines as the
 * Photo and Write tabs; Studio hands off to them with the choice made.
 */
export default async function StudioPage({ searchParams }: { searchParams: Promise<{ listing?: string }> }) {
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");
  const { listing } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [entitlement, shop] = await Promise.all([getEntitlement(user.id), loadShopHome(supabase, todayUtc())]);

  const listings: StudioListing[] = (shop.view?.listings ?? [])
    .map((l) => ({
      listingId: l.listingId,
      title: l.title,
      image: l.mainImageUrl,
      productId: shop.opened[l.listingId] ?? null,
      score: l.check.score,
    }))
    .sort((a, b) => a.score - b.score);

  let selected: { productId: string; title: string; photos: StudioPhoto[] } | null = null;
  if (listing && UUID.test(listing)) {
    const [{ data: product }, { data: rows }] = await Promise.all([
      supabase.from("products").select("id, name").eq("id", listing).maybeSingle(),
      supabase
        .from("photos")
        .select("id, role, storage_path, position, created_at")
        .eq("product_id", listing)
        .order("role", { ascending: true })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (product) {
      const photoRows = (rows as { id: string; role: string; storage_path: string }[] | null) ?? [];
      const signed = await batchSignUrls(supabase, photoRows.map((r) => r.storage_path));
      selected = {
        productId: (product as { id: string }).id,
        title: (product as { name: string | null }).name ?? "Listing",
        photos: photoRows
          .map((r) => ({ id: r.id, main: r.role === "main", src: signed.get(r.storage_path) ?? null }))
          .sort((a, b) => Number(b.main) - Number(a.main)),
      };
    }
  }

  return (
    <>
      <PageBar crumbs={[{ label: "AI Studio" }]} />
      <StudioClient listings={listings} selected={selected} opened={shop.opened} hasShop={Boolean(shop.shop)} paid={entitlement.active} />
    </>
  );
}
