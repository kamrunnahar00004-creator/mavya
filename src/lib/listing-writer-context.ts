import type { SupabaseClient } from "@supabase/supabase-js";
import type { RubricJson } from "@/lib/rubric";
import { keywordIsRelevant, latestByKeyword, winnerTagFrequency, type KeywordSnapshot } from "@/lib/listing-analytics";
import type { SellerFacts, WriterContext } from "@/lib/listing-writer";

/**
 * Load everything the listing writer is allowed to use, for ONE product,
 * under the caller's RLS client (a foreign product simply returns nothing).
 * SERVER ONLY. Returns null when the product has no linked Etsy listing or no
 * snapshot yet (the writer needs the seller's current copy to start from).
 */
export async function loadWriterContext(
  supabase: SupabaseClient,
  productId: string,
  facts: SellerFacts
): Promise<WriterContext | null> {
  const { data: monitor } = await supabase
    .from("listing_monitors")
    .select("etsy_listing_id, keywords, revision, listing_revision")
    .eq("product_id", productId)
    .maybeSingle();
  if (!monitor) return null;

  const [snapResult, kwResult, photoResult] = await Promise.all([
    supabase
      .from("listing_snapshots")
      .select("title, tags, description")
      .eq("product_id", productId)
      .eq("listing_revision", monitor.listing_revision)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("listing_keyword_snapshots")
      .select("snapshot_date, keyword, position, depth, top")
      .eq("product_id", productId)
      .eq("revision", monitor.revision)
      .order("snapshot_date", { ascending: false })
      .limit(12),
    supabase
      .from("photos")
      .select("current_audit_id")
      .eq("product_id", productId)
      .eq("role", "main")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const snap = snapResult.data as { title: string | null; tags: string[] | null; description: string | null } | null;
  if (!snap) return null;

  const keywords: string[] = monitor.keywords ?? [];
  // Only keywords that actually find listings like this one (a status word
  // like "pre-order" returns yarn and stockings), in the seller's own order so
  // the first one is their main keyword.
  const latest = latestByKeyword(((kwResult.data as KeywordSnapshot[] | null) ?? []).filter((k) => keywords.includes(k.keyword)))
    .filter((k) => keywordIsRelevant({ title: snap.title, tags: snap.tags ?? [] }, k.keyword, k.top) !== false)
    .sort((x, y) => keywords.indexOf(x.keyword) - keywords.indexOf(y.keyword));

  let rubric: RubricJson | null = null;
  const auditId = (photoResult.data as { current_audit_id: string | null } | null)?.current_audit_id;
  if (auditId) {
    const { data } = await supabase.from("audits").select("rubric").eq("id", auditId).maybeSingle();
    rubric = (data as { rubric: RubricJson } | null)?.rubric ?? null;
  }

  const title = snap.title ?? "";
  const isDigital = rubric?.upload_kind === "digital_product" ? true
    : rubric?.upload_kind === "physical_product" ? false : null;

  return {
    listingId: Number(monitor.etsy_listing_id),
    current: { title, tags: snap.tags ?? [], description: snap.description ?? "" },
    photo: { productSummary: rubric?.product_summary || null, category: rubric?.detected_category || null },
    keywords: latest.map((k) => ({ keyword: k.keyword, position: k.position, depth: k.depth })),
    winnerTags: winnerTagFrequency(latest).filter((w) => w.count >= 2),
    isDigital,
    facts,
  };
}
