import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import {
  CREDITS_PER_PERIOD,
  getAllowanceUsage,
} from "@/lib/allowances";
import { apiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-derived billing status for the UI (subscribe page, post-checkout
 * confirmation polling, credit meter). Read-only; never writes state.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const entitlement = await getEntitlement(user.id);
  const usage = entitlement.periodKey
    ? await getAllowanceUsage(user.id, entitlement.periodKey)
    : { creditsUsed: 0 };
  const creditsUsed = Math.min(CREDITS_PER_PERIOD, Math.max(0, usage.creditsUsed));

  return NextResponse.json(
    {
      ok: true,
      active: entitlement.active,
      reason: entitlement.reason,
      status: entitlement.status,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      credits: {
        used: creditsUsed,
        remaining: CREDITS_PER_PERIOD - creditsUsed,
        limit: CREDITS_PER_PERIOD,
      },
    },
    { status: 200 }
  );
}
