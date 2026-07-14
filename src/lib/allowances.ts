import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/errors";

/**
 * Shared monthly credits (founder decisions, 2026-07-14):
 *  - 1,000 credits per Stripe billing period.
 *  - photo rating: 10 credits (internal kind='assessment')
 *  - Improve, Manual Edit, user Retry: 20 credits each (internal kind='workflow')
 *  - Automatic attempts 2-3: free (operation='refine')
 *  - Internal candidate rescoring: free
 *  - Score cache hits: free (no provider work)
 *
 * Credits are consumed atomically per Stripe billing period (period key =
 * current_period_start) via SECURITY DEFINER functions (service-role only).
 * Renewal refreshes exactly once (period key changes once per renewal). Refunds
 * occur for infrastructure failures only; honest rejections do not refund.
 */
export const CREDITS_PER_PERIOD = 1000;
export const RATING_COST = 10;
export const WORKFLOW_COST = 20;

export type AllowanceKind = "assessment" | "workflow";

export type AllowanceResult =
  | { ok: true; remaining: number; duplicate: boolean }
  | { ok: false; code: "insufficient_credits" | "internal_error"; remaining?: number };

/** Atomically consume credits for an action (rating, improve, edit, retry). */
export async function consumeAllowance(args: {
  userId: string;
  kind: AllowanceKind;
  periodKey: string;
  idempotencyKey: string;
  refId?: string | null;
}): Promise<AllowanceResult> {
  try {
    const admin = createSupabaseAdminClient();
    const cost = args.kind === "assessment" ? RATING_COST : WORKFLOW_COST;
    const { data, error } = await admin.rpc("consume_monthly_credits", {
      p_user: args.userId,
      p_kind: args.kind,
      p_period: args.periodKey,
      p_cost: cost,
      p_limit: CREDITS_PER_PERIOD,
      p_key: args.idempotencyKey,
      p_ref: args.refId ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("consume_allowance returned no row");
    if (!row.ok) {
      return { ok: false, code: "insufficient_credits", remaining: row.remaining ?? 0 };
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
    const { data, error } = await admin.rpc("refund_monthly_credits", {
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
): Promise<{ creditsUsed: number }> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("usage_periods")
      .select("credits_used")
      .eq("user_id", userId)
      .eq("period_key", periodKey)
      .maybeSingle();
    return {
      creditsUsed: Math.max(0, data?.credits_used ?? 0),
    };
  } catch {
    return { creditsUsed: 0 };
  }
}
