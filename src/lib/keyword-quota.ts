import type { SupabaseClient } from "@supabase/supabase-js";
import { keywordLimitFor } from "@/lib/plans";

/**
 * Plan keyword allowance (north star 11.6): tracked search keywords across ALL
 * of a seller's listings (10 / 30 / 100). Each tracked keyword costs one Etsy
 * search per day, so this is the real API-cost lever. Read under the caller's
 * RLS client (only their own monitors are visible).
 */
export async function keywordsRemaining(
  supabase: SupabaseClient,
  activeListingLimit: number | null,
  excludeProductId: string | null
): Promise<{ limit: number; used: number; remaining: number; error?: boolean }> {
  const limit = keywordLimitFor(activeListingLimit);
  const { data, error } = await supabase.from("listing_monitors").select("product_id, keywords");
  if (error) return { limit, used: 0, remaining: 0, error: true };
  const rows = Array.isArray(data) ? (data as { product_id: string; keywords: string[] | null }[]) : [];
  const used = rows
    .filter((m) => m.product_id !== excludeProductId)
    .reduce((n, m) => n + (m.keywords?.length ?? 0), 0);
  return { limit, used, remaining: Math.max(0, limit - used) };
}
