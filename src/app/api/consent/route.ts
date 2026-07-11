import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Evaluation-set consent (explicit opt-in, default OFF).
 *
 * Without consent an upload or generated result can NEVER enter Mavya's
 * private evaluation set. Consent is stored on the profile via the service
 * role because browsers can only update their username (migration 0004).
 * Body: { consent: boolean }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const limit = await rateLimit(`consent:u:${user.id}`, 10, 60_000);
  if (!limit.ok) return apiError("rate_limited", "Too many requests. Wait a minute.");

  let body: { consent?: unknown };
  try {
    body = (await req.json()) as { consent?: unknown };
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  if (typeof body.consent !== "boolean") {
    return apiError("bad_request", "Missing consent value.");
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({
      eval_consent: body.consent,
      eval_consent_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    logEvent("consent.update_failed", {
      userId: user.id,
      error: error?.message ?? "profile_not_found",
    });
    return apiError("persistence_failed", "Your choice could not be saved. Try again.");
  }
  logEvent("consent.updated", { userId: user.id, consent: body.consent });
  return NextResponse.json({ ok: true, consent: body.consent }, { status: 200 });
}

/** Read the current consent value for UI state. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("eval_consent")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) {
    return apiError("persistence_failed", "Your consent choice could not be loaded.");
  }
  return NextResponse.json(
    { ok: true, consent: Boolean(data?.eval_consent) },
    { status: 200 }
  );
}
