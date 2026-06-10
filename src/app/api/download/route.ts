import { NextRequest, NextResponse } from "next/server";
import { getCleanImage, getMeta, isAssetId } from "@/lib/blob-store";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the clean full-resolution image ONLY after verifying a paid Stripe
 * session. The clean blob URL is never returned; the bytes are piped through
 * this verified endpoint. No payment -> no bytes.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }

  let assetId: string | undefined;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed." }, { status: 403 });
    }
    const candidate = session.metadata?.assetId;
    if (!isAssetId(candidate)) {
      return NextResponse.json({ error: "Invalid session." }, { status: 400 });
    }
    assetId = candidate;
  } catch (err) {
    console.error("[api/download] stripe verify failed:", err);
    return NextResponse.json({ error: "Could not verify payment." }, { status: 403 });
  }

  // The asset must still be a valid publish_ready record.
  const meta = await getMeta(assetId);
  if (!meta) {
    return NextResponse.json({ error: "File is no longer available." }, { status: 404 });
  }

  const clean = await getCleanImage(assetId);
  if (!clean) {
    return NextResponse.json({ error: "File is no longer available." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(clean), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition":
        'attachment; filename="mavya-improved-photo.png"',
      "Cache-Control": "no-store",
    },
  });
}
