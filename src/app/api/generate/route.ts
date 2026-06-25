import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { scorePhoto, ScorePhotoError } from "@/lib/score-photo";
import { improvePhoto, sanitizeRetryConstraints } from "@/lib/improve-photo";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);
const DATA_URL_RE = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/;
const BAD_MIME_MESSAGE =
  "Use JPG or PNG. iPhone HEIC? Upload a screenshot or switch Camera to Most Compatible.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = await rateLimit(`gen:${ip}`, 2, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        code:
          limit.reason === "missing_durable_store"
            ? "rate_limit_not_configured"
            : "rate_limited",
        message:
          limit.reason === "missing_durable_store"
            ? "Rate limiting is not configured."
            : "Generation rate limit hit. Wait a minute.",
      },
      { status: limit.reason === "missing_durable_store" ? 503 : 429 }
    );
  }
  const dailyLimit = await rateLimit(`gen-day:${ip}`, 5, 24 * 60 * 60 * 1000);
  if (!dailyLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        code:
          dailyLimit.reason === "missing_durable_store"
            ? "rate_limit_not_configured"
            : "rate_limited",
        message:
          dailyLimit.reason === "missing_durable_store"
            ? "Rate limiting is not configured."
            : "Daily generation limit hit. Try again tomorrow.",
      },
      { status: dailyLimit.reason === "missing_durable_store" ? 503 : 429 }
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
      { ok: false, code: "bad_mime", message: BAD_MIME_MESSAGE },
      { status: 400 }
    );
  }
  if (file.size > MAX_SERVER_IMAGE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: "too_large",
        message: "Photo too large. Use a smaller image under 4MB.",
      },
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
  const originalMimeType = file.type as "image/png" | "image/jpeg";

  // Server-side canonical audit. Never trust browser audit JSON for prompt
  // composition or safety gating.
  let originalAudit;
  try {
    originalAudit = await scorePhoto({
      imageBuffer: buffer,
      imageMimeType: originalMimeType,
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

  let baseBuffer: Buffer | undefined;
  let baseMimeType: "image/png" | "image/jpeg" | undefined;
  let promptAudit = originalAudit;
  const retryBaseRaw = form.get("retryBaseImage");
  if (typeof retryBaseRaw === "string" && retryBaseRaw.length > 0) {
    const match = DATA_URL_RE.exec(retryBaseRaw);
    if (!match) {
      return NextResponse.json(
        {
          ok: false,
          code: "bad_retry_base",
          message: "Could not use the previous preview. Generate from the original photo instead.",
        },
        { status: 400 }
      );
    }
    baseMimeType = match[1] as "image/png" | "image/jpeg";
    baseBuffer = Buffer.from(match[2], "base64");
    if (baseBuffer.length > MAX_SERVER_IMAGE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: "retry_base_too_large",
          message: "Previous preview is too large to retry.",
        },
        { status: 400 }
      );
    }
    try {
      promptAudit = await scorePhoto({
        imageBuffer: baseBuffer,
        imageMimeType: baseMimeType,
        systemPrompt,
      });
    } catch (err) {
      console.error("[generate] retry base scoring failed:", err);
      promptAudit = originalAudit;
      baseBuffer = undefined;
      baseMimeType = undefined;
    }
  }

  const result = await improvePhoto({
    originalBuffer: buffer,
    originalMimeType,
    originalAudit,
    baseBuffer,
    baseMimeType,
    promptAudit,
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

  // Validation MVP: show the clean generated preview before payment so sellers
  // can judge the outcome. Stripe gates only the browser download click.
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
