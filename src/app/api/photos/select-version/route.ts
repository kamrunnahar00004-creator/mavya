import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit MANUAL version selection: the seller — not Mavya — makes the final
 * decision about which image to use. A manual pick sets selection_source =
 * 'user', which blocks all automatic (background-refinement) replacement.
 * Body: { photoId, jobId } — jobId null selects the ORIGINAL photo.
 *
 * The seller can select any completed version, including those with warnings
 * (drift, AI-looking, incomplete). The system never prevents manual selection.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const limit = await rateLimit(`select-version:u:${user.id}`, 30, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: { photoId?: unknown; jobId?: unknown };
  try {
    body = (await req.json()) as { photoId?: unknown; jobId?: unknown };
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  const jobId =
    body.jobId === null ? null : typeof body.jobId === "string" ? body.jobId : "";
  if (!photoId || jobId === "") {
    return apiError("bad_request", "Missing photo or version.");
  }

  // Ownership via RLS: a foreign photo returns null.
  const supabase = await createSupabaseServerClient();
  const { data: photo } = await supabase
    .from("photos")
    .select("id, role, product_id")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) return apiError("source_unavailable", "Photo not found.");

  if (jobId !== null) {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select("id, status, photo_id, fidelity")
      .eq("id", jobId)
      .maybeSingle();
    if (!job || job.photo_id !== photo.id) {
      return apiError("source_unavailable", "Version not found.");
    }
    if (job.status !== "completed") {
      return apiError("bad_request", "Only completed versions can be selected.");
    }
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("photos")
    .update({ selected_generation_job_id: jobId, selection_source: "user" })
    .eq("id", photo.id);
  if (error) {
    logEvent("select_version.failed", { userId: user.id, photoId, error: error.message });
    return apiError("persistence_failed", "The selection could not be saved. Try again.");
  }
  logEvent("select_version.saved", { userId: user.id, photoId, jobId });
  return NextResponse.json({ ok: true, selectedJobId: jobId }, { status: 200 });
}
