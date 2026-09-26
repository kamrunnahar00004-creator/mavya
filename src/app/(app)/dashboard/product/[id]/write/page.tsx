import { redirect } from "next/navigation";
import { createSupabaseServerClient, getProtectedPageIdentity } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { unwrapOrThrow } from "@/lib/unwrap";
import { ProductViewSwitch } from "@/components/dashboard/product-view-switch";
import { ListingWriteView } from "@/components/dashboard/listing-write-view";
import { loadWriterContext } from "@/lib/listing-writer-context";
import { checkListing } from "@/lib/listing-check";
import { calibrateScore } from "@/lib/calibration";

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
    supabase.from("products").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("listing_monitors").select("listing_revision").eq("product_id", id).maybeSingle(),
  ]);
  if (!entitlement.active && entitlement.reason !== "past_due") redirect("/subscribe");
  const product = unwrapOrThrow(productResult, "product_hydration_failed");
  if (!product) redirect("/dashboard");
  const monitor = unwrapOrThrow(monitorResult, "product_hydration_failed") as { listing_revision: string } | null;

  // The seller's current listing (latest daily snapshot) and an instant,
  // no-AI check of it. Null while the first snapshot is still being taken.
  const context = monitor ? await loadWriterContext(supabase, id, {}) : null;
  const looksDigital = context?.isDigital !== false;
  const current = context ? context.current : null;
  let photoFacts: { imageCount: number | null; mainScore: number | null } | undefined;
  if (context && monitor) {
    const [snapRes, mainRes] = await Promise.all([
      supabase.from("listing_snapshots").select("image_count").eq("product_id", id)
        .eq("listing_revision", monitor.listing_revision).order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("photos").select("current_audit_id").eq("product_id", id).eq("role", "main")
        .order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    let mainScore: number | null = null;
    const auditId = (mainRes.data as { current_audit_id: string | null } | null)?.current_audit_id;
    if (auditId) {
      const { data: audit } = await supabase.from("audits").select("overall_score").eq("id", auditId).maybeSingle();
      const raw = (audit as { overall_score: number | null } | null)?.overall_score;
      if (typeof raw === "number") mainScore = calibrateScore(raw);
    }
    photoFacts = { imageCount: (snapRes.data as { image_count: number | null } | null)?.image_count ?? null, mainScore };
  }
  const checks = context
    ? checkListing({
        photos: photoFacts,
        ...context.current,
        keywords: context.keywords.map((k) => k.keyword),
        winnerTags: context.winnerTags,
        isDigital: context.isDigital,
      })
    : [];

  return (
    <>
      <ProductViewSwitch productId={product.id} active="write" productName={product.name} />
      <ListingWriteView
        key={`${product.id}:${monitor?.listing_revision ?? "unlinked"}`}
        listingRevision={monitor?.listing_revision ?? "unlinked"}
        productId={product.id}
        linked={Boolean(monitor)}
        current={current}
        checks={checks}
        looksDigital={looksDigital}
        canWrite={entitlement.active}
      />
    </>
  );
}
