import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { EtsyApiError, fetchShopByName, isEtsyConfigured, parseEtsyShopInput } from "@/lib/etsy";
import { runShopMonitor } from "@/lib/shop-monitor";
import { todayUtc } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Connect (or switch) the seller's Etsy shop by name or shop link. Public data
 * only: no Etsy login. One shop per Mavya account. Runs the first daily
 * snapshot right away so the Shop home has listings on day 1.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required", "Shop tracking needs an active subscription.");
  }
  if (!entitlement.activeListingLimit) return apiError("billing_unavailable", "Your plan could not be verified. Try again shortly.");
  const limit = await rateLimit(`shop-connect:u:${user.id}`, 6, 3_600_000);
  if (!limit.ok) return apiError("rate_limited", "Try again in a little while.");
  if (!isEtsyConfigured()) return apiError("etsy_unavailable", "Etsy connection is not set up yet.");

  let body: { shop?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("bad_request", "Invalid request body.");
  const name = typeof body.shop === "string" ? parseEtsyShopInput(body.shop.slice(0, 200)) : null;
  if (!name) return apiError("bad_request", "Enter your Etsy shop name, like MyCrochetShop.");

  let shop;
  try {
    shop = await fetchShopByName(name);
  } catch (err) {
    logEvent("shop.connect_etsy_failed", { userId: user.id, code: err instanceof EtsyApiError ? err.code : "unknown" });
    return apiError("etsy_unavailable", "Could not reach Etsy. Try again in a minute.");
  }
  if (!shop) return apiError("listing_not_found", "Etsy could not find that shop. Check the spelling.");

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("shop_monitors").upsert(
    {
      user_id: user.id,
      etsy_shop_id: shop.shopId,
      shop_name: shop.shopName,
      enabled: true,
      next_check_at: new Date(Date.now() + 3_600_000).toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    logEvent("shop.connect_persist_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not save. Try again.");
  }

  let tracked = 0;
  try {
    tracked = (await runShopMonitor(admin, { user_id: user.id, etsy_shop_id: shop.shopId, shop_name: shop.shopName }, entitlement.activeListingLimit, todayUtc(), Date.now() + 60_000)).listings;
  } catch {
    // runShopMonitor recorded last_error; the daily check retries.
  }
  return NextResponse.json({ ok: true, shop: shop.shopName, tracked, activeListings: shop.activeListings });
}
