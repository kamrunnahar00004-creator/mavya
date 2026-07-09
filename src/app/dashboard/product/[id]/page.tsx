import { redirect } from "next/navigation";
import {
  ProductWorkspace,
  type InitialPhoto,
} from "@/components/dashboard/product-workspace";
import type { RubricJson } from "@/lib/rubric";
import { createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuditRow = { rubric: RubricJson; created_at: string };
type PhotoRow = {
  id: string;
  role: "main" | "supporting";
  storage_path: string;
  position: number;
  created_at: string;
  audits: AuditRow[] | null;
};

/**
 * Per-product workspace. Loads the saved main + supporting photos with their
 * latest audits and signed URLs, then renders the interactive workspace
 * (One-click fix, Edit, supporting strip, checklist) seeded from the DB.
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

  const { data: photoData } = await supabase
    .from("photos")
    .select("id, role, storage_path, position, created_at, audits(rubric, created_at)")
    .eq("product_id", product.id)
    .order("role", { ascending: true }) // 'main' < 'supporting'
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const rows = (photoData as PhotoRow[] | null) ?? [];

  // Sign all photo URLs in parallel (was sequential — a lag source with several
  // supporting photos).
  const signed = await Promise.all(
    rows.map(async (row) => {
      const latest = [...(row.audits ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      )[0];
      if (!latest?.rubric) return null;
      const { data } = await supabase.storage
        .from("product-photos")
        .createSignedUrl(row.storage_path, 3600);
      if (!data?.signedUrl) return null;
      return {
        id: row.id,
        role: row.role,
        imageSrc: data.signedUrl,
        rubric: latest.rubric,
      } satisfies InitialPhoto;
    })
  );
  const initialPhotos: InitialPhoto[] = signed.filter(
    (p): p is InitialPhoto => p !== null
  );

  // No scored main photo yet (edge case) — back to dashboard.
  if (!initialPhotos.some((p) => p.role === "main")) redirect("/dashboard");

  return (
    <ProductWorkspace
      productId={product.id}
      userId={user.id}
      productName={product.name}
      initialPhotos={initialPhotos}
    />
  );
}
