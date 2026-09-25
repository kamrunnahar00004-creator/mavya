import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { logEvent } from "@/lib/errors";
import { timingSafeEqualString } from "@/lib/secret-compare";
import { isEtsyConfigured } from "@/lib/etsy";
import { runListingMonitor, todayUtc, type MonitorRow } from "@/lib/listing-monitor";
import { runShopMonitor, type ShopMonitorRow } from "@/lib/shop-monitor";

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
 * crons. One run has a 240s budget. Claim only the next small batch: untouched
 * rows keep their earlier next_check_at and precede attempted work next day.
 * Throughput depends on provider latency and keyword overlap, not a fixed cap.
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
    .order("product_id", { ascending: true })
    .limit(200);
  if (error) {
    logEvent("listing_monitor.scan_failed", {});
    return NextResponse.json({ ok: false, reason: "scan_failed" }, { status: 500 });
  }

  const rows = (data as MonitorRow[] | null) ?? [];
  const activeByUser = new Map<string, boolean>();
  const totals = { due: 0, processed: 0, snapshots: 0, keywordSnapshots: 0, winnerPhotosScored: 0, errors: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    if (Date.now() - started >= TIME_BUDGET_MS - 20_000) break;
    const pending = rows.slice(i, i + CHUNK);
    // Claim just the batch we can start. A timeout/crash cannot erase the
    // scheduling priority of every unprocessed row in the 200-row scan.
    const { data: claimed, error: claimError } = await admin.from("listing_monitors")
      .update({ next_check_at: new Date(Date.now() + 3_600_000).toISOString() })
      .in("product_id", pending.map((r) => r.product_id)).eq("enabled", true).lte("next_check_at", now)
      .or(`last_checked_on.is.null,last_checked_on.lt.${today}`)
      .select("product_id, user_id, etsy_listing_id, keywords, revision, listing_revision, last_checked_on");
    if (claimError) return NextResponse.json({ ok: false, reason: "claim_failed" }, { status: 500 });
    const byId = new Map(((claimed as MonitorRow[] | null) ?? []).map((r) => [r.product_id, r]));
    const chunk: MonitorRow[] = [];
    // UPDATE RETURNING has no ordering guarantee. Restore the scan order.
    for (const p of pending) {
      const r = byId.get(p.product_id);
      if (!r) continue;
      if (!activeByUser.has(r.user_id)) activeByUser.set(r.user_id, (await getEntitlement(r.user_id)).active);
      if (!activeByUser.get(r.user_id)) {
        await admin.from("listing_monitors").update({ next_check_at: new Date(started + 86_400_000).toISOString() })
          .eq("product_id", r.product_id).eq("revision", r.revision);
      } else {
        chunk.push({ ...r, etsy_listing_id: Number(r.etsy_listing_id), keywords: r.keywords ?? [] });
      }
    }
    totals.due += chunk.length;
    if (!chunk.length) continue;
    try {
      const s = await runListingMonitor(admin, chunk, { today, maxWinnerScores: 0, deadlineAt: started + TIME_BUDGET_MS });
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

  // Shop tracking (Shop home) shares this daily run: Hobby allows daily crons
  // only. Each shop is claimed before work, paid-only, bounded by the budget.
  const shops = { due: 0, processed: 0, listings: 0, errors: 0 };
  if (Date.now() - started < TIME_BUDGET_MS - 30_000) {
    const { data: dueShops } = await admin
      .from("shop_monitors")
      .select("user_id, etsy_shop_id, shop_name")
      .eq("enabled", true)
      .lte("next_check_at", now)
      .or(`last_checked_on.is.null,last_checked_on.lt.${today}`)
      .order("next_check_at", { ascending: true })
      .limit(50);
    for (const s of (dueShops as ShopMonitorRow[] | null) ?? []) {
      if (Date.now() - started >= TIME_BUDGET_MS - 30_000) break;
      const { data: claimed } = await admin
        .from("shop_monitors")
        .update({ next_check_at: new Date(Date.now() + 3_600_000).toISOString() })
        .eq("user_id", s.user_id)
        .lte("next_check_at", now)
        .select("user_id");
      if (!claimed?.length) continue;
      shops.due += 1;
      const ent = await getEntitlement(s.user_id);
      if (!ent.active || !ent.activeListingLimit) {
        await admin.from("shop_monitors").update({ next_check_at: new Date(started + 86_400_000).toISOString() }).eq("user_id", s.user_id);
        continue;
      }
      try {
        const r = await runShopMonitor(admin, s, ent.activeListingLimit, today, started + TIME_BUDGET_MS);
        shops.processed += 1;
        shops.listings += r.listings;
      } catch {
        shops.errors += 1;
      }
    }
  }

  logEvent("listing_monitor.run", { ...totals, shops });
  return NextResponse.json({ ok: true, ...totals, shops });
}

export const GET = handle;
export const POST = handle;
