import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled } from "@/lib/usage";
import { persistPhotoAndQueueRating, kickRatingWorker } from "@/lib/photo-persistence";
import { recoverStaleRatingJobs, runQueuedRatingOnce } from "@/lib/rating-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    return apiError("subscription_required", "An active plan is needed to rate photos.");
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
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const jobId = req.nextUrl.searchParams.get("id");
  const photoId = req.nextUrl.searchParams.get("photoId");
  if (!jobId && !photoId) return apiError("bad_request", "Missing rating job id.");
  const supabase = await createSupabaseServerClient();
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
  if (job.status === "queued") {
    after(async () => {
      try {
        await runQueuedRatingOnce(job.id);
      } catch (err) {
        logEvent("rating.poll_trigger_failed", {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
  let rubric: unknown = null;
  let storagePath: string | null = null;
  if (job.status === "completed") {
    const { data: photo } = await supabase
      .from("photos")
      .select("storage_path, audits(rubric, created_at)")
      .eq("id", job.photo_id)
      .maybeSingle();
    storagePath = photo?.storage_path ?? null;
    const audits = (photo?.audits ?? []) as { rubric: unknown; created_at: string }[];
    rubric = [...audits].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      ?.rubric ?? null;
  }
  return NextResponse.json({
    ...payload(job as ExistingJob),
    rubric,
    storagePath,
  });
}
