import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { buildWorkflowFeedbackFields } from "@/lib/workflow-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const built = buildWorkflowFeedbackFields(body);
  if (!built.ok) return apiError("bad_request", built.error);
  const patch = { user_id: user.id, workflow_id: workflowId, ...built.fields };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("workflow_feedback").upsert(patch, {
    onConflict: "user_id,workflow_id",
    // Defensive: defaultToNull's null-filling only affects postgrest-js's
    // bulk/array upsert path (it unions columns across array items and fills
    // gaps with null); a single-object upsert like this one is unaffected
    // either way. Set explicitly so this call is correct even if a future edit
    // switches to a batch upsert.
    defaultToNull: false,
  });
  if (error) {
    logEvent("wf_feedback.failed", { userId: user.id, workflowId, error: error.message });
    return apiError("persistence_failed", "Your feedback could not be saved. Try again.");
  }
  logEvent("wf_feedback.saved", { userId: user.id, workflowId });
  return NextResponse.json({ ok: true }, { status: 200 });
}
