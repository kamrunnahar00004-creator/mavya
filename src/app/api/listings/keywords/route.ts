import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { isEtsyConfigured } from "@/lib/etsy";
import { findKeywordIdeas } from "@/lib/keyword-finder-server";
import { todayUtc } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Keyword ideas for one linked listing: labeled Winning / Add as tag / Keep /
 * Too crowded / Nobody's looking, with competition, interest, and position.
 * Paid-only, no AI, public Etsy data through the shared daily search cache.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required", "Keyword ideas need an active subscription.");
  }
  const limit = await rateLimit(`listing-keywords:u:${user.id}`, 15, 3_600_000);
  if (!limit.ok) return apiError("rate_limited", "Try again in a little while.");
  if (!isEtsyConfigured()) return apiError("etsy_unavailable", "Etsy connection is not set up yet.");

  let body: { productId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("bad_request", "Invalid request body.");
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!UUID_RE.test(productId)) return apiError("bad_request", "Invalid product id.");

  // Ownership under RLS: only the owner can see the monitor and its snapshots.
  const supabase = await createSupabaseServerClient();
  const { data: monitor } = await supabase
    .from("listing_monitors")
    .select("etsy_listing_id, keywords, listing_revision")
    .eq("product_id", productId)
    .maybeSingle();
  if (!monitor) return apiError("forbidden", "Link your Etsy listing first.");
  const { data: snap } = await supabase
    .from("listing_snapshots")
    .select("title, tags")
    .eq("product_id", productId)
    .eq("listing_revision", monitor.listing_revision)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) return apiError("forbidden", "Mavya is still reading your listing. Try again in a minute.");

  try {
    const ideas = await findKeywordIdeas(
      createSupabaseAdminClient(),
      { listingId: Number(monitor.etsy_listing_id), title: snap.title ?? "", tags: snap.tags ?? [] },
      (monitor.keywords as string[] | null)?.[0] ?? null,
      todayUtc()
    );
    return NextResponse.json({ ok: true, ideas });
  } catch {
    logEvent("listing.keywords_failed", { userId: user.id });
    return apiError("etsy_unavailable", "Could not reach Etsy. Try again in a minute.");
  }
}
