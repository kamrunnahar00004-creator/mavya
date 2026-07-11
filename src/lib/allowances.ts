import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/errors";

/**
 * Paid-beta monthly allowances (founder decisions):
 *  - 20 photo assessments per billing month.
 *  - 12 image-improvement workflows per billing month.
 *  - Up to 3 total generation attempts inside one workflow (attempts 2-3 are
 *    internal background refinement and never consume a second workflow).
 *
 * Allowances are ACTIONS, not dollars. They are metered per Stripe billing
 * period (period key = current_period_start), consumed atomically via the
 * SECURITY DEFINER consume_allowance() function that only the service role can
 * execute. Renewal refreshes exactly once because the period key changes
 * exactly once. Infrastructure failures refund (refund_allowance) so a failed
 * workflow is not consumed permanently; honest quality rejections are NOT
 * refunded (the provider cost was genuinely incurred).
 */
export const ASSESSMENTS_PER_PERIOD = 20;
export const WORKFLOWS_PER_PERIOD = 12;

export type AllowanceKind = "assessment" | "workflow";

const LIMITS: Record<AllowanceKind, number> = {
  assessment: ASSESSMENTS_PER_PERIOD,
  workflow: WORKFLOWS_PER_PERIOD,
};

export function allowanceLimit(kind: AllowanceKind): number {
  return LIMITS[kind];
}

export type AllowanceResult =
  | { ok: true; remaining: number; duplicate: boolean }
  | { ok: false; code: "allowance_exhausted" | "internal_error"; remaining?: number };

/** Atomically consume one unit of an allowance for the given billing period. */
export async function consumeAllowance(args: {
  userId: string;
  kind: AllowanceKind;
  periodKey: string;
  idempotencyKey: string;
  refId?: string | null;
}): Promise<AllowanceResult> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("consume_allowance", {
      p_user: args.userId,
      p_kind: args.kind,
      p_period: args.periodKey,
      p_limit: LIMITS[args.kind],
      p_key: args.idempotencyKey,
      p_ref: args.refId ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("consume_allowance returned no row");
    if (!row.ok) {
      return { ok: false, code: "allowance_exhausted", remaining: row.remaining ?? 0 };
    }
    return { ok: true, remaining: row.remaining, duplicate: Boolean(row.duplicate) };
  } catch (err) {
    logEvent("allowance.consume_failed", {
      userId: args.userId,
      kind: args.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, code: "internal_error" };
  }
}

/** Refund a prior allowance charge (infrastructure failures only). */
export async function refundAllowance(idempotencyKey: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("refund_allowance", {
      p_key: idempotencyKey,
    });
    if (error) throw error;
    return Boolean(data);
  } catch (err) {
    logEvent("allowance.refund_failed", {
      key: idempotencyKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Current usage for the billing period (for the status endpoint / UI). */
export async function getAllowanceUsage(
  userId: string,
  periodKey: string
): Promise<{ assessmentsUsed: number; workflowsUsed: number }> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("usage_periods")
      .select("assessments_used, workflows_used")
      .eq("user_id", userId)
      .eq("period_key", periodKey)
      .maybeSingle();
    return {
      assessmentsUsed: data?.assessments_used ?? 0,
      workflowsUsed: data?.workflows_used ?? 0,
    };
  } catch {
    return { assessmentsUsed: 0, workflowsUsed: 0 };
  }
}
