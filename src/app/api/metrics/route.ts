import { NextRequest, NextResponse } from "next/server";
import { funnelMetrics } from "@/lib/analytics-events";
import { timingSafeEqualString } from "@/lib/secret-compare";

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

  // Prefer the Authorization header: a query string is written to Vercel
  // access logs, browser history, and any Referer the page emits, so the
  // secret leaks into places that outlive the request. The ?secret= form is
  // still accepted so existing bookmarks keep working, but it is deprecated
  // -- rotate METRICS_SECRET once nothing depends on it, since prior values
  // are already in log retention.
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const token = bearer ?? req.nextUrl.searchParams.get("secret");
  if (!token || !timingSafeEqualString(token, secret)) {
    // 404, not 403: never confirm that this endpoint exists.
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
