import { NextRequest, NextResponse } from "next/server";
import {
  isFunnelEvent,
  trackFunnelEvent,
} from "@/lib/analytics-events";
import { clientIp } from "@/lib/request-ip";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = await rateLimit(`track:${ip}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let body: { event?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!isFunnelEvent(body.event)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  await trackFunnelEvent(body.event);
  return NextResponse.json({ ok: true }, { status: 200 });
}
