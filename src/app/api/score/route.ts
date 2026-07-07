import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { scorePhoto, ScorePhotoError } from "@/lib/score-photo";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";
import { MAX_SERVER_IMAGE_BYTES } from "@/lib/upload-limits";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);
const BAD_MIME_MESSAGE =
  "Use a JPG or PNG photo.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = await rateLimit(`score:${ip}`, 6, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error:
          limit.reason === "missing_durable_store"
            ? "Rate limiting is not configured."
            : "Too many requests. Wait a minute.",
        code:
          limit.reason === "missing_durable_store"
            ? "rate_limit_not_configured"
            : "rate_limited",
      },
      { status: limit.reason === "missing_durable_store" ? 503 : 429 }
    );
  }
  const dailyLimit = await rateLimit(`score-day:${ip}`, 50, 24 * 60 * 60 * 1000);
  if (!dailyLimit.ok) {
    return NextResponse.json(
      {
        error:
          dailyLimit.reason === "missing_durable_store"
            ? "Rate limiting is not configured."
            : "Daily score limit hit. Try again tomorrow.",
        code:
          dailyLimit.reason === "missing_durable_store"
            ? "rate_limit_not_configured"
            : "rate_limited",
      },
      { status: dailyLimit.reason === "missing_durable_store" ? 503 : 429 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data.", code: "bad_form" },
      { status: 400 }
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing image upload.", code: "missing_image" },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: BAD_MIME_MESSAGE, code: "bad_mime" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SERVER_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Photo too large. Use a smaller image under 4MB.", code: "too_large" },
      { status: 400 }
    );
  }

  // mode=extra grades a supporting photo with the general rubric. Default is the
  // main hero/thumbnail rubric. Same JSON contract either way.
  const mode = form.get("mode");
  if (typeof mode === "string" && mode !== "main" && mode !== "extra") {
    return NextResponse.json(
      { error: "Invalid score mode.", code: "bad_mode" },
      { status: 400 }
    );
  }
  const systemPrompt = mode === "extra" ? GENERAL_RUBRIC_PROMPT : undefined;

  // Descriptive main-listing product, threaded only for supporting photos so the
  // rubric can judge "same listing evidence" and flag a wrong/unrelated product.
  const rawContext = form.get("main_product_context");
  const mainProductContext =
    mode === "extra" && typeof rawContext === "string"
      ? rawContext.trim().slice(0, 200)
      : undefined;

  const buffer = Buffer.from(await file.arrayBuffer());
  let rubric;
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
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 502 }
    );
  }

  return NextResponse.json({ rubric }, { status: 200 });
}
