import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight uptime endpoint. It proves the deployment can answer requests,
 * but it does not authenticate or touch the database. Vercel may execute a
 * dynamic page in a different function instance, so pinging this route must
 * not be treated as a guarantee that dashboard cold starts are eliminated.
 */
export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() }, { status: 200 });
}
