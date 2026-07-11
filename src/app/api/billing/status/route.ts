import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import {
  ASSESSMENTS_PER_PERIOD,
  WORKFLOWS_PER_PERIOD,
  getAllowanceUsage,
} from "@/lib/allowances";
import { apiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-derived billing status for the UI (subscribe page, post-checkout
 * confirmation polling, allowance meters). Read-only; never writes state.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const entitlement = await getEntitlement(user.id);
  const usage = entitlement.periodKey
    ? await getAllowanceUsage(user.id, entitlement.periodKey)
    : { assessmentsUsed: 0, workflowsUsed: 0 };

  return NextResponse.json(
    {
      ok: true,
      active: entitlement.active,
      reason: entitlement.reason,
      status: entitlement.status,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      allowances: {
        assessments: {
          used: usage.assessmentsUsed,
          limit: ASSESSMENTS_PER_PERIOD,
        },
        workflows: {
          used: usage.workflowsUsed,
          limit: WORKFLOWS_PER_PERIOD,
        },
      },
    },
    { status: 200 }
  );
}
