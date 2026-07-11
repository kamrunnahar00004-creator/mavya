import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { generateChecklist } from "@/lib/score-photo";
import { getSessionUser } from "@/lib/supabase/server";
import { apiError } from "@/lib/errors";
import { aiDisabled, withinGlobalBudget } from "@/lib/usage";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Supporting-photo checklist, generated on its own so the main score can render
 * instantly and this hydrates in the background. Text-only + best-effort: any
 * failure returns an empty checklist rather than an error, since the checklist
 * is an optional add-on and must never block the audit.
 */
export async function POST(req: NextRequest) {
  // Checklist is free but still billable upstream (a gpt-4o text call), so it
  // requires a session and honors the global kill switch. Failures stay
  // best-effort empty lists so the audit UI never blocks.
  if (aiDisabled()) {
    return NextResponse.json({ supporting_photo_checklist: [] }, { status: 200 });
  }
  const user = await getSessionUser();
  if (!user) {
    return apiError("unauthenticated", "Log in to load the checklist.");
  }
  // Paid-only beta: the checklist is bundled with a paid assessment (no
  // separate allowance), but it is still a provider call, so it requires an
  // active subscription like every other AI route.
  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active) {
    return apiError(
      "subscription_required",
      "The supporting-photo checklist is part of the Mavya Founding Beta subscription."
    );
  }
  if (!(await withinGlobalBudget("checklist"))) {
    return NextResponse.json({ supporting_photo_checklist: [] }, { status: 200 });
  }

  const ip = clientIp(req);
  const daily = await rateLimit(`checklist-day:u:${user.id}`, 60, 24 * 60 * 60 * 1000);
  if (!daily.ok) {
    // Best-effort feature: on rate-limit, hand back an empty list, not an error.
    return NextResponse.json({ supporting_photo_checklist: [] }, { status: 200 });
  }

  const limit = await rateLimit(`checklist:${ip}`, 12, 60_000);
  if (!limit.ok) {
    // Best-effort feature: on rate-limit, hand back an empty list, not an error.
    return NextResponse.json({ supporting_photo_checklist: [] }, { status: 200 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ supporting_photo_checklist: [] }, { status: 200 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const uploadKind = b.upload_kind;
  if (uploadKind !== "physical_product" && uploadKind !== "digital_product") {
    return NextResponse.json({ supporting_photo_checklist: [] }, { status: 200 });
  }

  const checklist = await generateChecklist({
    upload_kind: uploadKind,
    detected_category:
      typeof b.detected_category === "string" ? b.detected_category : "other",
    product_summary:
      typeof b.product_summary === "string"
        ? b.product_summary.slice(0, 200)
        : "",
    overall_score:
      typeof b.overall_score === "number" && Number.isFinite(b.overall_score)
        ? b.overall_score
        : 0,
    priority_action:
      typeof b.priority_action === "string"
        ? b.priority_action.slice(0, 200)
        : "",
  });

  return NextResponse.json(
    { supporting_photo_checklist: checklist },
    { status: 200 }
  );
}
