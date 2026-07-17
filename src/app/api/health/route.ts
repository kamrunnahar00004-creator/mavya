import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keep-warm / uptime endpoint. No auth, no database work, near-zero cost.
 * Point an external pinger (e.g. UptimeRobot, 5-minute interval) at
 * GET /api/health to keep the serverless function warm on the Hobby plan,
 * removing the slow first click after idle periods.
 */
export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() }, { status: 200 });
}
