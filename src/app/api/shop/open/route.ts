import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { aiDisabled } from "@/lib/usage";
import { fetchEtsyImage, fetchListingsBatch, isEtsyConfigured } from "@/lib/etsy";
import { persistPhotoAndQueueRating, kickRatingWorker } from "@/lib/photo-persistence";
import { runListingMonitor } from "@/lib/listing-monitor";
import { suggestKeywords } from "@/lib/listing-analytics";
import { keywordsRemaining } from "@/lib/keyword-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Open a listing from the Shop home (north star 11.12 step 4b). If it is
 * already a Mavya product, return it. Otherwise: import its Etsy MAIN photo
 * through the normal upload + rating pipeline (one AI score, same as an
 * upload), create the product, and link the Etsy listing for daily tracking.
 * Supporting photos are not imported automatically (each would cost an AI
 * score); the seller can add them on the Photo tab.
 *
 * Only listings in the seller's own connected shop can be opened here.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required", "An active plan is needed.");
  }
  if (!entitlement.activeListingLimit) return apiError("billing_unavailable", "Your plan could not be verified. Try again shortly.");
  const limit = await rateLimit(`shop-open:u:${user.id}`, 30, 3_600_000);
  if (!limit.ok) return apiError("rate_limited", "Try again in a little while.");

  let body: { listingId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const listingId = typeof body?.listingId === "number" && Number.isSafeInteger(body.listingId) && body.listingId > 0 ? body.listingId : null;
  if (!listingId) return apiError("bad_request", "Invalid listing.");

  // Ownership under RLS: the listing must be in the caller's tracked shop.
  const supabase = await createSupabaseServerClient();
  const { data: shop, error: shopError } = await supabase.from("shop_monitors")
    .select("etsy_shop_id, current_listing_ids").maybeSingle();
  if (shopError) return apiError("persistence_failed", "Could not read your shop. Try again.");
  if (!shop?.current_listing_ids?.some((id: number | string) => Number(id) === listingId)) {
    return apiError("forbidden", "That listing is not currently tracked in your connected shop.");
  }
  const { data: inShop } = await supabase
    .from("shop_listing_snapshots")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("etsy_shop_id", shop.etsy_shop_id)
    .limit(1)
    .maybeSingle();
  if (!inShop) return apiError("forbidden", "That listing is not in your connected shop.");

  const { data: existing } = await supabase
    .from("listing_monitors")
    .select("product_id")
    .eq("etsy_listing_id", listingId)
    .limit(1)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, productId: existing.product_id, created: false });

  if (aiDisabled()) return apiError("ai_disabled", "Photo checks are paused right now. Try again later.");
  if (!isEtsyConfigured()) return apiError("etsy_unavailable", "Etsy connection is not set up yet.");

  let listing;
  try {
    listing = (await fetchListingsBatch([listingId], Date.now() + 20_000)).get(listingId);
  } catch {
    return apiError("etsy_unavailable", "Could not reach Etsy. Try again in a minute.");
  }
  if (!listing) return apiError("listing_not_found", "Etsy could not find that listing.");
  const main = listing.images[0];
  if (!main) return apiError("invalid_upload", "This listing has no photo to import.");

  // Import the main photo: full size when available, normalized to a JPEG the
  // upload pipeline accepts (<= 2000px, well under the 4MB limit).
  let file: File;
  try {
    const src = main.urlFull ?? main.url570;
    if (!src) throw new Error("no image url");
    let fetched;
    try {
      fetched = await fetchEtsyImage(src);
    } catch {
      if (!main.url570 || main.url570 === src) throw new Error("image fetch failed");
      fetched = await fetchEtsyImage(main.url570);
    }
    const jpeg = await sharp(fetched.buffer).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    file = new File([new Uint8Array(jpeg)], "etsy-main.jpg", { type: "image/jpeg" });
  } catch {
    logEvent("shop.open_image_failed", { userId: user.id });
    return apiError("source_unavailable", "Could not download this listing's photo from Etsy. Try again.");
  }

  const result = await persistPhotoAndQueueRating({
    userId: user.id,
    file,
    role: "main",
    idempotencyKey: `${user.id}:etsy-import:${listingId}:main`,
    productName: listing.title.slice(0, 120),
    activeListingLimit: entitlement.activeListingLimit,
  });
  if (!result.ok) {
    logEvent("shop.open_persist_failed", { userId: user.id, code: result.code });
    return apiError(result.code as Parameters<typeof apiError>[0], result.message);
  }
  after(() => kickRatingWorker(result.jobId));

  // Link the Etsy listing to the new product for daily tracking.
  const admin = createSupabaseAdminClient();
  const quota = await keywordsRemaining(supabase, entitlement.activeListingLimit, null);
  if (quota.error) return apiError("persistence_failed", "Photo saved, but linking failed. Open this listing again to retry.");
  const keywords = suggestKeywords(listing.title, listing.tags).slice(0, quota.remaining);
  const monitor = {
    product_id: result.productId,
    user_id: user.id,
    etsy_listing_id: listingId,
    etsy_shop_id: listing.shopId,
    revision: randomUUID(),
    listing_revision: randomUUID(),
    keywords,
    keyword_limit: quota.limit,
    enabled: true,
    next_check_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("listing_monitors").upsert(monitor, { onConflict: "product_id", ignoreDuplicates: true });
  if (error) {
    logEvent("shop.open_link_failed", { userId: user.id });
    return apiError("persistence_failed", "Photo saved, but linking failed. Open this listing again to retry.");
  }
  else {
    try {
      await runListingMonitor(
        admin,
        [{ product_id: result.productId, user_id: user.id, etsy_listing_id: listingId, keywords, revision: monitor.revision, listing_revision: monitor.listing_revision }],
        { maxWinnerScores: 0, deadlineAt: Date.now() + 25_000 }
      );
    } catch {
      logEvent("shop.open_first_check_failed", { userId: user.id });
    }
  }
  return NextResponse.json({ ok: true, productId: result.productId, created: true });
}
