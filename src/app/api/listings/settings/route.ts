import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { isEtsyConfigured } from "@/lib/etsy";
import { normalizeKeywords } from "@/lib/listing-analytics";
import { keywordsRemaining } from "@/lib/keyword-quota";
import { runListingMonitor } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("bad_request", "Invalid request body.");
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
  let listingLimit: number | null = null;
  if (turningOnOrEditing) {
    const entitlement = await getEntitlement(user.id);
    if (!entitlement.active) {
      return apiError(
        entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required",
        "Listing monitoring needs an active subscription."
      );
    }
    listingLimit = entitlement.activeListingLimit;
  }

  // Ownership under RLS: the monitor row is only visible to its owner.
  const supabase = await createSupabaseServerClient();
  const { data: monitor } = await supabase
    .from("listing_monitors")
    .select("product_id, etsy_listing_id, keywords, enabled, revision, listing_revision")
    .eq("product_id", productId)
    .maybeSingle();
  if (!monitor) return apiError("forbidden", "Link an Etsy listing first.");
  if (turningOnOrEditing && !(await rateLimit(`listing-check:u:${user.id}`, 30, 86_400_000)).ok) return apiError("rate_limited", "Daily manual check limit reached. Automatic monitoring will continue.");
  // Plan keyword allowance across all listings (each keyword = 1 Etsy call a day).
  if (keywords !== undefined && keywords.length > 0) {
    const quota = await keywordsRemaining(supabase, listingLimit, productId);
    if (keywords.length > quota.remaining) {
      return apiError(
        "bad_request",
        `Your plan tracks up to ${quota.limit} keywords across your listings (${quota.used} in use). Remove one to add another.`
      );
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (keywords !== undefined) patch.keywords = keywords;
  const changedKeywords = keywords !== undefined && JSON.stringify(keywords) !== JSON.stringify(monitor.keywords);
  const revision = changedKeywords ? randomUUID() : monitor.revision as string;
  if (changedKeywords) Object.assign(patch, { revision, last_checked_on: null, last_error: null });
  if (changedKeywords || body.enabled === true) patch.next_check_at = new Date().toISOString();

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("listing_monitors")
    .update(patch)
    .eq("product_id", productId)
    .eq("user_id", user.id)
    .eq("revision", monitor.revision)
    .select("product_id");
  if (error) {
    logEvent("listing.settings_persist_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not save. Try again.");
  }
  if (!updated?.length) return apiError("idempotency_conflict", "Monitoring changed in another request. Refresh and try again.");

  const enabled = typeof body.enabled === "boolean" ? body.enabled : Boolean(monitor.enabled);
  const check = async () => {
    try {
      await runListingMonitor(
        admin,
        [
          {
            product_id: productId,
            user_id: user.id,
            etsy_listing_id: Number(monitor.etsy_listing_id),
            keywords: keywords ?? monitor.keywords,
            revision,
            listing_revision: monitor.listing_revision as string,
          },
        ],
        { maxWinnerScores: 0, deadlineAt: Date.now() + 30_000 }
      );
    } catch {
      logEvent("listing.settings_snapshot_failed", { userId: user.id });
      await admin.from("listing_monitors").update({ last_error: "check_failed" }).eq("product_id", productId).eq("revision", revision);
    }
  };
  if (enabled && isEtsyConfigured()) {
    // New keywords: the seller clicked "Save and check now" and expects fresh
    // positions in the response. Resuming monitoring only needs the switch to
    // flip, so its Etsy check runs after the response instead of blocking the
    // toggle for several seconds.
    if (changedKeywords) await check();
    else if (body.enabled === true) after(check);
  }

  return NextResponse.json({ ok: true, enabled, keywords: keywords ?? monitor.keywords });
}
