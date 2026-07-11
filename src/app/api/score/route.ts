import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { scorePhoto, ScorePhotoError } from "@/lib/score-photo";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";
import { getSessionUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashImageBytes, hashText } from "@/lib/image-hash";
import { apiError, logEvent } from "@/lib/errors";
import {
  aiDisabled,
  consumeCredits,
  refundCredits,
  withinGlobalBudget,
} from "@/lib/usage";
import { getVisionModel } from "@/lib/openai";
import {
  MIN_IMAGE_DIMENSION,
  MAX_IMAGE_DIMENSION,
  rubricVersionFor,
} from "@/lib/versions";
import type { RubricJson } from "@/lib/rubric";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Score a listing photo. AUTH REQUIRED — anonymous scoring is disabled
 * (product decision: the landing gates the scan behind signup; the landing demo
 * is static assets, not live scoring). Charges 1 credit unless the identical
 * image (hash + rubric version + mode + context) was already scored by this
 * user, in which case the cached audit is returned free.
 */
export async function POST(req: NextRequest) {
  // 1. Kill switch before anything billable.
  if (aiDisabled()) {
    return apiError("ai_disabled", "AI scoring is temporarily disabled.");
  }

  // 2. Authenticate. Never trust a client-supplied user id.
  const user = await getSessionUser();
  if (!user) {
    return apiError("unauthenticated", "Log in to rate photos.");
  }

  // 3. Abuse-control rate limits (secondary to credits).
  const ip = clientIp(req);
  const perMin = await rateLimit(`score:u:${user.id}`, 6, 60_000);
  const perMinIp = await rateLimit(`score:${ip}`, 12, 60_000);
  if (!perMin.ok || !perMinIp.ok) {
    const reason = !perMin.ok ? perMin.reason : perMinIp.reason;
    if (reason === "missing_durable_store") {
      return apiError("rate_limit_not_configured", "Rate limiting is not configured.");
    }
    return apiError("rate_limited", "Too many requests. Wait a minute.");
  }

  // 4. Validate the upload BEFORE any billable call.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("bad_request", "Invalid form data.");
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return apiError("bad_request", "Missing image upload.");
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return apiError("unsupported_media", "Use a JPG or PNG photo.");
  }
  if (file.size > MAX_SERVER_IMAGE_BYTES) {
    return apiError("invalid_upload", "Photo too large. Use a smaller image under 4MB.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const meta = await sharp(buffer).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < MIN_IMAGE_DIMENSION || h < MIN_IMAGE_DIMENSION) {
      return apiError("invalid_upload", "Photo is too small. Use at least 200x200 pixels.");
    }
    if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
      return apiError("invalid_upload", "Photo dimensions are too large.");
    }
  } catch {
    return apiError("unsupported_media", "That file is not a readable image.");
  }

  const mode = form.get("mode");
  if (typeof mode === "string" && mode !== "main" && mode !== "extra") {
    return apiError("bad_request", "Invalid score mode.");
  }
  const scoringMode: "main" | "supporting" = mode === "extra" ? "supporting" : "main";
  const systemPrompt = scoringMode === "supporting" ? GENERAL_RUBRIC_PROMPT : undefined;

  const rawContext = form.get("main_product_context");
  const mainProductContext =
    scoringMode === "supporting" && typeof rawContext === "string"
      ? rawContext.trim().slice(0, 200)
      : undefined;

  // 5. Cache lookup: identical image + version + mode + context => free reuse.
  const imageHash = hashImageBytes(buffer);
  const rubricVersion = rubricVersionFor(scoringMode);
  const contextHash = hashText(mainProductContext ?? "");
  const admin = createSupabaseAdminClient();
  try {
    const { data: cached } = await admin
      .from("score_cache")
      .select("rubric")
      .eq("user_id", user.id)
      .eq("image_hash", imageHash)
      .eq("mode", scoringMode)
      .eq("rubric_version", rubricVersion)
      .eq("context_hash", contextHash)
      .maybeSingle();
    if (cached?.rubric) {
      logEvent("score.cache_hit", { userId: user.id, mode: scoringMode });
      return NextResponse.json(
        { rubric: cached.rubric as RubricJson, cached: true, imageHash, rubricVersion },
        { status: 200 }
      );
    }
  } catch (err) {
    // Cache is an optimization; a lookup failure must not block scoring.
    logEvent("score.cache_lookup_failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Global runaway budget.
  if (!(await withinGlobalBudget("score"))) {
    return apiError("ai_disabled", "Daily capacity reached. Try again tomorrow.");
  }

  // 7. Atomic charge. Idempotency = user + image + version + context, so a
  //    double-submit of the same photo cannot double-charge.
  const chargeKey = `${user.id}:score:${imageHash}:${scoringMode}:${rubricVersion}:${contextHash}`;
  const charge = await consumeCredits({
    userId: user.id,
    action: "score",
    idempotencyKey: chargeKey,
  });
  if (!charge.ok) {
    if (charge.code === "insufficient_credits") {
      return apiError("insufficient_credits", "You are out of credits.", {
        remaining: charge.remaining ?? 0,
      });
    }
    return apiError("internal_error", "Could not process the request. Try again.");
  }

  // 8. Provider call.
  const startedAt = Date.now();
  let rubric: RubricJson;
  try {
    rubric = await scorePhoto({
      imageBuffer: buffer,
      imageMimeType: file.type,
      systemPrompt,
      mainProductContext,
    });
  } catch (err) {
    const error =
      err instanceof ScorePhotoError
        ? err
        : new ScorePhotoError("AI scoring failed. Try again.", "vision_failed");
    // Provider/parse failure: refund the charge (policy: infra failures refund).
    if (!charge.duplicate) await refundCredits(chargeKey);
    logEvent("score.failed", {
      userId: user.id,
      code: error.code,
      latencyMs: Date.now() - startedAt,
    });
    return apiError(error.code, error.message);
  }

  // 9. Store in cache (best-effort).
  try {
    await admin.from("score_cache").insert({
      user_id: user.id,
      image_hash: imageHash,
      mode: scoringMode,
      rubric_version: rubricVersion,
      model: getVisionModel(),
      context_hash: contextHash,
      rubric,
    });
  } catch {
    // Unique-violation on a concurrent identical request is fine.
  }

  logEvent("score.completed", {
    userId: user.id,
    mode: scoringMode,
    score: rubric.overall_score,
    cached: false,
    latencyMs: Date.now() - startedAt,
    remainingCredits: charge.remaining,
  });

  return NextResponse.json(
    {
      rubric,
      cached: false,
      imageHash,
      rubricVersion,
      creditsRemaining: charge.remaining,
    },
    { status: 200 }
  );
}
