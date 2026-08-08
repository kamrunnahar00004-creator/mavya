import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashImageBytes } from "@/lib/image-hash";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persist a scored audit without trusting rubric JSON from the browser.
 * The route copies the rubric from the server-owned score cache and verifies
 * that the cached hash matches the bytes stored for this owned photo.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  // Paid-only beta: audits persist paid assessments, so the same server-side
  // subscription boundary applies (a lapsed account keeps reading old audits
  // but cannot persist new ones).
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(
      "subscription_required",
      "Saving assessments is part of the Mavya Founding Beta subscription."
    );
  }
  const limit = await rateLimit(`audit-persist:u:${user.id}`, 30, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many audit saves. Try again shortly.");

  let body: { photoId?: unknown; scoreCacheId?: unknown };
  try {
    body = (await req.json()) as { photoId?: unknown; scoreCacheId?: unknown };
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  const scoreCacheId =
    typeof body.scoreCacheId === "string" ? body.scoreCacheId : "";
  if (!photoId || !scoreCacheId) {
    return apiError("bad_request", "Missing photo or score result.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: photo } = await supabase
    .from("photos")
    .select("id, role, storage_path")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) return apiError("source_unavailable", "Photo not found.");

  const admin = createSupabaseAdminClient();
  const { data: cached } = await admin
    .from("score_cache")
    .select("id, image_hash, mode, rubric_version, rubric")
    .eq("id", scoreCacheId)
    .eq("user_id", user.id)
    .maybeSingle();
  const expectedMode = photo.role === "main" ? "main" : "supporting";
  if (!cached || cached.mode !== expectedMode) {
    return apiError("forbidden", "That score does not belong to this photo.");
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("product-photos")
    .download(photo.storage_path);
  if (downloadError || !blob) {
    return apiError("source_unavailable", "The saved photo could not be verified.");
  }
  if (blob.size > MAX_SERVER_IMAGE_BYTES) {
    return apiError("invalid_upload", "The saved photo is too large to verify.");
  }
  const storedHash = hashImageBytes(Buffer.from(await blob.arrayBuffer()));
  if (storedHash !== cached.image_hash) {
    return apiError("forbidden", "The score does not match the saved photo.");
  }

  // All verification above (ownership + stored-image byte hash + score-cache
  // match) has ALREADY completed. Persisting the audit AND advancing
  // photos.current_audit_id happens atomically, under the same `for update`
  // photos row lock select_generation_if_stronger takes (0024): the two can
  // never interleave, so the keep-better floor can never compare against a
  // stale audit a concurrent re-rating just replaced. Idempotent: a repeat
  // call for the same (photo, score cache) returns the existing row rather
  // than inserting a duplicate; a genuine re-rating uses a NEW score-cache row
  // (score_cache uniqueness includes rubric_version), so a different rubric
  // version still inserts a fresh audit and advances the pointer.
  const rubric = cached.rubric as { overall_score?: unknown };
  const overallScore =
    typeof rubric.overall_score === "number" ? rubric.overall_score : null;
  const { data: auditId, error } = await admin.rpc(
    "persist_audit_and_advance_current",
    {
      p_user: user.id,
      p_photo: photo.id,
      p_kind: expectedMode === "main" ? "main" : "supporting",
      p_rubric: cached.rubric,
      p_overall_score: overallScore,
      p_rubric_version: cached.rubric_version,
      p_image_hash: cached.image_hash,
      p_score_cache_id: cached.id,
    }
  );
  if (error || !auditId) {
    logEvent("audit.persist_failed", {
      userId: user.id,
      photoId,
      error: error?.message,
    });
    return apiError("persistence_failed", "The audit could not be saved.");
  }
  return NextResponse.json({ ok: true, auditId }, { status: 200 });
}
