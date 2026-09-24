import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { logEvent } from "@/lib/errors";
import { timingSafeEqualString } from "@/lib/secret-compare";
import { isEtsyConfigured } from "@/lib/etsy";
import { runListingMonitor, todayUtc, type MonitorRow } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHUNK = 50;
const TIME_BUDGET_MS = 240_000;

/**
 * Daily Listing Coach cron (docs/NORTH_STAR_LISTING_COACH.md). NOT a user route.
 * Callable only with `Authorization: Bearer <CRON_SECRET or WORKER_SECRET>`;
 * Vercel Cron sends CRON_SECRET automatically.
 *
 * Snapshots every ENABLED monitor whose owner has an ACTIVE subscription
 * (paid-only: lapsed accounts stop costing Etsy quota and AI spend). Monitors
 * already checked today are skipped, so a re-run after a timeout resumes
 * instead of repeating work.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.WORKER_SECRET;
  const auth = req.headers.get("authorization");
  const presented = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || !presented || !timingSafeEqualString(presented, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEtsyConfigured()) {
    logEvent("listing_monitor.not_configured", {});
    return NextResponse.json({ ok: false, reason: "etsy_not_configured" }, { status: 503 });
  }

  const started = Date.now();
  const today = todayUtc();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("listing_monitors")
    .select("product_id, user_id, etsy_listing_id, keywords, last_checked_on")
    .eq("enabled", true)
    .or(`last_checked_on.is.null,last_checked_on.lt.${today}`)
    .order("last_checked_on", { ascending: true, nullsFirst: true })
    .limit(2000);
  if (error) {
    logEvent("listing_monitor.scan_failed", {});
    return NextResponse.json({ ok: false, reason: "scan_failed" }, { status: 500 });
  }

  const rows = (data as (MonitorRow & { last_checked_on: string | null })[] | null) ?? [];
  const activeByUser = new Map<string, boolean>();
  const due: MonitorRow[] = [];
  for (const r of rows) {
    if (!activeByUser.has(r.user_id)) {
      activeByUser.set(r.user_id, (await getEntitlement(r.user_id)).active);
    }
    if (activeByUser.get(r.user_id)) {
      due.push({
        product_id: r.product_id,
        user_id: r.user_id,
        etsy_listing_id: Number(r.etsy_listing_id),
        keywords: r.keywords ?? [],
      });
    }
  }

  const totals = { due: due.length, processed: 0, snapshots: 0, keywordSnapshots: 0, winnerPhotosScored: 0, errors: 0 };
  for (let i = 0; i < due.length; i += CHUNK) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const chunk = due.slice(i, i + CHUNK);
    try {
      const s = await runListingMonitor(admin, chunk, { today, maxWinnerScores: 6 });
      totals.processed += chunk.length;
      totals.snapshots += s.snapshots;
      totals.keywordSnapshots += s.keywordSnapshots;
      totals.winnerPhotosScored += s.winnerPhotosScored;
      totals.errors += s.errors;
    } catch (err) {
      totals.errors += 1;
      logEvent("listing_monitor.chunk_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logEvent("listing_monitor.run", totals);
  return NextResponse.json({ ok: true, ...totals });
}

export const GET = handle;
export const POST = handle;
