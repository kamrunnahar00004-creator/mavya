import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = await rateLimit(`verify-payment:${ip}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        paid: false,
        error:
          limit.reason === "missing_durable_store"
            ? "Rate limiting is not configured."
            : "Too many requests. Wait a minute.",
      },
      { status: limit.reason === "missing_durable_store" ? 503 : 429 }
    );
  }

  let body: { sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { paid: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId.startsWith("cs_")) {
    return NextResponse.json(
      { paid: false, error: "Invalid checkout session." },
      { status: 400 }
    );
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const isExpectedProduct =
      session.metadata?.product === "improved_photo" &&
      session.metadata?.validation_flow === "clean_preview_before_payment";
    const paid = session.payment_status === "paid" && isExpectedProduct;

    return NextResponse.json(
      { paid },
      { status: paid ? 200 : 402 }
    );
  } catch (err) {
    console.error("[api/verify-payment] stripe verify failed:", err);
    return NextResponse.json(
      { paid: false, error: "Could not verify payment." },
      { status: 502 }
    );
  }
}
