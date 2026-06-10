import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { scorePhoto, ScorePhotoError } from "@/lib/score-photo";
import { improvePhoto, sanitizeRetryConstraints } from "@/lib/improve-photo";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import {
  createAssetId,
  createWatermarkedPreview,
  putCleanImage,
  putMeta,
} from "@/lib/blob-store";

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

// Local testing only: skip watermark, blob store, and paywall, returning the clean
// generated image directly. Never enable this in production.
const RAW_TEST_MODE = process.env.RAW_TEST_MODE === "true";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = rateLimit(`gen:${ip}`, 2, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "rate_limited",
        message: "Generation rate limit hit. Wait a minute.",
      },
      { status: 429 }
    );
  }
  const dailyLimit = rateLimit(`gen-day:${ip}`, 5, 24 * 60 * 60 * 1000);
  if (!dailyLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "rate_limited",
        message: "Daily generation limit hit. Try again tomorrow.",
      },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad_form", message: "Invalid form data." },
      { status: 400 }
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, code: "missing_image", message: "Missing image upload." },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { ok: false, code: "bad_mime", message: "Use a PNG or JPG." },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { ok: false, code: "too_large", message: "Photo too large. Max 10MB." },
      { status: 400 }
    );
  }

  // Optional retry constraints. These are our own server-generated strings
  // returned to the client on a prior failure. They only shape the prompt; all
  // safety gating still runs server-side on the new candidate, so tampering
  // cannot bypass the delivery gate.
  let extraConstraints: string[] | undefined;
  const retryRaw = form.get("unresolvedIssues");
  if (typeof retryRaw === "string" && retryRaw.length > 0) {
    try {
      const parsed = JSON.parse(retryRaw);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
      ) {
        // The browser round-trip is untrusted. Accept only the server-defined
        // remediation phrases emitted by the previous failed attempt.
        extraConstraints = sanitizeRetryConstraints(parsed);
      }
    } catch {
      // Ignore malformed retry payloads; treat as a fresh attempt.
    }
  }

  // mode=extra improves a supporting photo, graded by the general rubric.
  const mode = form.get("mode") === "extra" ? "extra" : "main";
  const systemPrompt = mode === "extra" ? GENERAL_RUBRIC_PROMPT : undefined;

  const buffer = Buffer.from(await file.arrayBuffer());

  // Server-side canonical audit. Never trust browser audit JSON for prompt
  // composition or safety gating.
  let originalAudit;
  try {
    originalAudit = await scorePhoto({
      imageBuffer: buffer,
      imageMimeType: file.type,
      systemPrompt,
    });
  } catch (err) {
    const error =
      err instanceof ScorePhotoError
        ? err
        : new ScorePhotoError("AI scoring failed. Try again.", "vision_failed");
    return NextResponse.json(
      { ok: false, code: error.code, message: error.message },
      { status: 502 }
    );
  }

  if (originalAudit.generation_risk === "unsupported") {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_product",
        message:
          "AI improvement is not supported for this product yet because exact product details may change. Your free audit is still ready above.",
      },
      { status: 422 }
    );
  }

  const result = await improvePhoto({
    originalBuffer: buffer,
    originalMimeType: file.type as "image/png" | "image/jpeg",
    originalAudit,
    extraConstraints,
    mode,
  });

  if (!result.ok) {
    const status =
      result.code === "no_publishable_candidate" ||
      result.code === "incomplete_source" ||
      result.code === "unsafe_candidate"
        ? 422
        : 502;
    return NextResponse.json(result, { status });
  }

  // TESTING (RAW_TEST_MODE): the candidate already passed the fidelity gate in
  // improvePhoto. Return it clean — no watermark, no blob store, no paywall.
  if (RAW_TEST_MODE) {
    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        previewBase64: result.imageBase64,
        previewMimeType: "image/png",
        candidateAudit: result.candidateAudit,
        fidelity: result.fidelity,
        attempts: result.attempts,
      },
      { status: 200 }
    );
  }

  // HARD INVARIANT: the clean full-resolution image NEVER leaves this server
  // boundary before payment. `result.imageBase64` is the clean candidate; it is
  // stored in blob storage and used to build a watermarked preview. The response
  // carries the preview only.
  const cleanBuffer = Buffer.from(result.imageBase64, "base64");

  let previewBase64: string;
  try {
    previewBase64 = await createWatermarkedPreview(cleanBuffer);
  } catch (err) {
    console.error("[api/generate] preview build failed:", err);
    return NextResponse.json(
      { ok: false, code: "preview_failed", message: "Could not prepare the preview. Try again." },
      { status: 502 }
    );
  }

  const assetId = createAssetId();
  try {
    await putCleanImage(assetId, cleanBuffer);
    await putMeta({
      assetId,
      outcome: result.outcome,
      scoreBefore: originalAudit.overall_score,
      scoreAfter: result.candidateAudit.overall_score,
      createdAt: Date.now(),
      mimeType: "image/png",
    });
  } catch (err) {
    console.error("[api/generate] blob store failed:", err);
    return NextResponse.json(
      { ok: false, code: "store_failed", message: "Could not save the result. Try again." },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      outcome: result.outcome,
      previewBase64,
      previewMimeType: "image/png",
      assetId,
      candidateAudit: result.candidateAudit,
      fidelity: result.fidelity,
      attempts: result.attempts,
    },
    { status: 200 }
  );
}
