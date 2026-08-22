import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { weightedRateLimitMany } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled } from "@/lib/usage";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BATCH_USER_LIMIT = 10; // one legitimate 10-file batch per window
const BATCH_IP_LIMIT = 20;
const BATCH_WINDOW_MS = 60_000;

type FileMeta = {
  requestId: string;
  role: "main" | "supporting";
  contentHash: string;
  byteSize: number;
  mimeType: string;
};

function isFileMeta(v: unknown): v is FileMeta {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.requestId === "string" &&
    /^[a-zA-Z0-9-]{8,100}$/.test(f.requestId) &&
    (f.role === "main" || f.role === "supporting") &&
    typeof f.contentHash === "string" &&
    /^[a-f0-9]{64}$/i.test(f.contentHash) &&
    typeof f.byteSize === "number" &&
    Number.isInteger(f.byteSize) &&
    f.byteSize > 0 &&
    f.byteSize <= MAX_SERVER_IMAGE_BYTES &&
    (f.mimeType === "image/jpeg" || f.mimeType === "image/png")
  );
}

/** Batch init: metadata only, never image binaries (see migration 0025 for
 *  why). Reserves items and, for a genuinely new batch, weight-charges the
 *  rate limit once for the whole file count. A retry of an already-created
 *  batch (same idempotency key) is free -- it must not consume the limit
 *  again. */
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const b = (body ?? {}) as {
    idempotencyKey?: unknown;
    productName?: unknown;
    files?: unknown;
  };
  if (typeof b.idempotencyKey !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(b.idempotencyKey)) {
    return apiError("bad_request", "Missing batch id.");
  }
  if (b.productName !== undefined && b.productName !== null && typeof b.productName !== "string") {
    return apiError("bad_request", "Invalid product name.");
  }
  const productName = typeof b.productName === "string"
    ? b.productName.trim().slice(0, 120) || null
    : null;
  if (!Array.isArray(b.files) || b.files.length < 2 || b.files.length > 10) {
    return apiError("bad_request", "Select 2 to 10 photos.");
  }
  if (!b.files.every(isFileMeta)) {
    return apiError("bad_request", "Invalid photo metadata.");
  }
  const files = b.files as FileMeta[];
  const mainCount = files.filter((f) => f.role === "main").length;
  if (mainCount !== 1) {
    return apiError("bad_request", "Choose exactly one main photo.");
  }
  const requestIds = new Set(files.map((f) => f.requestId));
  if (requestIds.size !== files.length) {
    return apiError("bad_request", "Duplicate photo entries in this batch.");
  }
  const hashes = new Set(files.map((f) => f.contentHash.toLowerCase()));
  if (hashes.size !== files.length) {
    return apiError("bad_request", "Two selected photos are identical. Remove the duplicate.");
  }

  const admin = createSupabaseAdminClient();

  // Fast path: a retry of an already-initialized batch skips the rate
  // limit entirely -- retries must not consume the batch budget again.
  const { data: existingBatch, error: existingError } = await admin
    .from("photo_batches")
    .select("id")
    .eq("user_id", user.id)
    .eq("idempotency_key", b.idempotencyKey)
    .maybeSingle();

  if (existingError) {
    logEvent("batch.lookup_failed", { userId: user.id, error: existingError.message });
    return apiError("persistence_failed", "Could not start the batch. Try again.");
  }

  if (!existingBatch) {
    const limit = await weightedRateLimitMany(
      [
        { key: `batch-init:u:${user.id}`, max: BATCH_USER_LIMIT },
        { key: `batch-init:${clientIp(req)}`, max: BATCH_IP_LIMIT },
      ],
      files.length,
      BATCH_WINDOW_MS,
      `${user.id}:${b.idempotencyKey}`
    );
    if (!limit.ok) {
      return apiError("rate_limited", "Too many photos submitted at once. Wait a minute.");
    }
  }

  const items = files.map((f, position) => ({
    requestId: f.requestId,
    photoId: crypto.randomUUID(),
    role: f.role,
    position,
    contentHash: f.contentHash.toLowerCase(),
    byteSize: f.byteSize,
    mimeType: f.mimeType,
  }));

  const { data, error } = await admin
    .rpc("init_photo_batch", {
      p_user: user.id,
      p_idempotency_key: b.idempotencyKey,
      p_product_name: productName,
      p_items: items,
    })
    .maybeSingle<{
      batch_id: string;
      product_id: string | null;
      is_new: boolean;
      items: unknown;
    }>();

  if (error || !data) {
    logEvent("batch.init_failed", {
      userId: user.id,
      error: error?.message ?? "no data",
    });
    return apiError("persistence_failed", "Could not start the batch. Try again.");
  }

  return NextResponse.json({
    ok: true,
    batchId: data.batch_id,
    productId: data.product_id,
    isNew: data.is_new,
    items: data.items,
  });
}
