import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { EtsyApiError, fetchListingsBatch, isEtsyConfigured, parseEtsyListingInput } from "@/lib/etsy";
import { normalizeKeywords, suggestKeywords, type TopEntry } from "@/lib/listing-analytics";
import { runListingMonitor, scoreWinnerPhotos } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Link a product (listing slot) to a PUBLIC Etsy listing and take the first
 * snapshot right away, so the Analytics page has something on day 1.
 *
 * Paid-only (docs/NORTH_STAR_LISTING_COACH.md: nothing is free). The browser
 * sends only a product id, a pasted link, and optional keywords. Ownership is
 * checked under RLS before any service-role write. No Etsy login, no writes
 * to Etsy.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(
      entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required",
      "Listing monitoring needs an active subscription."
    );
  }

  const limit = await rateLimit(`listing-link:u:${user.id}`, 10, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  if (!isEtsyConfigured()) return apiError("etsy_unavailable", "Etsy connection is not set up yet.");

  let body: { productId?: unknown; listing?: unknown; keywords?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!UUID_RE.test(productId)) return apiError("bad_request", "Invalid product id.");
  const listingId =
    typeof body.listing === "string" ? parseEtsyListingInput(body.listing.slice(0, 500)) : null;
  if (!listingId) {
    return apiError("bad_request", "Paste the full Etsy listing link, like etsy.com/listing/123456789/...");
  }
  const requestedKeywords = body.keywords === undefined ? undefined : normalizeKeywords(body.keywords);
  if (requestedKeywords === null) return apiError("bad_request", "Up to 3 keywords, 80 characters each.");

  const supabase = await createSupabaseServerClient();
  const { data: owned } = await supabase.from("products").select("id").eq("id", productId).maybeSingle();
  if (!owned) return apiError("forbidden", "You cannot change this product.");

  let listing;
  try {
    listing = (await fetchListingsBatch([listingId])).get(listingId);
  } catch (err) {
    logEvent("listing.link_etsy_failed", {
      userId: user.id,
      code: err instanceof EtsyApiError ? err.code : "unknown",
    });
    return apiError("etsy_unavailable", "Could not reach Etsy. Try again in a minute.");
  }
  if (!listing) return apiError("listing_not_found", "Etsy could not find that listing. Check the link.");

  const keywords =
    requestedKeywords && requestedKeywords.length > 0
      ? requestedKeywords
      : suggestKeywords(listing.title, listing.tags);

  const admin = createSupabaseAdminClient();
  const monitor = {
    product_id: productId,
    user_id: user.id,
    etsy_listing_id: listingId,
    etsy_shop_id: listing.shopId,
    keywords,
    enabled: true,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("listing_monitors").upsert(monitor, { onConflict: "product_id" });
  if (error) {
    logEvent("listing.link_persist_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not save. Try again.");
  }

  // First snapshot now (without AI scoring, to keep the request fast); winner
  // photos are scored after the response.
  let topLists: TopEntry[][] = [];
  try {
    const summary = await runListingMonitor(
      admin,
      [{ product_id: productId, user_id: user.id, etsy_listing_id: listingId, keywords }],
      { maxWinnerScores: 0 }
    );
    topLists = summary.topByKeyword ? [...summary.topByKeyword.values()] : [];
  } catch {
    logEvent("listing.first_snapshot_failed", { userId: user.id });
  }
  if (topLists.length) {
    after(() => scoreWinnerPhotos(admin, topLists, 6));
  }

  return NextResponse.json({ ok: true, listingId, keywords, title: listing.title });
}
