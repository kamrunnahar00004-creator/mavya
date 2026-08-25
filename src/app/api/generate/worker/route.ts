import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  recoverStaleJobs,
  recoverFailuresWithoutSuccessor,
  runQueuedGenerationOnce,
  runQueuedRefinementOnce,
} from "@/lib/refinement";
import {
  recoverStaleRatingJobs,
  requeueReadyDependencyRatingJobs,
  runQueuedRatingBatch,
} from "@/lib/rating-jobs";
import { drainStorageCleanup } from "@/lib/storage-cleanup";
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
  // Durable backstop: re-queue any failed/rejected attempt that owes work but
  // has no bounded successor (refund failed AND the inline queue failed), for
  // ANY failure code. A scan-query failure is surfaced (logged + reported),
  // never a silent zero, and never aborts the rest of the tick.
  let failuresRequeued = 0;
  let failureScanError = false;
  try {
    failuresRequeued = await recoverFailuresWithoutSuccessor(admin);
  } catch {
    failureScanError = true;
    logEvent("worker.failure_scan_failed", {});
  }
  const staleRatingsRecovered = await recoverStaleRatingJobs();
  let dependencyRatingsRequeued = 0;
  let dependencyRatingScanError = false;
  try {
    dependencyRatingsRequeued = await requeueReadyDependencyRatingJobs();
  } catch {
    dependencyRatingScanError = true;
    logEvent("worker.rating_dependency_scan_failed", {});
  }
  // Durable backstop for the deletion outbox (the delete endpoints also kick a
  // drain via after(); this guarantees eventual cleanup if that kick died).
  const storageCleaned = await drainStorageCleanup(admin);

  // A listing can contain one main plus nine supporting photos. Drain one
  // listing-sized rating batch so the daily backstop does not require one day
  // per photo. Generation remains one-at-a-time when no ratings are waiting.
  const processed: string[] = [];
  const ratingJobIds = await runQueuedRatingBatch(10);
  processed.push(...ratingJobIds);
  const genJobId = ratingJobIds.length ? null : await runQueuedGenerationOnce();
  if (genJobId) processed.push(genJobId);
  const jobId =
    ratingJobIds.length || genJobId ? null : await runQueuedRefinementOnce();
  if (jobId) processed.push(jobId);

  logEvent("worker.tick", {
    staleFailed,
    failuresRequeued,
    failureScanError,
    staleRatingsRecovered,
    dependencyRatingsRequeued,
    dependencyRatingScanError,
    storageCleaned,
    processed: processed.length,
  });
  return NextResponse.json(
    {
      ok: true,
      staleFailed,
      failuresRequeued,
      failureScanError,
      staleRatingsRecovered,
      dependencyRatingsRequeued,
      dependencyRatingScanError,
      storageCleaned,
      processed,
    },
    { status: 200 }
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
