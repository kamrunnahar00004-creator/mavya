import Stripe from "stripe";

/**
 * Server-only Stripe client + helpers. Secrets never reach the browser.
 *
 * Required environment varies by operation. The API client and customer
 * portal require STRIPE_SECRET_KEY. Checkout additionally resolves its chosen
 * tier through the server-side plan registry. STRIPE_PRICE_ID remains only as
 * the legacy Founding-plan compatibility price.
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export function getStripePriceId(): string {
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) throw new Error("STRIPE_PRICE_ID is not configured");
  return price;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Billing period bounds. Newer Stripe API versions moved
 * current_period_start/end from the subscription onto its items; read both so
 * the webhook works regardless of the account's API version.
 */
export function subscriptionPeriod(sub: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const s = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
    items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> };
  };
  const item = s.items?.data?.[0];
  const start = s.current_period_start ?? item?.current_period_start;
  const end = s.current_period_end ?? item?.current_period_end;
  return {
    start: typeof start === "number" ? new Date(start * 1000).toISOString() : null,
    end: typeof end === "number" ? new Date(end * 1000).toISOString() : null,
  };
}

/** Flatten a Stripe subscription into our `subscriptions` row shape. */
export function subscriptionRowFrom(
  userId: string,
  sub: Stripe.Subscription
): Record<string, unknown> {
  const period = subscriptionPeriod(sub);
  return {
    user_id: userId,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: sub.items.data[0]?.price?.id ?? null,
    current_period_start: period.start,
    current_period_end: period.end,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };
}
