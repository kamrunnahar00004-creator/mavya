import { NextRequest, NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { getSessionUser } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe billing portal: cancellation, payment-method updates, invoices.
 * Auth required; the portal session is created for the caller's own linked
 * Stripe customer only.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return apiError("billing_unavailable", "Billing is not configured yet.");
  }
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const limit = await rateLimit(`portal:u:${user.id}`, 5, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many attempts. Wait a minute.");

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.stripeCustomerId) {
    return apiError("source_unavailable", "No billing account found. Subscribe first.");
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: entitlement.stripeCustomerId,
      return_url: `${req.nextUrl.origin}/subscribe`,
    });
    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (err) {
    logEvent("billing.portal_failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("billing_unavailable", "Billing management could not be opened. Try again.");
  }
}
