import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { addDays } from "@/lib/listing-analytics";
import { todayUtc } from "@/lib/listing-monitor";
import { DISMISS_DAYS } from "@/lib/shop-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "dismiss" | "protect" | "unprotect";
const ACTIONS: readonly Action[] = ["dismiss", "protect", "unprotect"];

/**
 * Seller control over "Fix these first": hide a listing's tip for 30 days
 * ("Not now"), or mark a listing as working so Mavya never suggests changes
 * to it ("Don't touch"), or undo that. The listing must be in the caller's own
 * tracked shop (checked under RLS); the write is service-role.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const limit = await rateLimit(`shop-pref:u:${user.id}`, 60, 3_600_000);
  if (!limit.ok) return apiError("rate_limited", "Try again in a little while.");

  let body: { listingId?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const listingId = typeof body?.listingId === "number" && Number.isSafeInteger(body.listingId) && body.listingId > 0 ? body.listingId : null;
  const action = ACTIONS.find((a) => a === body?.action) ?? null;
  if (!listingId || !action) return apiError("bad_request", "Invalid request.");

  const supabase = await createSupabaseServerClient();
  const { data: shop, error } = await supabase
    .from("shop_monitors")
    .select("etsy_shop_id, current_listing_ids, fix_dismissed, protected_listing_ids")
    .maybeSingle();
  if (error) return apiError("persistence_failed", "Could not read your shop. Try again.");
  if (!shop?.current_listing_ids?.some((id: number | string) => Number(id) === listingId)) {
    return apiError("forbidden", "That listing is not in your connected shop.");
  }

  const today = todayUtc();
  // Drop expired "Not now" entries while writing, so the map stays small.
  const dismissed = Object.fromEntries(
    Object.entries((shop.fix_dismissed as Record<string, string> | null) ?? {}).filter(([, until]) => until >= today)
  );
  const protectedIds = new Set(((shop.protected_listing_ids as (number | string)[] | null) ?? []).map(Number));
  if (action === "dismiss") dismissed[String(listingId)] = addDays(today, DISMISS_DAYS);
  if (action === "protect") protectedIds.add(listingId);
  if (action === "unprotect") protectedIds.delete(listingId);

  const { error: writeError } = await createSupabaseAdminClient()
    .from("shop_monitors")
    .update({ fix_dismissed: dismissed, protected_listing_ids: [...protectedIds], updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("etsy_shop_id", shop.etsy_shop_id);
  if (writeError) {
    logEvent("shop.pref_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not save. Try again.");
  }
  return NextResponse.json({ ok: true });
}
