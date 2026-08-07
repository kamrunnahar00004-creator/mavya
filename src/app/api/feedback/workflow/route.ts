import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 500;

/**
 * Post-workflow seller feedback. Evidence for the founder's weekly review —
 * NEVER automatic scoring ground truth: prompts and calibration change only
 * through reviewed, versioned, deliberately deployed updates.
 *
 * Body: { workflowId, betterThanOriginal?, wouldUse?, detailChanged?,
 *         preferredVersion?, rejectionReason? }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const limit = await rateLimit(`wf-feedback:u:${user.id}`, 20, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const workflowId = typeof body.workflowId === "string" ? body.workflowId : "";
  if (!workflowId) return apiError("bad_request", "Missing workflow.");

  // Ownership via RLS: the workflow root must be the caller's own job.
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, user_id, workflow_id, attempt_number")
    .eq("id", workflowId)
    .maybeSingle();
  if (
    !job ||
    job.attempt_number !== 1 ||
    (job.workflow_id !== null && job.workflow_id !== job.id)
  ) {
    return apiError("source_unavailable", "Workflow not found.");
  }

  const optionalBool = (v: unknown) => (typeof v === "boolean" ? v : null);
  const optionalText = (v: unknown) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) || null : null;
  // 1-5 star rating; anything else is treated as "not answered".
  const optionalStar = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("workflow_feedback").upsert(
    {
      user_id: user.id,
      workflow_id: workflowId,
      better_than_original: optionalBool(body.betterThanOriginal),
      would_use: optionalBool(body.wouldUse),
      detail_changed: optionalBool(body.detailChanged),
      preferred_version: optionalText(body.preferredVersion),
      rejection_reason: optionalText(body.rejectionReason),
      rating_agreement: optionalStar(body.ratingAgreement),
      rating_agreement_note: optionalText(body.ratingAgreementNote),
      image_rating: optionalStar(body.imageRating),
      image_rating_note: optionalText(body.imageRatingNote),
    },
    { onConflict: "user_id,workflow_id" }
  );
  if (error) {
    logEvent("wf_feedback.failed", { userId: user.id, workflowId, error: error.message });
    return apiError("persistence_failed", "Your feedback could not be saved. Try again.");
  }
  logEvent("wf_feedback.saved", { userId: user.id, workflowId });
  return NextResponse.json({ ok: true }, { status: 200 });
}
