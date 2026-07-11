import { NextResponse } from "next/server";

/**
 * Stable typed error taxonomy for API routes. The `code` is part of the client
 * contract; messages are user-facing and never include provider internals.
 */
export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "insufficient_credits"
  | "subscription_required"
  | "subscription_past_due"
  | "allowance_exhausted"
  | "billing_unavailable"
  | "ai_disabled"
  | "generation_disabled"
  | "rate_limited"
  | "rate_limit_not_configured"
  | "invalid_upload"
  | "unsupported_media"
  | "unsupported_digital_generation"
  | "unsupported_product"
  | "wrong_product"
  | "stale_audit"
  | "source_unavailable"
  | "provider_timeout"
  | "provider_refusal"
  | "malformed_response"
  | "no_publishable_candidate"
  | "unsafe_candidate"
  | "incomplete_source"
  | "image_failed"
  | "vision_failed"
  | "bad_ai_response"
  | "persistence_failed"
  | "signing_failed"
  | "idempotency_conflict"
  | "bad_request"
  | "internal_error";

const STATUS: Partial<Record<ApiErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  insufficient_credits: 402,
  subscription_required: 402,
  subscription_past_due: 402,
  allowance_exhausted: 402,
  billing_unavailable: 503,
  ai_disabled: 503,
  generation_disabled: 503,
  rate_limited: 429,
  rate_limit_not_configured: 503,
  invalid_upload: 400,
  unsupported_media: 400,
  unsupported_digital_generation: 422,
  unsupported_product: 422,
  wrong_product: 422,
  stale_audit: 409,
  source_unavailable: 404,
  idempotency_conflict: 409,
  bad_request: 400,
  no_publishable_candidate: 422,
  unsafe_candidate: 422,
  incomplete_source: 422,
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { ok: false, code, error: message, message, ...extra },
    { status: STATUS[code] ?? 500 }
  );
}

/**
 * Structured server log line. Never pass secrets, tokens, or image data.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown>
): void {
  console.log(JSON.stringify({ event, t: new Date().toISOString(), ...fields }));
}
