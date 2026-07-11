import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, subscriptionRowFrom } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. THE single writer of subscription state.
 *
 * Security model:
 *  - Signature verification with STRIPE_WEBHOOK_SECRET on the RAW body. An
 *    unsigned or tampered payload is rejected before any read or write.
 *  - Replay protection: the event id is inserted into billing_events (primary
 *    key) BEFORE processing; a duplicate delivery hits the unique violation
 *    and is acknowledged without reprocessing. Renewal allowances cannot
 *    double-grant anyway (period-keyed counters), this guards the state writes.
 *  - The user mapping comes from OUR metadata (subscription_data.metadata.user_id
 *    set at checkout, or client_reference_id), falling back to the persisted
 *    stripe_customer_id mapping. Nothing client-supplied is trusted.
 *
 * Events handled:
 *  - checkout.session.completed          initial link + activation
 *  - customer.subscription.created       state upsert
 *  - customer.subscription.updated       renewals, past_due, cancel-at-period-end
 *  - customer.subscription.deleted       final cancellation
 *  - invoice.paid                        period refresh on renewal
 *  - invoice.payment_failed              logged; status arrives via subscription.updated
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logEvent("stripe.webhook_unconfigured", {});
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    logEvent("stripe.webhook_bad_signature", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Replay protection: first delivery wins; duplicates are acknowledged as-is.
  const { error: dedupeError } = await admin
    .from("billing_events")
    .insert({ id: event.id, type: event.type });
  if (dedupeError) {
    if (dedupeError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    // Fail so Stripe retries: better a retried event than a lost state change.
    logEvent("stripe.webhook_dedupe_failed", { eventId: event.id, error: dedupeError.message });
    return NextResponse.json({ error: "storage failure" }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (userId && subscriptionId) {
          const sub = await getStripe().subscriptions.retrieve(subscriptionId);
          await upsertSubscription(admin, userId, sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(admin, sub);
        if (userId) await upsertSubscription(admin, userId, sub);
        else logEvent("stripe.webhook_unmapped_subscription", { subId: sub.id });
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoiceSubscriptionId(invoice);
        if (subscriptionId) {
          const sub = await getStripe().subscriptions.retrieve(subscriptionId);
          const userId = await resolveUserId(admin, sub);
          if (userId) await upsertSubscription(admin, userId, sub);
        }
        break;
      }
      case "invoice.payment_failed": {
        // Status transition (past_due) arrives via customer.subscription.updated.
        logEvent("stripe.invoice_payment_failed", { eventId: event.id });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Processing failed after dedupe: release the id so Stripe's retry can
    // reprocess instead of being swallowed as a "duplicate".
    await admin.from("billing_events").delete().eq("id", event.id);
    logEvent("stripe.webhook_processing_failed", {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "processing failure" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Map a Stripe subscription to our user: metadata first, then customer id. */
async function resolveUserId(
  admin: Admin,
  sub: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = sub.metadata?.user_id;
  if (typeof fromMetadata === "string" && fromMetadata.length > 0) {
    return fromMetadata;
  }
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function upsertSubscription(
  admin: Admin,
  userId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const row = subscriptionRowFrom(userId, sub);
  const { error } = await admin
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  logEvent("stripe.subscription_upserted", {
    userId,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

/** Invoice -> subscription id across Stripe API versions. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } };
  };
  const direct = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  if (!direct) return null;
  return typeof direct === "string" ? direct : direct.id ?? null;
}
