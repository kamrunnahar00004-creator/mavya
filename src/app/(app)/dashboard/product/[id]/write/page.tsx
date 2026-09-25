import { redirect } from "next/navigation";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { unwrapOrThrow } from "@/lib/unwrap";
import { ProductViewSwitch } from "@/components/dashboard/product-view-switch";
import { ListingWriteView } from "@/components/dashboard/listing-write-view";
import { loadWriterContext } from "@/lib/listing-writer-context";

export const dynamic = "force-dynamic";

/**
 * Write tab: title, 13 tags, and description for the linked Etsy listing
 * (north star 11.4 F). The page only loads what it needs to render the
 * starting state; the writing itself happens in POST /api/listings/write.
 */
export default async function ProductWritePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getProtectedPageIdentity();
  if (!user) redirect("/?auth=login");

  const supabase = await createSupabaseServerClient();
  const [entitlement, productResult, monitorResult] = await Promise.all([
    getEntitlement(user.id),
    supabase.from("products").select("id").eq("id", id).maybeSingle(),
    supabase.from("listing_monitors").select("listing_revision").eq("product_id", id).maybeSingle(),
  ]);
  if (!entitlement.active && entitlement.reason !== "past_due") redirect("/subscribe");
  const product = unwrapOrThrow(productResult, "product_hydration_failed");
  if (!product) redirect("/dashboard");
  const monitor = unwrapOrThrow(monitorResult, "product_hydration_failed") as { listing_revision: string } | null;

  let current: { title: string; tagCount: number } | null = null;
  if (monitor) {
    const { data } = await supabase
      .from("listing_snapshots")
      .select("title, tags")
      .eq("product_id", id)
      .eq("listing_revision", monitor.listing_revision)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const snap = data as { title: string | null; tags: string[] | null } | null;
    if (snap) current = { title: snap.title ?? "", tagCount: snap.tags?.length ?? 0 };
  }
  const context = monitor ? await loadWriterContext(supabase, id, {}) : null;
  const looksDigital = context?.isDigital !== false;

  return (
    <>
      <ProductViewSwitch productId={product.id} active="write" />
      <ListingWriteView
        key={`${product.id}:${monitor?.listing_revision ?? "unlinked"}`}
        listingRevision={monitor?.listing_revision ?? "unlinked"}
        productId={product.id}
        linked={Boolean(monitor)}
        current={current}
        looksDigital={looksDigital}
        canWrite={entitlement.active}
      />
    </>
  );
}
