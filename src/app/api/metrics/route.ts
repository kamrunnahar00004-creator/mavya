import { NextRequest, NextResponse } from "next/server";
import { funnelMetrics } from "@/lib/analytics-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.METRICS_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "METRICS_SECRET is not configured." },
      { status: 503 }
    );
  }

  const token = req.nextUrl.searchParams.get("secret");
  if (token !== secret) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    return NextResponse.json(await funnelMetrics(), { status: 200 });
  } catch (err) {
    console.error("[api/metrics] failed:", err);
    return NextResponse.json(
      { error: "Could not load metrics." },
      { status: 502 }
    );
  }
}
