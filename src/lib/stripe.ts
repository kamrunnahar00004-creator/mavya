/**
 * Server-only Stripe client. Never import from a client component — relies on
 * STRIPE_SECRET_KEY. Used by /api/checkout.
 */

import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY not set.");
  }
  cached = new Stripe(key);
  return cached;
}

export const IMPROVED_PHOTO_PRICE_CENTS = 499;

export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}
