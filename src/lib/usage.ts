import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent, type ApiErrorCode } from "@/lib/errors";

/**
 * Central usage policy: action costs, signup allowance, kill switches, refund
 * rules, and atomic credit consumption (via SECURITY DEFINER SQL functions that
 * only the service role can execute).
 *
 * CONSERVATIVE BUSINESS DEFAULTS (change here, nowhere else):
 *  - Signup allowance: 8 credits (DB default on profiles.credits) = 3 scores +
 *    1 generation at current costs.
 *  - score costs 1 credit, generate costs 5, checklist is free (bundled).
 *  - Refunds: infrastructure failures only. Honest quality rejections
 *    (no_publishable_candidate / unsafe_candidate / incomplete_source) are NOT
 *    refunded because the provider cost was genuinely incurred.
 */
export const ACTION_COSTS = {
  score: 1,
  generate: 5,
  checklist: 0,
} as const;

export type BillableAction = keyof typeof ACTION_COSTS;

/** Error codes that qualify for an automatic credit refund. */
const REFUNDABLE_CODES: ReadonlySet<string> = new Set([
  "image_failed",
  "vision_failed",
  "bad_ai_response",
  "malformed_response",
  "provider_timeout",
  "persistence_failed",
  "internal_error",
]);

export function isRefundable(code: string): boolean {
  return REFUNDABLE_CODES.has(code);
}

/** Global kill switches (env-driven, no deploy needed on Vercel). */
export function aiDisabled(): boolean {
  return process.env.AI_DISABLED === "true";
}
export function generationDisabled(): boolean {
  return process.env.AI_DISABLED === "true" || process.env.GENERATION_DISABLED === "true";
}

/**
 * Global daily ceiling across ALL users (abuse/runaway backstop). Uses the
 * durable rate-limit store. Configure with GLOBAL_DAILY_AI_ACTIONS (default 2000
 * actions/day). Weighted by action cost so generations count more.
 */
export async function withinGlobalBudget(action: BillableAction): Promise<boolean> {
  const limit = Number(process.env.GLOBAL_DAILY_AI_ACTIONS || 2000);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  const weight = Math.max(1, ACTION_COSTS[action]);
  // Consume `weight` slots from a single global daily bucket.
  for (let i = 0; i < weight; i++) {
    const res = await rateLimit("global:ai-day", limit, 24 * 60 * 60 * 1000);
    if (!res.ok) return false;
  }
  return true;
}

export type ConsumeResult =
  | { ok: true; remaining: number; duplicate: boolean }
  | { ok: false; code: Extract<ApiErrorCode, "insufficient_credits" | "internal_error">; remaining?: number };

/**
 * Atomically consume credits for a user. Duplicate idempotency keys never
 * double-charge (the SQL function reports `duplicate: true`).
 */
export async function consumeCredits(args: {
  userId: string;
  action: BillableAction;
  idempotencyKey: string;
  refId?: string | null;
}): Promise<ConsumeResult> {
  const cost = ACTION_COSTS[args.action];
  if (cost === 0) return { ok: true, remaining: -1, duplicate: false };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("consume_credits", {
      p_user: args.userId,
      p_action: args.action,
      p_amount: cost,
      p_key: args.idempotencyKey,
      p_ref: args.refId ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("consume_credits returned no row");
    if (!row.ok) {
      return { ok: false, code: "insufficient_credits", remaining: row.remaining };
    }
    return { ok: true, remaining: row.remaining, duplicate: Boolean(row.duplicate) };
  } catch (err) {
    logEvent("credits.consume_failed", {
      userId: args.userId,
      action: args.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, code: "internal_error" };
  }
}

/** Refund a prior charge when the failure qualifies (policy above). */
export async function refundCredits(idempotencyKey: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("refund_credits", { p_key: idempotencyKey });
    if (error) throw error;
    return Boolean(data);
  } catch (err) {
    logEvent("credits.refund_failed", {
      key: idempotencyKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
