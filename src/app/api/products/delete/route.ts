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
 * Delete a product and durably remove all of its stored images.
 *
 * Server-authoritative: the browser sends only a product ID (never a storage
 * path). Ownership is checked here (RLS-scoped read) AND re-verified inside the
 * service-role RPC. The RPC deletes the DB rows and enqueues every trusted path
 * + a product-prefix sweep into the cleanup outbox in one transaction; the drain
 * then removes the files. DB rows vanish immediately; file cleanup is guaranteed
 * eventually and never silently forgotten.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const limit = await rateLimit(`delete-product:u:${user.id}`, 20, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: { productId?: unknown };
  try {
    body = (await req.json()) as { productId?: unknown };
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!UUID_RE.test(productId)) return apiError("bad_request", "Invalid product id.");

  // Ownership pre-check (RLS scopes to the owner; a foreign id returns null).
  const supabase = await createSupabaseServerClient();
  const { data: owned } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (!owned) return apiError("forbidden", "You cannot delete this product.");

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("request_product_deletion", {
    p_user: user.id,
    p_product: productId,
  });
  if (error) {
    logEvent("product.delete_failed", { userId: user.id });
    return apiError("persistence_failed", "Could not delete. Try again.");
  }

  // Kick the outbox drain now; the worker cron is the durable backstop.
  after(() => drainStorageCleanup(admin));
  return NextResponse.json({ ok: true }, { status: 200 });
}
