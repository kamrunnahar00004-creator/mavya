import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeywordSnapshot } from "@/lib/listing-analytics";

/** Old tests need their original controls, but never another linked listing's. */
export async function loadKeywordHistory(
  client: SupabaseClient,
  productId: string,
  listingRevision: string,
  from: string
): Promise<KeywordSnapshot[]> {
  const rows: KeywordSnapshot[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("listing_keyword_snapshots")
      .select("revision, snapshot_date, keyword, position, depth, top")
      .eq("product_id", productId).eq("listing_revision", listingRevision)
      .gte("snapshot_date", from)
      .order("snapshot_date", { ascending: true })
      .order("revision", { ascending: true })
      .order("keyword", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("Could not load listing comparison history");
    rows.push(...(data as KeywordSnapshot[] ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
