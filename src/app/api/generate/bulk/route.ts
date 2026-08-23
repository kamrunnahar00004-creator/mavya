import { NextRequest, NextResponse } from "next/server";
import { rateLimit, weightedRateLimitMany } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { generationDisabled } from "@/lib/usage";
import { getEntitlement } from "@/lib/entitlements";
import { queueGeneration } from "@/lib/generation-queue";
import { computeFixEligibilityBucket } from "@/lib/fix-eligibility";
import {
  classifyPhotoForBulkFix,
  deriveBulkPhotoKey,
  rosterEntryFromQueueOutcome,
  buildBulkSummary,
  type BulkRosterEntry,
} from "@/lib/bulk-fix";
import type { RubricJson } from "@/lib/rubric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Separate namespace and cap from the single-photo day limiter
 *  (gen-day:u:) -- a deliberately independent budget (Codex finding 2), not
 *  N repetitions of the per-minute single-photo limiter. */
const BULK_DAILY_WEIGHT_MAX = 40;
const BULK_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

type BulkRequestRow = {
  id: string;
  user_id: string;
  product_id: string;
  idempotency_key: string;
  roster: BulkRosterEntry[];
};

/**
 * POST: queue the existing per-photo One-click fix independently for every
 * qualifying photo on a product -- not a joint operation, not a joint check
 * afterward (Codex architecture review, Slice 4b, 2026-08-23).
 *
 * Body (JSON): { productId, idempotencyKey }. Never accepts client photo
 * IDs, scores, or buckets -- the eligible roster is entirely server-derived
 * and frozen into bulk_generation_requests (migration 0029) so a retry of
 * the same key resumes the exact same request rather than re-deriving
 * eligibility against possibly-changed current state.
 */
export async function POST(req: NextRequest) {
  if (generationDisabled()) {
    return apiError("generation_disabled", "AI generation is temporarily disabled.");
  }

  const user = await getSessionUser();
  if (!user) return apiError("unauthenticated", "Log in to improve photos.");

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.active || !entitlement.periodKey) {
    if (entitlement.reason === "past_due") {
      return apiError(
        "subscription_past_due",
        "Your payment did not go through. Update it in billing to keep improving photos. Your saved results are safe."
      );
    }
    return apiError(
      "subscription_required",
      "AI photo improvement is part of the Mavya Founding Beta subscription."
    );
  }

  // Request-level anti-spam guard against repeatedly clicking "Fix all"
  // itself. Deliberately separate from, and much smaller than, the weighted
  // per-photo cost budget below -- this just rate-limits the CLICK.
  const ip = clientIp(req);
  const perMin = await rateLimit(`gen-bulk:u:${user.id}`, 5, 60_000);
  const perMinIp = await rateLimit(`gen-bulk:ip:${ip}`, 8, 60_000);
  if (!perMin.ok || !perMinIp.ok) {
    const reason = [perMin, perMinIp].find((r) => !r.ok)?.reason;
    if (reason === "missing_durable_store") {
      return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
    }
    return apiError("rate_limited", "Fix-all rate limit hit. Wait a minute.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const productId = typeof body.productId === "string" ? body.productId : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 80) : "";
  if (!productId || !idempotencyKey) {
    return apiError("bad_request", "Missing productId or idempotencyKey.");
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  // Idempotency: a retry of the SAME key resumes the exact frozen roster,
  // never a fresh eligibility computation and never a second charge against
  // the weighted daily budget below.
  {
    const { data: existing, error: existingErr } = await supabase
      .from("bulk_generation_requests")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingErr) {
      logEvent("generate.bulk_lookup_failed", { userId: user.id, error: existingErr.message });
      return apiError("internal_error", "Could not start Fix all. Try again.");
    }
    if (existing) {
      const row = existing as BulkRequestRow;
      if (row.product_id !== productId) {
        return apiError(
          "idempotency_conflict",
          "This request key was already used with a different product."
        );
      }
      return NextResponse.json(
        {
          ok: true,
          requestId: row.id,
          summary: buildBulkSummary(row.roster),
          photos: row.roster,
        },
        { status: 200 }
      );
    }
  }

  // Ownership: RLS scopes products to the owner; a foreign productId
  // returns null.
  const { data: product, error: productErr } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (productErr) {
    logEvent("generate.bulk_product_lookup_failed", {
      userId: user.id,
      productId,
      error: productErr.message,
    });
    return apiError("internal_error", "Could not start Fix all. Try again.");
  }
  if (!product) return apiError("source_unavailable", "Product not found.");

  // Every photo on the product, RLS-scoped via the same ownership check.
  const { data: photos, error: photosErr } = await supabase
    .from("photos")
    .select("id, role, current_audit_id, selected_generation_job_id")
    .eq("product_id", productId);
  if (photosErr) {
    logEvent("generate.bulk_photos_lookup_failed", {
      userId: user.id,
      productId,
      error: photosErr.message,
    });
    return apiError("internal_error", "Could not start Fix all. Try again.");
  }

  const currentAuditIds = (photos ?? [])
    .map((p) => p.current_audit_id)
    .filter((id): id is string => Boolean(id));
  const auditsById = new Map<string, { rubric: RubricJson; score_cache_id: string | null }>();
  if (currentAuditIds.length > 0) {
    const { data: audits, error: auditsErr } = await supabase
      .from("audits")
      .select("id, rubric, score_cache_id")
      .in("id", currentAuditIds);
    if (auditsErr) {
      logEvent("generate.bulk_audits_lookup_failed", {
        userId: user.id,
        productId,
        error: auditsErr.message,
      });
      return apiError("internal_error", "Could not start Fix all. Try again.");
    }
    for (const a of audits ?? []) {
      auditsById.set(a.id, { rubric: a.rubric as RubricJson, score_cache_id: a.score_cache_id });
    }
  }

  // Classify every photo server-side. Nothing here is client-supplied.
  const roster: BulkRosterEntry[] = [];
  const eligiblePhotoIds: string[] = [];
  for (const photo of photos ?? []) {
    const audit = photo.current_audit_id ? auditsById.get(photo.current_audit_id) : undefined;
    const hasCurrentAudit = Boolean(audit?.rubric && audit?.score_cache_id);
    const bucket = hasCurrentAudit
      ? computeFixEligibilityBucket(audit!.rubric, photo.role === "main" ? "main" : "supporting")
      : null;
    const verdict = classifyPhotoForBulkFix({
      hasCurrentAudit,
      bucket,
      alreadyImproved: Boolean(photo.selected_generation_job_id),
    });
    if (verdict.eligible) {
      eligiblePhotoIds.push(photo.id);
    } else {
      roster.push({ photoId: photo.id, status: "skipped", reason: verdict.reason });
    }
  }

  // Weighted daily cost budget, charged ONCE for the whole batch (Codex
  // finding 2) -- never the single-photo per-minute limiter run N times.
  if (eligiblePhotoIds.length > 0) {
    const weighted = await weightedRateLimitMany(
      [{ key: `gen-bulk-day:u:${user.id}`, max: BULK_DAILY_WEIGHT_MAX }],
      eligiblePhotoIds.length,
      BULK_DAILY_WINDOW_MS,
      `${user.id}:${idempotencyKey}`
    );
    if (!weighted.ok) {
      if (weighted.reason === "missing_durable_store") {
        return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
      }
      return apiError(
        "rate_limited",
        "Today's Fix-all capacity is used up. Try again tomorrow, or fix photos individually."
      );
    }
  }

  // Process every eligible photo independently. One photo failing never
  // blocks or rolls back the others (Codex finding 5).
  for (const photoId of eligiblePhotoIds) {
    const photoKey = deriveBulkPhotoKey(user.id, productId, idempotencyKey, photoId);
    const outcome = await queueGeneration({
      supabase,
      userId: user.id,
      photoId,
      idempotencyKey: photoKey,
      operation: "improve",
    });
    roster.push(rosterEntryFromQueueOutcome(photoId, outcome));
  }

  // Freeze the roster. A concurrent duplicate of this exact key racing past
  // the lookup above loses this insert; its response defers to whichever
  // request actually won (never two different rosters for one key).
  const { data: created, error: createErr } = await admin
    .from("bulk_generation_requests")
    .insert({
      user_id: user.id,
      product_id: productId,
      idempotency_key: idempotencyKey,
      roster,
    })
    .select()
    .single();

  if (createErr || !created) {
    if (createErr?.code === "23505") {
      const { data: existing } = await admin
        .from("bulk_generation_requests")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        const row = existing as BulkRequestRow;
        if (row.user_id !== user.id || row.product_id !== productId) {
          return apiError(
            "idempotency_conflict",
            "This request key was already used with different parameters."
          );
        }
        return NextResponse.json(
          {
            ok: true,
            requestId: row.id,
            summary: buildBulkSummary(row.roster),
            photos: row.roster,
          },
          { status: 200 }
        );
      }
    }
    logEvent("generate.bulk_request_create_failed", { userId: user.id, error: createErr?.message });
    return apiError("internal_error", "Could not save the Fix-all request. Try again.");
  }
  const row = created as BulkRequestRow;

  logEvent("generate.bulk_queued", {
    requestId: row.id,
    productId,
    summary: buildBulkSummary(roster),
  });

  return NextResponse.json(
    { ok: true, requestId: row.id, summary: buildBulkSummary(roster), photos: roster },
    { status: 202 }
  );
}
