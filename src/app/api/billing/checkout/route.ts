import { NextRequest, NextResponse } from "next/server";
import { getStripe, getStripePriceId, stripeConfigured } from "@/lib/stripe";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a Stripe Checkout session for the $19/month Founding Beta.
 * Auth required. The Stripe customer is created server-side and linked to the
 * authenticated user; the browser only ever receives the redirect URL.
 * Activation happens ONLY via the webhook — never from the success redirect.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return apiError("billing_unavailable", "Billing is not configured yet.");
  }
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in to subscribe.");

  const limit = await rateLimit(`checkout:u:${user.id}`, 5, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many attempts. Wait a minute.");

  const entitlement = await getEntitlement(user.id);
  if (entitlement.active) {
    return NextResponse.json(
      { ok: true, alreadySubscribed: true, url: null },
      { status: 200 }
    );
  }

    const stripe = getStripe();
    const priceId = getStripePriceId();
    const admin = createSupabaseAdminClient();

  try {
    // Reuse the linked customer or create one bound to this user id.
    let customerId = entitlement.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      }, { idempotencyKey: `mavya-customer-${user.id}` });
      customerId = customer.id;
      const { error } = await admin.from("subscriptions").upsert(
        {
          user_id: user.id,
          stripe_customer_id: customerId,
          status: "inactive",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;
    }

    const openSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 10,
    });
    const existingSession = openSessions.data.find(
      (session) =>
        session.client_reference_id === user.id &&
        session.mode === "subscription" &&
        session.metadata?.price_id === priceId
    );
    if (existingSession?.url) {
      return NextResponse.json({ ok: true, url: existingSession.url }, { status: 200 });
    }

    const origin = req.nextUrl.origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: user.id, price_id: priceId },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe?checkout=cancelled`,
      allow_promotion_codes: false,
    }, {
      idempotencyKey: `mavya-checkout-${user.id}-${Math.floor(Date.now() / 60_000)}`,
    });

    if (!session.url) {
      return apiError("billing_unavailable", "Checkout could not be started. Try again.");
    }
    logEvent("billing.checkout_created", { userId: user.id });
    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (err) {
    logEvent("billing.checkout_failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("billing_unavailable", "Checkout could not be started. Try again.");
  }
}
