import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recoverStaleJobs, runQueuedRefinementOnce } from "@/lib/refinement";
import {
  recoverStaleRatingJobs,
  runQueuedRatingOnce,
} from "@/lib/rating-jobs";
import { logEvent } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

/**
 * Background-refinement worker: the DURABLE executor for queued attempt-2/3
 * refinement jobs plus stale-job recovery.
 *
 * NOT a user route. Callable only with the worker secret:
 *   Authorization: Bearer <CRON_SECRET or WORKER_SECRET>
 * Vercel Cron sends CRON_SECRET automatically when the env var is set.
 *
 * Honest execution model on Vercel serverless: the generate route triggers a
 * best-effort in-invocation run via after(); this worker is the recovery path
 * that guarantees queued attempts eventually run even if that invocation died.
 * Claiming is an atomic queued->generating compare-and-set, so a cron tick and
 * an after() run can never execute the same attempt twice.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.WORKER_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const staleFailed = await recoverStaleJobs(admin);
  const staleRatingsRecovered = await recoverStaleRatingJobs();

  // Process one queued refinement per tick. Each attempt can take minutes, so
  // a second attempt in the same serverless invocation risks being killed at
  // the route limit. A scheduler can invoke this endpoint again for the next
  // queued attempt.
  const processed: string[] = [];
  const ratingJobId = await runQueuedRatingOnce();
  if (ratingJobId) processed.push(ratingJobId);
  // Keep one expensive AI operation per tick. The next scheduler invocation
  // handles refinement when a durable rating consumed this invocation.
  const jobId = ratingJobId ? null : await runQueuedRefinementOnce();
  if (jobId) processed.push(jobId);

  logEvent("worker.tick", {
    staleFailed,
    staleRatingsRecovered,
    processed: processed.length,
  });
  return NextResponse.json(
    { ok: true, staleFailed, staleRatingsRecovered, processed },
    { status: 200 }
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
