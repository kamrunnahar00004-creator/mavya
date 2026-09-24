import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { isEtsyConfigured } from "@/lib/etsy";
import { normalizeKeywords } from "@/lib/listing-analytics";
import { runListingMonitor, scoreWinnerPhotos } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Change a linked listing's monitoring switch and/or tracked keywords.
 * Turning monitoring OFF is always allowed (it only stops work). Turning it
 * ON or changing keywords needs an active subscription, and new keywords are
 * checked right away so the seller sees positions without waiting a day.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const limit = await rateLimit(`listing-settings:u:${user.id}`, 20, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: { productId?: unknown; enabled?: unknown; keywords?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!UUID_RE.test(productId)) return apiError("bad_request", "Invalid product id.");
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return apiError("bad_request", "Invalid monitoring value.");
  }
  const keywords = body.keywords === undefined ? undefined : normalizeKeywords(body.keywords);
  if (keywords === null) return apiError("bad_request", "Up to 3 keywords, 80 characters each.");
  if (body.enabled === undefined && keywords === undefined) {
    return apiError("bad_request", "Nothing to change.");
  }

  const turningOnOrEditing = body.enabled === true || keywords !== undefined;
  if (turningOnOrEditing) {
    const entitlement = await getEntitlement(user.id);
    if (!entitlement.active) {
      return apiError(
        entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required",
        "Listing monitoring needs an active subscription."
      );
    }
  }

  // Ownership under RLS: the monitor row is only visible to its owner.
  const supabase = await createSupabaseServerClient();
  const { data: monitor } = await supabase
    .from("listing_monitors")
    .select("product_id, etsy_listing_id, keywords, enabled")
    .eq("product_id", productId)
    .maybeSingle();
  if (!monitor) return apiError("forbidden", "Link an Etsy listing first.");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (keywords !== undefined) patch.keywords = keywords;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("listing_monitors")
    .update(patch)
    .eq("product_id", productId)
    .eq("user_id", user.id);
  if (error) {
    logEvent("listing.settings_persist_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not save. Try again.");
  }

  const enabled = typeof body.enabled === "boolean" ? body.enabled : Boolean(monitor.enabled);
  if (enabled && keywords !== undefined && keywords.length > 0 && isEtsyConfigured()) {
    try {
      const summary = await runListingMonitor(
        admin,
        [
          {
            product_id: productId,
            user_id: user.id,
            etsy_listing_id: Number(monitor.etsy_listing_id),
            keywords,
          },
        ],
        { maxWinnerScores: 0 }
      );
      const lists = summary.topByKeyword ? [...summary.topByKeyword.values()] : [];
      if (lists.length) after(() => scoreWinnerPhotos(admin, lists, 6));
    } catch {
      logEvent("listing.settings_snapshot_failed", { userId: user.id });
    }
  }

  return NextResponse.json({ ok: true, enabled, keywords: keywords ?? monitor.keywords });
}
