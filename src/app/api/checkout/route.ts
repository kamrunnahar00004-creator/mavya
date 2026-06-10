import { NextRequest, NextResponse } from "next/server";
import {
  IMPROVED_PHOTO_PRICE_CENTS,
  appUrl,
  getStripe,
} from "@/lib/stripe";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`checkout:${ip}`, 10, 60_000).ok) {
    return NextResponse.json(
      { error: "Too many requests. Wait a minute." },
      { status: 429 }
    );
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(email ? { customer_email: email } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: IMPROVED_PHOTO_PRICE_CENTS,
            product_data: {
              name: "Mavya full-resolution improved photo",
            },
          },
        },
      ],
      metadata: {
        product: "improved_photo",
        validation_flow: "clean_preview_before_payment",
      },
      success_url: `${appUrl()}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/?checkout=cancelled`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Could not start checkout. Try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    console.error("[api/checkout] stripe error:", err);
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 502 }
    );
  }
}
