import sharp from "sharp";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/errors";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";
import { MAX_IMAGE_DIMENSION, MAX_SUPPORTING_PHOTOS, MIN_IMAGE_DIMENSION } from "@/lib/versions";
import { hashImageBytes } from "@/lib/image-hash";
import { runQueuedRatingOnce } from "@/lib/rating-jobs";

/**
 * Single source of truth for "persist an uploaded photo and queue its
 * durable rating job" -- extracted from /api/score/jobs (Codex review,
 * 2026-08-22) so the original single-photo route and the new batch-upload
 * route call the exact same logic instead of two copies drifting apart.
 * External behavior of /api/score/jobs is unchanged: it calls this with the
 * same defaults it always used (mint a fresh photo id, create a new product
 * for role=main, position 0).
 */

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

export type PersistPhotoInput = {
  userId: string;
  file: File;
  role: "main" | "supporting";
  /** rating_jobs.idempotency_key -- caller decides the namespace (rating vs batch-item). */
  idempotencyKey: string;
  /** Existing product to attach to. Required for role=supporting. Omit for
   *  role=main to create a new product (original single-photo behavior). */
  productId?: string;
  /** Only used when creating a new product (productId omitted). */
  productName?: string | null;
  /** Pre-reserved photo id (batch path). Omit to mint a fresh one. */
  photoId?: string;
  /** Explicit display position (batch path). Omitted defaults to 0, matching
   *  the pre-batch behavior where position was never populated. */
  position?: number;
  /** Skip the MAX_SUPPORTING_PHOTOS count check -- the batch path enforces
   *  its own 2-10 total limit at init time instead. */
  skipSupportingCountCheck?: boolean;
};

export type PersistPhotoResult =
  | {
      ok: true;
      productId: string;
      photoId: string;
      jobId: string;
      status: string;
      errorCode: string | null;
      message: string | null;
    }
  | { ok: false; code: string; message: string; status: number };

function fail(code: string, message: string, status: number): PersistPhotoResult {
  return { ok: false, code, message, status };
}

export async function persistPhotoAndQueueRating(
  input: PersistPhotoInput
): Promise<PersistPhotoResult> {
  const { userId, file, role, idempotencyKey } = input;

  if (!ALLOWED_TYPES.has(file.type)) {
    return fail("unsupported_media", "Use a JPG or PNG photo.", 400);
  }
  if (file.size > MAX_SERVER_IMAGE_BYTES) {
    return fail("invalid_upload", "Photo too large. Use a smaller image under 4MB.", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
      return fail("invalid_upload", "Photo is too small. Use at least 200x200 pixels.", 400);
    }
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      return fail("invalid_upload", "Photo dimensions are too large.", 400);
    }
  } catch {
    return fail("unsupported_media", "That file is not a readable image.", 400);
  }

  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("rating_jobs")
    .select("id, product_id, photo_id, status, error_code, error_message")
    .eq("idempotency_key", idempotencyKey)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      productId: existing.product_id,
      photoId: existing.photo_id,
      jobId: existing.id,
      status: existing.status,
      errorCode: existing.error_code,
      message: existing.error_message,
    };
  }

  let productId = input.productId ?? "";
  let createdProduct = false;
  let photoId = "";
  let storagePath = "";
  try {
    if (role === "supporting") {
      if (!productId) {
        return fail("bad_request", "Supporting photos require a product.", 400);
      }
      const { data: product } = await admin
        .from("products")
        .select("id")
        .eq("id", productId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!product) return fail("source_unavailable", "Product not found.", 404);
      if (!input.skipSupportingCountCheck) {
        const { count } = await admin
          .from("photos")
          .select("id", { count: "exact", head: true })
          .eq("product_id", productId)
          .eq("role", "supporting");
        if ((count ?? 0) >= MAX_SUPPORTING_PHOTOS) {
          return fail(
            "bad_request",
            `You can add up to ${MAX_SUPPORTING_PHOTOS} supporting photos.`,
            400
          );
        }
      }
    } else if (!productId) {
      const { data: product, error } = await admin
        .from("products")
        .insert({
          user_id: userId,
          name: input.productName?.trim().slice(0, 120) || null,
        })
        .select("id")
        .single();
      if (error || !product) throw error ?? new Error("Could not create product.");
      productId = product.id;
      createdProduct = true;
    } else {
      const { data: product } = await admin
        .from("products")
        .select("id")
        .eq("id", productId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!product) return fail("source_unavailable", "Product not found.", 404);
    }

    photoId =
      input.photoId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.photoId
      )
        ? input.photoId
        : crypto.randomUUID();
    const ext = file.type === "image/png" ? "png" : "jpg";
    storagePath = `${userId}/${productId}/${photoId}.${ext}`;
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
      position: input.position ?? 0,
    });
    if (photoError) throw photoError;

    const { data: job, error: jobError } = await admin
      .from("rating_jobs")
      .insert({
        user_id: userId,
        product_id: productId,
        photo_id: photoId,
        idempotency_key: idempotencyKey,
        status: "queued",
      })
      .select("id, product_id, photo_id, status, error_code, error_message")
      .single();
    if (jobError || !job) throw jobError ?? new Error("Could not queue rating.");

    return {
      ok: true,
      productId,
      photoId,
      jobId: job.id,
      status: job.status,
      errorCode: job.error_code,
      message: job.error_message,
    };
  } catch (err) {
    if (storagePath) {
      await admin.storage.from("product-photos").remove([storagePath]);
    }
    if (createdProduct && productId) {
      await admin.from("products").delete().eq("id", productId).eq("user_id", userId);
    } else if (photoId) {
      await admin.from("photos").delete().eq("id", photoId);
    }
    logEvent("photo_persistence.failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("persistence_failed", "Your photo could not be saved. Try again.", 500);
  }
}

/** Best-effort worker kick for a freshly queued job, matching the existing
 *  fire-and-forget pattern used everywhere else in this codebase. */
export async function kickRatingWorker(jobId: string): Promise<void> {
  try {
    await runQueuedRatingOnce(jobId);
  } catch (err) {
    logEvent("rating.after_failed", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Verify the server-received bytes match what the client declared at batch
 *  init time (Codex review point 10: hash the exact prepared bytes in the
 *  browser, recompute server-side, reject mismatches). */
export function verifyContentHash(buffer: Buffer, declaredHash: string): boolean {
  return hashImageBytes(buffer) === declaredHash.toLowerCase();
}
