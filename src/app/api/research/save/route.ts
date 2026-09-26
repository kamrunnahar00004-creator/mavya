import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_SAVED_OTHER, MAX_SAVED_SHOPS, normalizeSavedRef, type ResearchKind } from "@/lib/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const KINDS: readonly ResearchKind[] = ["keyword", "product", "shop"];
const SOURCE: Record<ResearchKind, { table: string; column: string }> = {
  keyword: { table: "research_keywords", column: "keyword" },
  product: { table: "research_products", column: "listing_id" },
  shop: { table: "research_shops", column: "shop_id" },
};

/**
 * Save or unsave a researched keyword, product, or shop for the signed-in
 * account. Only items Mavya has already looked up can be saved (so the daily
 * saved-shop check only ever reads shops that exist). Saved shops are capped
 * because each one costs one Etsy call a day.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  if (!(await rateLimit(`research-save:u:${user.id}`, 120, 3_600_000)).ok) return apiError("rate_limited", "Try again in a little while.");

  let body: { kind?: unknown; ref?: unknown; label?: unknown; saved?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const kind = KINDS.find((k) => k === body?.kind) ?? null;
  const ref = kind ? normalizeSavedRef(kind, body?.ref) : null;
  if (!kind || !ref || typeof body?.saved !== "boolean") return apiError("bad_request", "Invalid request.");
  const label = typeof body.label === "string" ? body.label.replace(/\s+/g, " ").trim().slice(0, 120) : "";

  const admin = createSupabaseAdminClient();
  if (!body.saved) {
    const { error } = await admin.from("research_saved").delete().eq("user_id", user.id).eq("kind", kind).eq("ref", ref);
    if (error) return apiError("persistence_failed", "Could not update saved items. Try again.");
    return NextResponse.json({ ok: true, saved: false });
  }

  const { data: known } = await admin.from(SOURCE[kind].table).select(SOURCE[kind].column).eq(SOURCE[kind].column, ref).maybeSingle();
  if (!known) return apiError("bad_request", "Search for it first, then save it.");

  const max = kind === "shop" ? MAX_SAVED_SHOPS : MAX_SAVED_OTHER;
  const { count } = await admin.from("research_saved").select("ref", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", kind);
  if ((count ?? 0) >= max) {
    return apiError("allowance_exhausted", kind === "shop" ? `You can save up to ${MAX_SAVED_SHOPS} shops. Remove one to add another.` : `You can save up to ${max}. Remove one to add another.`);
  }
  const { error } = await admin.from("research_saved").upsert({ user_id: user.id, kind, ref, label }, { onConflict: "user_id,kind,ref", ignoreDuplicates: true });
  if (error) {
    logEvent("research.save_failed", { code: error.code ?? "" });
    return apiError("persistence_failed", "Could not save. Try again.");
  }
  return NextResponse.json({ ok: true, saved: true });
}
