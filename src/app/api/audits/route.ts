import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashImageBytes } from "@/lib/image-hash";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";

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

  const rubric = cached.rubric as { overall_score?: unknown };
  const overallScore =
    typeof rubric.overall_score === "number" ? rubric.overall_score : null;
  const { data: audit, error } = await admin
    .from("audits")
    .insert({
      photo_id: photo.id,
      kind: expectedMode === "main" ? "main" : "supporting",
      rubric: cached.rubric,
      overall_score: overallScore,
      rubric_version: cached.rubric_version,
      image_hash: cached.image_hash,
      score_cache_id: cached.id,
    })
    .select("id")
    .single();
  if (error || !audit) {
    logEvent("audit.persist_failed", {
      userId: user.id,
      photoId,
      error: error?.message,
    });
    return apiError("persistence_failed", "The audit could not be saved.");
  }
  return NextResponse.json({ ok: true, auditId: audit.id }, { status: 201 });
}
