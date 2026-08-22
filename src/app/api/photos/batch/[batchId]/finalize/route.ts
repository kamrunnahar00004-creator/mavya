import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validRequestIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every((id) => typeof id === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(id)) &&
    new Set(value).size === value.length
  );
}

type ReservedItem = {
  id: string;
  request_id: string;
};

type PersistedJob = {
  id: string;
  photo_id: string;
  idempotency_key: string;
};

async function reconcilePersistedUploads(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  batchId: string,
  failedRequestIds: readonly string[]
): Promise<{ remainingFailedIds: string[]; error: string | null }> {
  if (failedRequestIds.length === 0) return { remainingFailedIds: [], error: null };

  const { data: items, error: itemsError } = await admin
    .from("photo_batch_items")
    .select("id, request_id")
    .eq("batch_id", batchId)
    .eq("status", "reserved")
    .in("request_id", failedRequestIds);
  if (itemsError) return { remainingFailedIds: [...failedRequestIds], error: itemsError.message };

  const reserved = (items ?? []) as ReservedItem[];
  if (reserved.length === 0) return { remainingFailedIds: [], error: null };

  const keyByRequestId = new Map(
    reserved.map((item) => [item.request_id, `${userId}:batch:${batchId}:${item.request_id}`])
  );
  const { data: jobs, error: jobsError } = await admin
    .from("rating_jobs")
    .select("id, photo_id, idempotency_key")
    .eq("user_id", userId)
    .in("idempotency_key", [...keyByRequestId.values()]);
  if (jobsError) return { remainingFailedIds: [...failedRequestIds], error: jobsError.message };

  const jobByKey = new Map(
    ((jobs ?? []) as PersistedJob[]).map((job) => [job.idempotency_key, job])
  );
  const repaired = new Set<string>();
  for (const item of reserved) {
    const key = keyByRequestId.get(item.request_id);
    const job = key ? jobByKey.get(key) : undefined;
    if (!job) continue;
    const { error: repairError } = await admin
      .from("photo_batch_items")
      .update({
        status: "uploaded",
        photo_id: job.photo_id,
        rating_job_id: job.id,
        error_code: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("status", "reserved");
    if (repairError) {
      return { remainingFailedIds: [...failedRequestIds], error: repairError.message };
    }
    repaired.add(item.request_id);
  }

  return {
    remainingFailedIds: failedRequestIds.filter((requestId) => !repaired.has(requestId)),
    error: null,
  };
}

/**
 * Closes the browser-owned part of a batch. Only request ids the browser
 * explicitly reports as failed are changed, and only while they are still
 * reserved. Already-uploaded/server-failed rows can never be overwritten.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const { batchId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const failedRequestIds = (body as { failedRequestIds?: unknown } | null)?.failedRequestIds ?? [];
  if (!validRequestIds(failedRequestIds)) {
    return apiError("bad_request", "Invalid failed photo list.");
  }

  const admin = createSupabaseAdminClient();
  const { data: batch, error: batchError } = await admin
    .from("photo_batches")
    .select("id")
    .eq("id", batchId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (batchError) {
    logEvent("batch.finalize_lookup_failed", {
      userId: user.id,
      batchId,
      error: batchError.message,
    });
    return apiError("persistence_failed", "Could not close this batch. Try again.");
  }
  if (!batch) return apiError("source_unavailable", "Batch not found.");

  const reconciled = await reconcilePersistedUploads(admin, user.id, batchId, failedRequestIds);
  if (reconciled.error) {
    logEvent("batch.finalize_reconcile_failed", {
      userId: user.id,
      batchId,
      error: reconciled.error,
    });
    return apiError("persistence_failed", "Could not verify the completed uploads. Try again.");
  }

  if (reconciled.remainingFailedIds.length > 0) {
    const { error: updateError } = await admin
      .from("photo_batch_items")
      .update({
        status: "failed",
        effective_role: null,
        error_code: "upload_interrupted",
        error_message: "The browser upload did not finish.",
        updated_at: new Date().toISOString(),
      })
      .eq("batch_id", batchId)
      .eq("status", "reserved")
      .in("request_id", reconciled.remainingFailedIds);
    if (updateError) {
      logEvent("batch.finalize_items_failed", {
        userId: user.id,
        batchId,
        error: updateError.message,
      });
      return apiError("persistence_failed", "Could not close the failed uploads. Try again.");
    }
  }

  const { data: finalized, error: finalizeError } = await admin
    .rpc("finalize_photo_batch", { p_batch_id: batchId, p_user: user.id })
    .maybeSingle<{ status: string; product_id: string | null }>();
  if (finalizeError || !finalized) {
    logEvent("batch.finalize_failed", {
      userId: user.id,
      batchId,
      error: finalizeError?.message ?? "no data",
    });
    return apiError("persistence_failed", "Could not close this batch. Try again.");
  }

  return NextResponse.json({
    ok: true,
    batchId,
    status: finalized.status,
    productId: finalized.product_id,
  });
}
