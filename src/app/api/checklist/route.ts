import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { generateChecklist } from "@/lib/score-photo";
import { parseSavedChecklist } from "@/lib/checklist-store";
import { createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RubricJson } from "@/lib/rubric";
import { apiError, logEvent } from "@/lib/errors";
import { aiDisabled, withinGlobalBudget } from "@/lib/usage";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const empty = (extra?: Record<string, unknown>) =>
  NextResponse.json({ supporting_photo_checklist: [], ...extra }, { status: 200 });

/**
 * Supporting-photo checklist: CACHED-FIRST. A checklist is generated once per
 * audit, persisted into that exact audit's rubric, and served from the
 * database forever after — saved suggestions are user data and are returned
 * before any entitlement, kill-switch, budget, or rate-limit check (past-due
 * users and provider outages still read their saved checklist).
 *
 * Only a true first generation reaches the provider, guarded by an atomic
 * per-audit claim so concurrent page loads make at most ONE provider call;
 * losers get a 202 "pending" and the client re-polls briefly. Failures never
 * write anything and never erase saved data.
 */
export async function POST(req: NextRequest) {
  // 1. Authenticate.
  const user = await getSessionUser();
  if (!user) {
    return apiError("unauthenticated", "Log in to load the checklist.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return empty();
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const photoId = typeof b.photoId === "string" ? b.photoId : "";
  if (!photoId) return empty();

  // 2. RLS-scoped lookup of the caller-owned MAIN photo.
  const supabase = await createSupabaseServerClient();
  const { data: photo } = await supabase
    .from("photos")
    .select("id, role")
    .eq("id", photoId)
    .eq("role", "main")
    .maybeSingle();
  if (!photo) return empty();

  // 3. The exact latest audit (id captured now; everything below binds to it).
  const { data: audit } = await supabase
    .from("audits")
    .select("id, photo_id, rubric, created_at")
    .eq("photo_id", photo.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rubric = (audit?.rubric ?? null) as RubricJson | null;
  if (!audit || !rubric || rubric.upload_kind === "invalid") return empty();

  // 4. Saved checklist wins immediately: no provider, no entitlement checks.
  const saved = parseSavedChecklist(rubric.supporting_photo_checklist);
  if (saved) {
    return NextResponse.json({ supporting_photo_checklist: saved }, { status: 200 });
  }

  // 5. Generation path only from here on.
  if (aiDisabled()) return empty({ status: "unavailable" });
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(
      "subscription_required",
      "The supporting-photo checklist is part of the Mavya Founding Beta subscription."
    );
  }
  // 6. Claim BEFORE budget/rate-limit accounting. Requests polling while a
  //    different request generates must be free: only the claim winner can
  //    spend provider budget or consume rate-limit allowance.
  const admin = createSupabaseAdminClient();
  const { data: claimToken, error: claimError } = await admin.rpc("claim_checklist_generation", {
    p_user: user.id,
    p_audit: audit.id,
    p_photo: photo.id,
  });
  if (claimError) {
    logEvent("checklist.claim_failed", { auditId: audit.id, error: claimError.message });
    return empty({ status: "unavailable" });
  }
  if (!claimToken) {
    // Another live request is generating: tell the client to re-poll soon.
    return NextResponse.json(
      { status: "pending", supporting_photo_checklist: [] },
      { status: 202 }
    );
  }

  const release = async () => {
    const { error } = await admin.rpc("release_checklist_claim", {
      p_audit: audit.id,
      p_claim_token: claimToken,
    });
    if (error) {
      logEvent("checklist.release_failed", { auditId: audit.id, error: error.message });
    }
  };

  if (!(await withinGlobalBudget("checklist"))) {
    await release();
    return empty({ status: "unavailable" });
  }
  const daily = await rateLimit(`checklist-day:u:${user.id}`, 60, 24 * 60 * 60 * 1000);
  if (!daily.ok) {
    await release();
    return empty({ status: "unavailable" });
  }
  const perMin = await rateLimit(`checklist:${clientIp(req)}`, 12, 60_000);
  if (!perMin.ok) {
    await release();
    return empty({ status: "unavailable" });
  }

  // 7. The claim winner generates and persists against the captured audit id,
  //    then releases only this request's claim token. Failures release and report
  //    "unavailable" — nothing is ever written on failure.
  try {
    const checklist = await generateChecklist({
      upload_kind: rubric.upload_kind,
      detected_category: rubric.detected_category,
      product_summary: rubric.product_summary.slice(0, 200),
      overall_score: rubric.overall_score,
      priority_action: rubric.priority_action.slice(0, 200),
    });
    const valid = parseSavedChecklist(checklist.slice(0, 5));
    if (!valid) {
      await release();
      return empty({ status: "unavailable" });
    }
    const { data: winner, error: saveError } = await admin.rpc(
      "save_supporting_checklist",
      {
        p_user: user.id,
        p_audit: audit.id,
        p_photo: photo.id,
        p_checklist: valid,
      }
    );
    if (saveError) {
      logEvent("checklist.save_failed", { auditId: audit.id, error: saveError.message });
    }
    await release();
    return NextResponse.json(
      { supporting_photo_checklist: parseSavedChecklist(winner) ?? valid },
      { status: 200 }
    );
  } catch (err) {
    logEvent("checklist.generate_failed", {
      auditId: audit.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await release();
    return empty({ status: "unavailable" });
  }
}
