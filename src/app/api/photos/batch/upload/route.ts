import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled } from "@/lib/usage";
import { hashImageBytes } from "@/lib/image-hash";
import { persistPhotoAndQueueRating, kickRatingWorker } from "@/lib/photo-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BatchItemRow = {
  id: string;
  batch_id: string;
  request_id: string;
  photo_id: string;
  role: "main" | "supporting";
  position: number;
  content_hash: string;
  status: "reserved" | "uploaded" | "failed";
  rating_job_id: string | null;
};

async function finalizeBatch(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  batchId: string,
  userId: string
) {
  const { error } = await admin.rpc("finalize_photo_batch", {
    p_batch_id: batchId,
    p_user: userId,
  });
  if (error) {
    logEvent("batch.finalize_failed", { userId, batchId, error: error.message });
  }
}

function itemPayload(item: BatchItemRow, extra: Record<string, unknown> = {}) {
  return {
    ok: item.status === "uploaded",
    requestId: item.request_id,
    photoId: item.photo_id,
    status: item.status,
    ratingJobId: item.rating_job_id,
    ...extra,
  };
}

/**
 * One prepared image per request -- the fix for the original design's
 * Vercel 4.5MB request-body problem. Called sequentially for the declared
 * main (first, awaited), then with bounded client-side concurrency of at
 * most 2 for the rest.
 */
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
  if (entitlement.activeListingLimit == null) {
    return apiError("subscription_required", "An active plan is needed to rate photos.");
  }
  // Light abuse guard on the upload endpoint itself -- not the scoring-start
  // budget (that was already spent, weighted, at batch init).
  const userLimit = await rateLimit(`batch-upload:u:${user.id}`, 30, 60_000);
  const ipLimit = await rateLimit(`batch-upload:${clientIp(req)}`, 60, 60_000);
  if (!userLimit.ok || !ipLimit.ok) {
    return apiError("rate_limited", "Too many uploads. Wait a moment.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("bad_request", "Invalid form data.");
  }
  const batchId = form.get("batch_id");
  const requestId = form.get("request_id");
  const file = form.get("image");
  if (typeof batchId !== "string" || !batchId) {
    return apiError("bad_request", "Missing batch id.");
  }
  if (typeof requestId !== "string" || !requestId) {
    return apiError("bad_request", "Missing photo request id.");
  }
  if (!(file instanceof File)) return apiError("bad_request", "Missing image upload.");

  const admin = createSupabaseAdminClient();

  const { data: batch, error: batchError } = await admin
    .from("photo_batches")
    .select("id, user_id")
    .eq("id", batchId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (batchError) {
    logEvent("batch.lookup_failed", { userId: user.id, batchId, error: batchError.message });
    return apiError("persistence_failed", "Could not load this batch. Try again.");
  }
  if (!batch) return apiError("source_unavailable", "Batch not found.");

  const { data: item, error: itemError } = await admin
    .from("photo_batch_items")
    .select("id, batch_id, request_id, photo_id, role, position, content_hash, status, rating_job_id")
    .eq("batch_id", batchId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (itemError) {
    logEvent("batch.item_lookup_failed", { userId: user.id, batchId, error: itemError.message });
    return apiError("persistence_failed", "Could not load this photo. Try again.");
  }
  if (!item) return apiError("source_unavailable", "Photo reservation not found.");

  if (item.status === "uploaded") {
    return NextResponse.json(itemPayload(item as BatchItemRow));
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const actualHash = hashImageBytes(buffer);
  if (actualHash !== item.content_hash) {
    const { error: updateError } = await admin
      .from("photo_batch_items")
      .update({
        status: "failed",
        effective_role: null,
        error_code: "hash_mismatch",
        error_message: "The uploaded photo did not match what was selected.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (updateError) {
      logEvent("batch.item_update_failed", { userId: user.id, batchId, error: updateError.message });
      return apiError("persistence_failed", "Could not update this photo. Try again.");
    }
    await finalizeBatch(admin, batchId, user.id);
    return apiError("invalid_upload", "The uploaded photo did not match what was selected.");
  }

  const { data: productIdData, error: productError } = await admin.rpc("ensure_batch_product", {
    p_batch_id: batchId,
    p_user: user.id,
    p_limit: entitlement.activeListingLimit,
  });
  const productId = productIdData as string | null;
  if (productError) {
    if (productError.message?.includes("active_listing_limit_reached")) {
      return apiError(
        "active_listing_limit_reached",
        "You've reached your active listing limit. Delete a listing to free a slot."
      );
    }
    logEvent("batch.product_failed", { userId: user.id, batchId, error: productError.message });
    return apiError("persistence_failed", "Could not save this batch. Try again.");
  }
  if (!productId) {
    logEvent("batch.product_failed", { userId: user.id, batchId, error: "no product id returned" });
    return apiError("persistence_failed", "Could not save this batch. Try again.");
  }

  const { data: effectiveRoleData, error: roleError } = await admin.rpc(
    "resolve_batch_item_role",
    { p_batch_id: batchId, p_user: user.id, p_item_id: item.id }
  );
  const effectiveRole = effectiveRoleData as "main" | "supporting" | null;
  if (roleError || !effectiveRole) {
    logEvent("batch.role_failed", { userId: user.id, batchId, error: roleError?.message });
    return apiError("persistence_failed", "Could not save this photo. Try again.");
  }

  const result = await persistPhotoAndQueueRating({
    userId: user.id,
    file,
    role: effectiveRole as "main" | "supporting",
    idempotencyKey: `${user.id}:batch:${batchId}:${requestId}`,
    productId: productId as string,
    photoId: item.photo_id,
    position: item.position,
    skipSupportingCountCheck: true,
  });

  if (!result.ok) {
    const { error: updateError } = await admin
      .from("photo_batch_items")
      .update({
        status: "failed",
        effective_role: null,
        error_code: result.code,
        error_message: result.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (updateError) {
      logEvent("batch.item_update_failed", { userId: user.id, batchId, error: updateError.message });
      return apiError("persistence_failed", "Could not update this photo. Try again.");
    }
    await finalizeBatch(admin, batchId, user.id);
    return apiError(result.code as Parameters<typeof apiError>[0], result.message);
  }

  // Persistence and the durable rating job already succeeded. Kick the
  // worker even if the bookkeeping update below transiently fails; the
  // finalize endpoint can reconcile this item from the idempotency key.
  after(() => kickRatingWorker(result.jobId));

  const { error: uploadedError } = await admin
    .from("photo_batch_items")
    .update({
      status: "uploaded",
      rating_job_id: result.jobId,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (uploadedError) {
    logEvent("batch.item_update_failed", { userId: user.id, batchId, error: uploadedError.message });
    return apiError("persistence_failed", "The photo was saved, but its batch status could not update.");
  }

  await finalizeBatch(admin, batchId, user.id);

  return NextResponse.json(
    itemPayload(
      { ...item, status: "uploaded", rating_job_id: result.jobId } as BatchItemRow,
      { productId: result.productId, effectiveRole }
    )
  );
}
