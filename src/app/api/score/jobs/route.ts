import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled } from "@/lib/usage";
import { persistPhotoAndQueueRating, kickRatingWorker } from "@/lib/photo-persistence";
import {
  recoverStaleRatingJobs,
  requeueReadyDependencyRatingJobs,
  runQueuedRatingJobsById,
  runQueuedRatingOnce,
} from "@/lib/rating-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

type ExistingJob = {
  id: string;
  product_id: string;
  photo_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
};

function payload(job: ExistingJob) {
  return {
    ok: job.status === "completed",
    jobId: job.id,
    productId: job.product_id,
    photoId: job.photo_id,
    status: job.status,
    errorCode: job.error_code,
    message: job.error_message,
  };
}

/** Persist the upload and queue scoring before returning to the browser. */
export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now();
  if (aiDisabled()) return apiError("ai_disabled", "AI scoring is temporarily disabled.");
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in to rate photos.");
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(
      entitlement.reason === "past_due" ? "subscription_past_due" : "subscription_required",
      "An active plan is needed to rate photos."
    );
  }
  if (entitlement.activeListingLimit == null) {
    // An active subscription with no resolvable plan limit should not
    // happen (entitlements.ts always pairs active:true with a resolved
    // plan), but fail closed explicitly rather than let a new product get
    // created with an undefined limit.
    logEvent("rating.plan_limit_missing", { userId: user.id });
    return apiError("billing_unavailable", "Your plan could not be verified. Try again shortly.");
  }
  const userLimit = await rateLimit(`score-start:u:${user.id}`, 6, 60_000);
  const ipLimit = await rateLimit(`score-start:${clientIp(req)}`, 12, 60_000);
  if (!userLimit.ok || !ipLimit.ok) {
    return apiError("rate_limited", "Too many requests. Wait a minute.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("bad_request", "Invalid form data.");
  }
  const file = form.get("image");
  const requestId = form.get("request_id");
  const role = form.get("role") === "supporting" ? "supporting" : "main";
  const requestedProductId = form.get("product_id");
  const requestedPhotoId = form.get("photo_id");
  const name = form.get("name");
  if (!(file instanceof File)) return apiError("bad_request", "Missing image upload.");
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) {
    return apiError("bad_request", "Missing upload request id.");
  }

  const result = await persistPhotoAndQueueRating({
    userId: user.id,
    file,
    role,
    idempotencyKey: `${user.id}:rating:${requestId}`,
    productId: typeof requestedProductId === "string" ? requestedProductId : undefined,
    productName: typeof name === "string" ? name : null,
    photoId: typeof requestedPhotoId === "string" ? requestedPhotoId : undefined,
    activeListingLimit: entitlement.activeListingLimit,
  });

  if (!result.ok) {
    logEvent("rating.queue_failed", { userId: user.id, code: result.code });
    return apiError(result.code as Parameters<typeof apiError>[0], result.message);
  }

  after(() => kickRatingWorker(result.jobId));
  // Action-start latency span (no ids/paths).
  console.log(
    JSON.stringify({ event: "perf", span: "rating.start", ms: Date.now() - requestStartedAt })
  );
  return NextResponse.json(
    payload({
      id: result.jobId,
      product_id: result.productId,
      photo_id: result.photoId,
      status: result.status,
      error_code: result.errorCode,
      error_message: result.message,
    }),
    { status: 202 }
  );
}

/** Refresh-safe status for a dashboard card or product workspace. */
export async function GET(req: NextRequest) {
  // Polling can recover, requeue, and start paid rating work below, so this
  // endpoint retains fresh Auth-server verification. Dashboard callers batch
  // their job ids into one request to remove the former per-card auth fan-out.
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const jobId = req.nextUrl.searchParams.get("id");
  const photoId = req.nextUrl.searchParams.get("photoId");
  const batchIds = [...new Set(
    (req.nextUrl.searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  )];
  if (batchIds.length > 40 || batchIds.some((id) => !/^[a-zA-Z0-9-]{8,100}$/.test(id))) {
    return apiError("bad_request", "Invalid rating job ids.");
  }
  if (!jobId && !photoId && batchIds.length === 0) {
    return apiError("bad_request", "Missing rating job id.");
  }
  const supabase = await createSupabaseServerClient();
  if (batchIds.length > 0) {
    const { data: jobs, error } = await supabase
      .from("rating_jobs")
      .select("id, product_id, photo_id, status, error_code, error_message")
      .in("id", batchIds)
      .limit(40);
    if (error) return apiError("internal_error", "Could not check ratings.");

    const activeJobs = (jobs ?? []).filter((job) =>
      ["queued", "waiting_dependency", "scoring"].includes(job.status)
    );
    if (activeJobs.length > 0) {
      after(async () => {
        // Recovery and requeue are cheap bookkeeping -- safe to do for every
        // active job in the batch.
        for (const job of activeJobs) {
          try {
            if (job.status === "scoring") {
              await recoverStaleRatingJobs(job.id);
            }
            if (job.status === "waiting_dependency") {
              await requeueReadyDependencyRatingJobs(job.id);
            }
          } catch {
            logEvent("rating.batch_poll_recovery_failed", {});
          }
        }
        // SCORING is not cheap: each one is a full vision call bounded at 45s
        // by the provider deadline. Draining up to 40 of them sequentially in
        // one callback would blow past this route's 240s maxDuration long
        // before finishing, so the tail would be killed and its invocation
        // wasted -- and the dashboard re-fires this poll every few seconds.
        // runQueuedRatingJobsById is the bounded runner the worker already
        // uses: it dedupes, hard-caps at MAX_SUPPORTING_PHOTOS + 1, and runs
        // at concurrency 3. The atomic queued->scoring claim makes an overlap
        // with a concurrent tick harmless.
        // Ready queued work goes first. A large set of supporting photos that
        // are still waiting on their main-photo dependency must not consume
        // the runner's ten-job cap and starve unrelated queued products.
        const runnable = [
          ...activeJobs.filter((job) => job.status === "queued"),
          ...activeJobs.filter((job) => job.status === "waiting_dependency"),
        ].map((job) => job.id);
        if (runnable.length > 0) {
          try {
            await runQueuedRatingJobsById(runnable, 3);
          } catch {
            logEvent("rating.batch_poll_trigger_failed", {});
          }
        }
      });
    }
    return NextResponse.json({ jobs: jobs?.map((job) => payload(job as ExistingJob)) ?? [] });
  }

  let query = supabase
    .from("rating_jobs")
    .select("id, product_id, photo_id, status, error_code, error_message")
    .limit(1);
  query = jobId ? query.eq("id", jobId) : query.eq("photo_id", photoId!);
  const { data: job } = await query.maybeSingle();
  if (!job) return apiError("source_unavailable", "Rating job not found.");
  if (job.status === "scoring") {
    await recoverStaleRatingJobs(job.id);
  }
  if (job.status === "waiting_dependency") {
    try {
      await requeueReadyDependencyRatingJobs(job.id);
    } catch {
      // Polling must remain available while the cron backstop retries.
      logEvent("rating.poll_dependency_scan_failed", {});
    }
  }
  if (job.status === "queued" || job.status === "waiting_dependency") {
    after(async () => {
      try {
        await requeueReadyDependencyRatingJobs(job.id);
        await runQueuedRatingOnce(job.id);
      } catch {
        logEvent("rating.poll_trigger_failed", {});
      }
    });
  }
  let rubric: unknown = null;
  let storagePath: string | null = null;
  if (job.status === "completed") {
    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select("storage_path, current_audit_id")
      .eq("id", job.photo_id)
      .maybeSingle();
    if (photoError) {
      logEvent("rating.poll_photo_lookup_failed", {});
    }
    storagePath = photo?.storage_path ?? null;
    if (photo?.current_audit_id) {
      const { data: audit, error: auditError } = await supabase
        .from("audits")
        .select("rubric")
        .eq("id", photo.current_audit_id)
        .eq("photo_id", job.photo_id)
        .maybeSingle();
      if (auditError) {
        logEvent("rating.poll_audit_lookup_failed", {});
      }
      rubric = audit?.rubric ?? null;
    }
  }
  return NextResponse.json({
    ...payload(job as ExistingJob),
    rubric,
    storagePath,
  });
}
