import { after, NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled } from "@/lib/usage";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";
import {
  MAX_IMAGE_DIMENSION,
  MAX_SUPPORTING_PHOTOS,
  MIN_IMAGE_DIMENSION,
} from "@/lib/versions";
import {
  recoverStaleRatingJobs,
  runQueuedRatingOnce,
} from "@/lib/rating-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

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
  if (!ALLOWED_TYPES.has(file.type)) {
    return apiError("unsupported_media", "Use a JPG or PNG photo.");
  }
  if (file.size > MAX_SERVER_IMAGE_BYTES) {
    return apiError("invalid_upload", "Photo too large. Use a smaller image under 4MB.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
      return apiError("invalid_upload", "Photo is too small. Use at least 200x200 pixels.");
    }
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      return apiError("invalid_upload", "Photo dimensions are too large.");
    }
  } catch {
    return apiError("unsupported_media", "That file is not a readable image.");
  }

  const admin = createSupabaseAdminClient();
  const idempotencyKey = `${user.id}:rating:${requestId}`;
  const { data: existing } = await admin
    .from("rating_jobs")
    .select("id, product_id, photo_id, status, error_code, error_message")
    .eq("idempotency_key", idempotencyKey)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return NextResponse.json(payload(existing as ExistingJob), { status: 202 });

  let productId = "";
  let createdProduct = false;
  let photoId = "";
  let storagePath = "";
  try {
    if (role === "supporting") {
      if (typeof requestedProductId !== "string" || !requestedProductId) {
        return apiError("bad_request", "Supporting photos require a product.");
      }
      const { data: product } = await admin
        .from("products")
        .select("id")
        .eq("id", requestedProductId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!product) return apiError("source_unavailable", "Product not found.");
      productId = product.id;
      const { count } = await admin
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("product_id", productId)
        .eq("role", "supporting");
      if ((count ?? 0) >= MAX_SUPPORTING_PHOTOS) {
        return apiError("bad_request", `You can add up to ${MAX_SUPPORTING_PHOTOS} supporting photos.`);
      }
    } else {
      const { data: product, error } = await admin
        .from("products")
        .insert({
          user_id: user.id,
          name: typeof name === "string" ? name.trim().slice(0, 120) || null : null,
        })
        .select("id")
        .single();
      if (error || !product) throw error ?? new Error("Could not create product.");
      productId = product.id;
      createdProduct = true;
    }

    photoId =
      typeof requestedPhotoId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        requestedPhotoId
      )
        ? requestedPhotoId
        : crypto.randomUUID();
    const ext = file.type === "image/png" ? "png" : "jpg";
    storagePath = `${user.id}/${productId}/${photoId}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("product-photos")
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: photoError } = await admin.from("photos").insert({
      id: photoId,
      product_id: productId,
      role,
      storage_path: storagePath,
      mime: file.type,
    });
    if (photoError) throw photoError;
    const { data: job, error: jobError } = await admin
      .from("rating_jobs")
      .insert({
        user_id: user.id,
        product_id: productId,
        photo_id: photoId,
        idempotency_key: idempotencyKey,
        status: "queued",
      })
      .select("id, product_id, photo_id, status, error_code, error_message")
      .single();
    if (jobError || !job) throw jobError ?? new Error("Could not queue rating.");

    after(async () => {
      try {
        await runQueuedRatingOnce(job.id);
      } catch (err) {
        logEvent("rating.after_failed", {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return NextResponse.json(payload(job as ExistingJob), { status: 202 });
  } catch (err) {
    if (storagePath) {
      await admin.storage.from("product-photos").remove([storagePath]);
    }
    if (createdProduct && productId) {
      await admin.from("products").delete().eq("id", productId).eq("user_id", user.id);
    } else if (photoId) {
      await admin.from("photos").delete().eq("id", photoId);
    }
    logEvent("rating.queue_failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("persistence_failed", "Your photo could not be saved. Try again.");
  }
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
