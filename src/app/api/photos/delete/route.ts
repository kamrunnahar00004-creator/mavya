import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { drainStorageCleanup } from "@/lib/storage-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Delete a supporting photo and durably remove its stored images (original +
 * every generated result belonging to that photo).
 *
 * Server-authoritative: the browser sends only a photo ID. Ownership is checked
 * here (RLS) AND re-verified inside the service-role RPC, which deletes the row
 * and enqueues that photo's trusted paths into the cleanup outbox. No prefix
 * sweep (an unknown historical orphan cannot be attributed to one supporting
 * photo after its metadata is gone — product deletion removes those).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const limit = await rateLimit(`delete-photo:u:${user.id}`, 30, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: { photoId?: unknown };
  try {
    body = (await req.json()) as { photoId?: unknown };
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  if (!UUID_RE.test(photoId)) return apiError("bad_request", "Invalid photo id.");

  // Ownership pre-check via RLS (photo -> product -> owner).
  const supabase = await createSupabaseServerClient();
  const { data: owned } = await supabase
    .from("photos")
    .select("id, role")
    .eq("id", photoId)
    .maybeSingle();
  if (!owned) return apiError("forbidden", "You cannot delete this photo.");
  if (owned.role !== "supporting") {
    // Main photos are removed by deleting the product, not individually.
    return apiError("bad_request", "Delete the product to remove its main photo.");
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("request_photo_deletion", {
    p_user: user.id,
    p_photo: photoId,
  });
  if (error) {
    logEvent("photo.delete_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not remove the photo. Try again.");
  }

  after(() => drainStorageCleanup(admin));
  return NextResponse.json({ ok: true }, { status: 200 });
}
