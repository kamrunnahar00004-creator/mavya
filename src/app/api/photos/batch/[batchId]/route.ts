import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ItemRow = {
  request_id: string;
  photo_id: string;
  role: "main" | "supporting";
  effective_role: "main" | "supporting" | null;
  position: number;
  status: "reserved" | "uploaded" | "failed";
  rating_job_id: string | null;
  error_code: string | null;
  error_message: string | null;
};

type JobRow = {
  id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
};

/**
 * Combined batch + per-item status. Upload state comes from
 * photo_batch_items.status; once an item is uploaded, its RATING state
 * comes from the linked rating_jobs row -- never duplicated, so the two
 * never drift apart (Codex review point 6). Used both for the initial
 * preview-grid progress view and to resume an interrupted batch after a
 * refresh (whatever is still "reserved" still needs uploading).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const { batchId } = await params;

  const admin = createSupabaseAdminClient();
  const { data: batch } = await admin
    .from("photo_batches")
    .select("id, product_id, status, file_count, created_at")
    .eq("id", batchId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!batch) return apiError("source_unavailable", "Batch not found.");

  const { data: items } = await admin
    .from("photo_batch_items")
    .select(
      "request_id, photo_id, role, effective_role, position, status, rating_job_id, error_code, error_message"
    )
    .eq("batch_id", batchId)
    .order("position", { ascending: true });

  const rows = (items ?? []) as ItemRow[];
  const jobIds = rows.map((r) => r.rating_job_id).filter((id): id is string => Boolean(id));
  const jobsById = new Map<string, JobRow>();
  if (jobIds.length > 0) {
    const { data: jobs } = await admin
      .from("rating_jobs")
      .select("id, status, error_code, error_message")
      .in("id", jobIds);
    for (const j of (jobs as JobRow[] | null) ?? []) jobsById.set(j.id, j);
  }

  const combined = rows.map((r) => {
    if (r.status === "reserved") {
      return {
        requestId: r.request_id,
        photoId: r.photo_id,
        role: r.role,
        effectiveRole: r.effective_role,
        position: r.position,
        state: "pending_upload" as const,
      };
    }
    if (r.status === "failed") {
      return {
        requestId: r.request_id,
        photoId: r.photo_id,
        role: r.role,
        effectiveRole: r.effective_role,
        position: r.position,
        state: "failed" as const,
        errorCode: r.error_code,
        errorMessage: r.error_message,
      };
    }
    const job = r.rating_job_id ? jobsById.get(r.rating_job_id) : undefined;
    return {
      requestId: r.request_id,
      photoId: r.photo_id,
      role: r.role,
      effectiveRole: r.effective_role,
      position: r.position,
      state: (job?.status ?? "queued") as string,
      ratingJobId: r.rating_job_id,
      errorCode: job?.error_code ?? null,
      errorMessage: job?.error_message ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    productId: batch.product_id,
    status: batch.status,
    fileCount: batch.file_count,
    items: combined,
  });
}
