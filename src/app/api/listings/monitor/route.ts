import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { logEvent } from "@/lib/errors";
import { timingSafeEqualString } from "@/lib/secret-compare";
import { isEtsyConfigured } from "@/lib/etsy";
import { runListingMonitor, scoreWinnerPhotos, todayUtc, type MonitorRow } from "@/lib/listing-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHUNK = 5;
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
 *
 * Schedule: ONCE a day (vercel.json). The Vercel Hobby plan only allows daily
 * crons. One run has a 240s budget; rows claimed but not reached go first in
 * the next run (ordered by next_check_at). Rough ceiling: ~100-150 monitored
 * listings per day with 3 keywords each. Beyond that, move to Vercel Pro and
 * an hourly schedule; the lease logic below already supports it.
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
  const now = new Date(started).toISOString();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("listing_monitors")
    .select("product_id, user_id, etsy_listing_id, keywords, revision, listing_revision, last_checked_on")
    .eq("enabled", true)
    .lte("next_check_at", now)
    .or(`last_checked_on.is.null,last_checked_on.lt.${today}`)
    .order("next_check_at", { ascending: true })
    .limit(200);
  if (error) {
    logEvent("listing_monitor.scan_failed", {});
    return NextResponse.json({ ok: false, reason: "scan_failed" }, { status: 500 });
  }

  // Atomically lease due rows. Concurrent cron calls cannot repeat API/AI
  // work; failed or unpaid rows rotate behind other work instead of starving it.
  const { data: claimed, error: claimError } = data?.length ? await admin.from("listing_monitors")
    .update({ next_check_at: new Date(started + 3_600_000).toISOString() })
    .in("product_id", data.map((r) => r.product_id)).eq("enabled", true).lte("next_check_at", now)
    .select("product_id, user_id, etsy_listing_id, keywords, revision, listing_revision, last_checked_on") : { data: [], error: null };
  if (claimError) return NextResponse.json({ ok: false, reason: "claim_failed" }, { status: 500 });
  const rows = (claimed as (MonitorRow & { last_checked_on: string | null })[] | null) ?? [];
  const activeByUser = new Map<string, boolean>();
  const due: MonitorRow[] = [];
  for (const r of rows) {
    if (Date.now() - started > TIME_BUDGET_MS - 20_000) break;
    if (!activeByUser.has(r.user_id)) {
      activeByUser.set(r.user_id, (await getEntitlement(r.user_id)).active);
    }
    if (!activeByUser.get(r.user_id)) {
      await admin.from("listing_monitors").update({ next_check_at: new Date(started + 86_400_000).toISOString() })
        .eq("product_id", r.product_id).eq("revision", r.revision);
    }
    if (activeByUser.get(r.user_id)) {
      due.push({
        product_id: r.product_id,
        user_id: r.user_id,
        etsy_listing_id: Number(r.etsy_listing_id),
        keywords: r.keywords ?? [],
        revision: r.revision,
        listing_revision: r.listing_revision,
      });
    }
  }

  const totals = { due: due.length, processed: 0, snapshots: 0, keywordSnapshots: 0, winnerPhotosScored: 0, errors: 0 };
  for (let i = 0; i < due.length; i += CHUNK) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const chunk = due.slice(i, i + CHUNK);
    try {
      const s = await runListingMonitor(admin, chunk, { today, maxWinnerScores: 0, deadlineAt: started + TIME_BUDGET_MS });
      totals.processed += chunk.length;
      totals.snapshots += s.snapshots;
      totals.keywordSnapshots += s.keywordSnapshots;
      totals.winnerPhotosScored += s.winnerPhotosScored;
      totals.errors += s.errors;
      // Snapshot progress is persisted before optional AI work. At most one
      // new score per chunk, and only while its full worst-case time fits.
      if (s.topByKeyword && totals.winnerPhotosScored < 6) {
        const scored = await scoreWinnerPhotos(admin, [...s.topByKeyword.values()], 1, started + TIME_BUDGET_MS);
        totals.winnerPhotosScored += scored.scored;
        totals.errors += scored.errors;
      }
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
