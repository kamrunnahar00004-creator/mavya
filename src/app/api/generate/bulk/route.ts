import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError, logEvent } from "@/lib/errors";
import { generationDisabled } from "@/lib/usage";
import { getEntitlement } from "@/lib/entitlements";
import {
  consumeGenerationDailyBudget,
  queueGeneration,
} from "@/lib/generation-queue";
import { ACTIVE_JOB_STATUSES } from "@/lib/generation-types";
import { computeFixEligibilityBucket } from "@/lib/fix-eligibility";
import {
  buildBulkSummary,
  classifyPhotoForBulkFix,
  deriveBulkPhotoKey,
  rosterEntryFromQueueOutcome,
  type BulkRosterEntry,
  type BulkSkipReason,
} from "@/lib/bulk-fix";
import type { RubricJson } from "@/lib/rubric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BulkRequestRow = {
  id: string;
  user_id: string;
  product_id: string;
  idempotency_key: string;
  status: "processing" | "completed";
};

type BulkItemRow = {
  request_id: string;
  photo_id: string;
  ordinal: number;
  generation_key: string;
  status: "pending" | "queued" | "skipped" | "failed";
  reason: BulkSkipReason | null;
  job_id: string | null;
};

type PhotoRow = {
  id: string;
  role: "main" | "supporting";
  position: number;
  created_at: string;
  current_audit_id: string | null;
  selected_generation_job_id: string | null;
};

function storedRoster(items: readonly BulkItemRow[]): BulkRosterEntry[] {
  return items
    .filter(
      (item): item is BulkItemRow & { status: "queued" | "skipped" | "failed" } =>
        item.status !== "pending"
    )
    .map((item) => ({
      photoId: item.photo_id,
      status: item.status,
      ...(item.reason ? { reason: item.reason } : {}),
      ...(item.job_id ? { jobId: item.job_id } : {}),
    }));
}

function sortPhotos(photos: readonly PhotoRow[]): PhotoRow[] {
  return [...photos].sort((a, b) => {
    const roleOrder = (a.role === "main" ? 0 : 1) - (b.role === "main" ? 0 : 1);
    if (roleOrder !== 0) return roleOrder;
    if (a.position !== b.position) return a.position - b.position;
    const createdOrder = a.created_at.localeCompare(b.created_at);
    return createdOrder !== 0 ? createdOrder : a.id.localeCompare(b.id);
  });
}

async function loadRequestItems(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  requestId: string
): Promise<{ items: BulkItemRow[]; error: string | null }> {
  const { data, error } = await admin
    .from("bulk_generation_request_items")
    .select("request_id, photo_id, ordinal, generation_key, status, reason, job_id")
    .eq("request_id", requestId)
    .order("ordinal", { ascending: true });
  return { items: (data as BulkItemRow[] | null) ?? [], error: error?.message ?? null };
}

function bulkResponse(requestId: string, items: readonly BulkItemRow[], status = 200) {
  const roster = storedRoster(items);
  return NextResponse.json(
    { ok: true, requestId, summary: buildBulkSummary(roster), photos: roster },
    { status }
  );
}

/**
 * POST: durably freeze, then independently queue, the existing One-click fix
 * for every eligible photo on one product. The frozen roster is written
 * before any generation job, so a lost response or process death resumes the
 * same photos with the same per-photo keys.
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
    return apiError("subscription_required", "AI photo improvement is part of your Mavya plan.");
  }
  if (!entitlement.planKey) {
    logEvent("generate.bulk_active_entitlement_missing_plan", { userId: user.id });
    return apiError("internal_error", "Could not verify your plan. Try again.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("bad_request", "Invalid request body.");
  }
  const productId = typeof body.productId === "string" ? body.productId : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!productId || !idempotencyKey || idempotencyKey.length > 80) {
    return apiError("bad_request", "Missing productId or idempotencyKey.");
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  // Replays are looked up before request-level anti-spam. Completed requests
  // return immediately; interrupted requests resume their pending items.
  const { data: existing, error: existingErr } = await admin
    .from("bulk_generation_requests")
    .select("id, user_id, product_id, idempotency_key, status")
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingErr) {
    logEvent("generate.bulk_lookup_failed", { userId: user.id, error: existingErr.message });
    return apiError("internal_error", "Could not start Fix all. Try again.");
  }

  let requestRow = existing as BulkRequestRow | null;
  if (requestRow && requestRow.product_id !== productId) {
    return apiError(
      "idempotency_conflict",
      "This request key was already used with a different product."
    );
  }
  if (requestRow?.status === "completed") {
    const loaded = await loadRequestItems(admin, requestRow.id);
    if (loaded.error) {
      logEvent("generate.bulk_items_lookup_failed", {
        requestId: requestRow.id,
        error: loaded.error,
      });
      return apiError("internal_error", "Could not load the Fix-all request. Try again.");
    }
    return bulkResponse(requestRow.id, loaded.items);
  }

  if (!requestRow) {
    const ip = clientIp(req);
    const perMin = await rateLimit(`gen-bulk:u:${user.id}`, 5, 60_000);
    const perMinIp = await rateLimit(`gen-bulk:ip:${ip}`, 8, 60_000);
    if (!perMin.ok || !perMinIp.ok) {
      const reason = [perMin, perMinIp].find((result) => !result.ok)?.reason;
      if (reason === "missing_durable_store") {
        return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
      }
      return apiError("rate_limited", "Fix-all rate limit hit. Wait a minute.");
    }

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

    const { data: photoData, error: photosErr } = await supabase
      .from("photos")
      .select("id, role, position, created_at, current_audit_id, selected_generation_job_id")
      .eq("product_id", productId);
    if (photosErr) {
      logEvent("generate.bulk_photos_lookup_failed", {
        userId: user.id,
        productId,
        error: photosErr.message,
      });
      return apiError("internal_error", "Could not start Fix all. Try again.");
    }
    const photos = sortPhotos((photoData as PhotoRow[] | null) ?? []);
    const photoIds = photos.map((photo) => photo.id);
    const currentAuditIds = photos
      .map((photo) => photo.current_audit_id)
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
      for (const audit of audits ?? []) {
        auditsById.set(audit.id, {
          rubric: audit.rubric as RubricJson,
          score_cache_id: audit.score_cache_id,
        });
      }
    }

    const activePhotoIds = new Set<string>();
    if (photoIds.length > 0) {
      const { data: activeJobs, error: activeErr } = await supabase
        .from("generation_jobs")
        .select("photo_id")
        .in("photo_id", photoIds)
        .in("status", Array.from(ACTIVE_JOB_STATUSES));
      if (activeErr) {
        logEvent("generate.bulk_active_lookup_failed", {
          userId: user.id,
          productId,
          error: activeErr.message,
        });
        return apiError("internal_error", "Could not start Fix all. Try again.");
      }
      for (const job of activeJobs ?? []) {
        if (job.photo_id) activePhotoIds.add(job.photo_id);
      }
    }

    const frozenItems = photos.map((photo, ordinal) => {
      const audit = photo.current_audit_id ? auditsById.get(photo.current_audit_id) : undefined;
      const hasCurrentAudit = Boolean(audit?.rubric && audit?.score_cache_id);
      const bucket = hasCurrentAudit
        ? computeFixEligibilityBucket(
            audit!.rubric,
            photo.role === "main" ? "main" : "supporting"
          )
        : null;
      const verdict = classifyPhotoForBulkFix({
        hasCurrentAudit,
        bucket,
        alreadyImproved: Boolean(photo.selected_generation_job_id),
        alreadyActive: activePhotoIds.has(photo.id),
      });
      return {
        photoId: photo.id,
        ordinal,
        generationKey: deriveBulkPhotoKey(user.id, productId, idempotencyKey, photo.id),
        status: verdict.eligible ? "pending" : "skipped",
        ...(!verdict.eligible ? { reason: verdict.reason } : {}),
      };
    });

    const { data: frozen, error: freezeErr } = await admin.rpc(
      "freeze_bulk_generation_request",
      {
        p_user: user.id,
        p_product: productId,
        p_idempotency_key: idempotencyKey,
        p_items: frozenItems,
      }
    );
    const freezeResult = Array.isArray(frozen) ? frozen[0] : frozen;
    if (freezeErr || !freezeResult?.request_id) {
      logEvent("generate.bulk_request_freeze_failed", {
        userId: user.id,
        productId,
        error: freezeErr?.message,
      });
      return apiError("internal_error", "Could not save the Fix-all request. Try again.");
    }
    if (freezeResult.product_conflict) {
      return apiError(
        "idempotency_conflict",
        "This request key was already used with a different product."
      );
    }
    const { data: claimed, error: claimedErr } = await admin
      .from("bulk_generation_requests")
      .select("id, user_id, product_id, idempotency_key, status")
      .eq("id", freezeResult.request_id)
      .single();
    if (claimedErr || !claimed) {
      logEvent("generate.bulk_claim_lookup_failed", {
        requestId: freezeResult.request_id,
        error: claimedErr?.message,
      });
      return apiError("internal_error", "Could not load the Fix-all request. Try again.");
    }
    requestRow = claimed as BulkRequestRow;
  }

  const loaded = await loadRequestItems(admin, requestRow.id);
  if (loaded.error) {
    logEvent("generate.bulk_items_lookup_failed", {
      requestId: requestRow.id,
      error: loaded.error,
    });
    return apiError("internal_error", "Could not load the Fix-all request. Try again.");
  }
  const pending = loaded.items.filter((item) => item.status === "pending");

  if (pending.length > 0) {
    const daily = await consumeGenerationDailyBudget(
      user.id,
      pending.length,
      `bulk:${idempotencyKey}`,
      entitlement.planKey
    );
    if (!daily.ok) {
      if (daily.reason === "missing_durable_store") {
        return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
      }
      return apiError("rate_limited", "Today's generation capacity is used up. Try again tomorrow.");
    }
  }

  for (const item of pending) {
    const outcome = await queueGeneration({
      supabase,
      userId: user.id,
      photoId: item.photo_id,
      idempotencyKey: item.generation_key,
      operation: "improve",
    });
    const entry = rosterEntryFromQueueOutcome(item.photo_id, outcome);
    const { error: itemErr } = await admin
      .from("bulk_generation_request_items")
      .update({
        status: entry.status,
        reason: entry.reason ?? null,
        job_id: entry.jobId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("request_id", requestRow.id)
      .eq("photo_id", item.photo_id);
    if (itemErr) {
      logEvent("generate.bulk_item_update_failed", {
        requestId: requestRow.id,
        photoId: item.photo_id,
        error: itemErr.message,
      });
      return apiError("internal_error", "Could not save Fix-all progress. Try again.");
    }
  }

  const final = await loadRequestItems(admin, requestRow.id);
  if (final.error) {
    logEvent("generate.bulk_items_lookup_failed", {
      requestId: requestRow.id,
      error: final.error,
    });
    return apiError("internal_error", "Could not load the Fix-all request. Try again.");
  }
  if (!final.items.some((item) => item.status === "pending")) {
    const { error: completeErr } = await admin
      .from("bulk_generation_requests")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", requestRow.id);
    if (completeErr) {
      logEvent("generate.bulk_complete_failed", {
        requestId: requestRow.id,
        error: completeErr.message,
      });
      return apiError("internal_error", "Could not finish the Fix-all request. Try again.");
    }
  }

  const roster = storedRoster(final.items);
  logEvent("generate.bulk_queued", {
    requestId: requestRow.id,
    productId,
    summary: buildBulkSummary(roster),
  });
  return bulkResponse(requestRow.id, final.items, existing ? 200 : 202);
}
