import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";
import { apiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-derived billing status for the UI (subscribe page, post-checkout
 * confirmation polling, and settings). Read-only; never writes state.
 */
export async function GET() {
  const requestStartedAt = Date.now();
  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in first.");

  const entitlement = await getEntitlement(user.id);
  console.log(
    JSON.stringify({
      event: "perf",
      span: "billing.status",
      ms: Date.now() - requestStartedAt,
    })
  );

  return NextResponse.json(
    {
      ok: true,
      active: entitlement.active,
      reason: entitlement.reason,
      status: entitlement.status,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      // Server-derived only -- the browser never computes its own limit from
      // a price id. Null whenever there's no resolved plan (matches
      // Entitlement's own null-together contract for these three fields).
      planKey: entitlement.planKey,
      cadence: entitlement.cadence,
      activeListingLimit: entitlement.activeListingLimit,
    },
    { status: 200 }
  );
}
