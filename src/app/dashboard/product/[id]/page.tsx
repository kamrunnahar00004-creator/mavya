import { redirect } from "next/navigation";
import { ProductWorkspace } from "@/components/dashboard/product-workspace";
import { rubricToDemoState } from "@/lib/audit-mapping";
import type { RubricJson } from "@/lib/rubric";
import { createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Per-product workspace. Phase 2: loads the saved main photo + its latest audit
 * from the DB and renders the rating read-only. Phase 3 adds improve/edit +
 * supporting photos + persistence here.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/?auth=login");

  const supabase = await createSupabaseServerClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!product) redirect("/dashboard");

  const { data: photo } = await supabase
    .from("photos")
    .select("id, storage_path")
    .eq("product_id", product.id)
    .eq("role", "main")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: audit } = photo
    ? await supabase
        .from("audits")
        .select("rubric")
        .eq("photo_id", photo.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (!photo || !audit) {
    // Product exists but has no scored photo yet (edge case). Send back.
    redirect("/dashboard");
  }

  const { data: signed } = await supabase.storage
    .from("product-photos")
    .createSignedUrl(photo.storage_path, 3600);
  const imageSrc = signed?.signedUrl ?? "";

  const rubric = audit.rubric as RubricJson;
  const state = rubricToDemoState({
    rubric,
    imageSrc,
    imageAlt: product.name || "Product photo",
  });

  return (
    <ProductWorkspace
      state={state}
      imageSrc={imageSrc}
      isDigital={rubric.upload_kind === "digital_product"}
    />
  );
}
