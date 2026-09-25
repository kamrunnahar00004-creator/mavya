import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled } from "@/lib/usage";
import { kickRatingWorker } from "@/lib/photo-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Score a photo that is already saved but was never rated (a supporting photo
 * imported from Etsy). Queues the same durable rating job an upload gets, so
 * the charge, dependency on the main photo, and polling are all unchanged.
 * rating_jobs is unique per photo, so a double click returns the same job.
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
  const limit = await rateLimit(`photo-score:u:${user.id}`, 20, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: { photoId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const photoId = typeof body?.photoId === "string" && UUID.test(body.photoId) ? body.photoId : null;
  if (!photoId) return apiError("bad_request", "Invalid photo.");

  // Ownership under RLS: the caller can only see their own photos.
  const supabase = await createSupabaseServerClient();
  const { data: photo, error } = await supabase
    .from("photos")
    .select("id, product_id")
    .eq("id", photoId)
    .maybeSingle();
  if (error) return apiError("persistence_failed", "Could not read this photo. Try again.");
  if (!photo) return apiError("source_unavailable", "Photo not found.");

  const admin = createSupabaseAdminClient();
  const select = "id, status";
  const { data: existing } = await admin.from("rating_jobs").select(select).eq("photo_id", photoId).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, jobId: existing.id, status: existing.status });

  const { data: job, error: jobError } = await admin
    .from("rating_jobs")
    .insert({
      user_id: user.id,
      product_id: photo.product_id,
      photo_id: photoId,
      idempotency_key: `${user.id}:photo-score:${photoId}`,
      status: "queued",
    })
    .select(select)
    .single();
  if (jobError || !job) {
    // Lost a race with a concurrent click: return the winner's job.
    const { data: raced } = await admin.from("rating_jobs").select(select).eq("photo_id", photoId).maybeSingle();
    if (raced) return NextResponse.json({ ok: true, jobId: raced.id, status: raced.status });
    logEvent("photo_score.queue_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not start scoring. Try again.");
  }
  after(() => kickRatingWorker(job.id));
  return NextResponse.json({ ok: true, jobId: job.id, status: job.status }, { status: 202 });
}
