import { NextRequest, NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { resolveCheckoutPlan, type BillingCadence, type PlanKey } from "@/lib/plans";
import { getPlanRegistry } from "@/lib/plans.server";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURCHASABLE_PLAN_KEYS = new Set<string>(["starter", "shop", "power"]);
const CADENCES = new Set<string>(["monthly", "annual"]);

function parseCheckoutChoice(
  body: unknown
): { planKey: Exclude<PlanKey, "legacy">; cadence: BillingCadence } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { planKey?: unknown; cadence?: unknown };
  if (typeof b.planKey !== "string" || !PURCHASABLE_PLAN_KEYS.has(b.planKey)) return null;
  if (typeof b.cadence !== "string" || !CADENCES.has(b.cadence)) return null;
  return {
    planKey: b.planKey as Exclude<PlanKey, "legacy">,
    cadence: b.cadence as BillingCadence,
  };
}

/**
 * Create a Stripe Checkout session for the founder-approved plan/cadence the
 * browser requests. The browser supplies ONLY planKey and cadence -- never a
 * Stripe price id, price, or active-listing limit. The real price is
 * resolved server-side via resolveCheckoutPlan(), which fails closed for
 * "legacy" (structurally impossible anyway: it is not in
 * PURCHASABLE_PLAN_KEYS), for an unrecognized plan/cadence pair, and for a
 * plan/cadence whose Stripe price is not configured in this environment.
 *
 * Auth required. The Stripe customer is created server-side and linked to the
 * authenticated user; the browser only ever receives the redirect URL.
 * Activation happens ONLY via the webhook -- never from the success redirect.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return apiError("billing_unavailable", "Billing is not configured yet.");
  }
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in to subscribe.");

  const limit = await rateLimit(`checkout:u:${user.id}`, 5, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many attempts. Wait a minute.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const choice = parseCheckoutChoice(body);
  if (!choice) {
    return apiError("bad_request", "Choose a valid plan and billing cadence.");
  }

  const entitlement = await getEntitlement(user.id);
  if (entitlement.active) {
    return NextResponse.json(
      { ok: true, alreadySubscribed: true, url: null },
      { status: 200 }
    );
  }

  const resolved = resolveCheckoutPlan(getPlanRegistry(), choice.planKey, choice.cadence);
  if (!resolved) {
    // Either genuinely unavailable for checkout (legacy -- structurally
    // unreachable through PURCHASABLE_PLAN_KEYS, kept as defense in depth)
    // or this environment simply has not configured that price yet. Either
    // way, fail closed without describing which -- never leak env details.
    logEvent("billing.checkout_plan_unavailable", {
      userId: user.id,
      planKey: choice.planKey,
      cadence: choice.cadence,
    });
    return apiError("billing_unavailable", "That plan is not available right now.");
  }
  const priceId = resolved.priceId;

  const stripe = getStripe();
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

    // The local webhook row can be stale or can refer to an old price. Check
    // Stripe before creating a new subscription so a missed webhook or price
    // rotation cannot make the customer pay twice.
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const liveSubscription = subscriptions.data.find((subscription) =>
      ["active", "trialing", "past_due"].includes(subscription.status)
    );
    if (liveSubscription) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${req.nextUrl.origin}/subscribe`,
      });
      return NextResponse.json(
        { ok: true, alreadySubscribed: true, url: portal.url },
        { status: 200 }
      );
    }

    // Reuse an open session only if it targets the SAME resolved price --
    // a stale open session for a different plan/cadence must not be reused.
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
      metadata: {
        user_id: user.id,
        plan_key: choice.planKey,
        cadence: choice.cadence,
        price_id: priceId,
      },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe?checkout=cancelled`,
      allow_promotion_codes: false,
    }, {
      idempotencyKey: `mavya-checkout-${user.id}-${choice.planKey}-${choice.cadence}-${Math.floor(Date.now() / 60_000)}`,
    });

    if (!session.url) {
      return apiError("billing_unavailable", "Checkout could not be started. Try again.");
    }
    logEvent("billing.checkout_created", {
      userId: user.id,
      planKey: choice.planKey,
      cadence: choice.cadence,
    });
    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (err) {
    logEvent("billing.checkout_failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("billing_unavailable", "Checkout could not be started. Try again.");
  }
}
