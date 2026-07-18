import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { DASHBOARD_THUMB_TRANSFORM } from "@/lib/batch-sign-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-sign a product-photos storage path for the authenticated user (expired
 * <img> URLs refresh through this). Ownership: paths are namespaced by user id
 * as the first segment AND storage RLS enforces the same rule; both checks must
 * pass. No arbitrary bucket or path signing.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const limit = await rateLimit(`sign:u:${user.id}`, 60, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests.");

  let body: { path?: unknown; variant?: unknown };
  try {
    body = (await req.json()) as { path?: unknown; variant?: unknown };
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const path = typeof body.path === "string" ? body.path : "";
  if (!path || path.includes("..") || !path.startsWith(`${user.id}/`)) {
    return apiError("forbidden", "You cannot sign this path.");
  }
  // The ONLY accepted variant is the fixed server-owned dashboard thumbnail.
  // Arbitrary widths/heights/quality/transform objects are never accepted.
  const thumb = body.variant === "thumb";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("product-photos")
    .createSignedUrl(
      path,
      24 * 60 * 60,
      thumb ? { transform: DASHBOARD_THUMB_TRANSFORM } : undefined
    );
  if (error || !data?.signedUrl) {
    return apiError("signing_failed", "Could not refresh the image URL.");
  }
  return NextResponse.json({ url: data.signedUrl }, { status: 200 });
}
