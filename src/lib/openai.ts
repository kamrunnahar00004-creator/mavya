/**
 * Server-only OpenAI client wrappers.
 * Never import from client components — relies on OPENAI_API_KEY.
 *
 * Model IDs are env-var driven so the founder can swap to newer models
 * (e.g. gpt-image-2) without code changes.
 */

import { DETECTED_CATEGORY_VALUES } from "@/lib/taxonomy";
import { ISSUE_FAMILIES, PILLAR_KEYS } from "@/lib/rubric";

const OPENAI_BASE = "https://api.openai.com/v1";

export const RUBRIC_RESPONSE_SCHEMA = {
  name: "mavya_photo_audit",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "upload_kind",
      "checklist_category",
      "supporting_photo_checklist",
      "product_summary",
      "supporting_photo_role",
      "buyer_question_answered",
      "supporting_verdict",
      "priority_pillar",
      "priority_issue_family",
      "overall_score",
      "pillars",
      "detected_category",
      "priority_action",
      "priority_explanation",
      "next_steps",
      "share_headline",
      "crop_suggestion",
      "light_adjustment",
      "generation_risk",
      "generation_risk_reason",
      "trust_risk",
      "trust_evidence",
      "is_marketing_graphic",
      "answers_question_ids",
    ],
    properties: {
      upload_kind: {
        type: "string",
        enum: ["physical_product", "digital_product", "invalid"],
      },
      trust_risk: { type: "string", enum: ["none", "moderate", "high"] },
      trust_evidence: { type: "string" },
      checklist_category: { type: "string" },
      supporting_photo_checklist: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rank",
            "shot_id",
            "title",
            "reason",
            "how_to",
            "buyer_question",
            "answers_doubt",
            "priority",
            "avoid",
            "feasible_because",
          ],
          properties: {
            rank: { type: "integer", minimum: 1, maximum: 5 },
            shot_id: { type: "string" },
            title: { type: "string" },
            reason: { type: "string" },
            how_to: { type: "string" },
            buyer_question: { type: "string" },
            answers_doubt: {
              type: "string",
              enum: [
                "identity",
                "scale",
                "quality",
                "fit",
                "completeness",
                "risk",
                "desire",
              ],
            },
            priority: { type: "string", enum: ["critical", "recommended"] },
            avoid: { type: "string" },
            feasible_because: { type: "string" },
          },
        },
      },
      product_summary: { type: "string" },
      supporting_photo_role: {
        type: "string",
        enum: [
          "detail_closeup",
          "scale_reference",
          "alternate_angle",
          "in_use",
          "packaging",
          "whats_included",
          "feature_spec",
          "care_instruction",
          "variation",
          "digital_preview",
          "process",
          "size_chart",
          "ingredients_materials",
          "bundle_layout",
          "printed_example",
          "device_mockup",
          "planner_preview",
          "unrelated_or_wrong_product",
          "other",
        ],
      },
      buyer_question_answered: { type: "string" },
      supporting_verdict: { type: "string" },
      priority_pillar: { type: "string", enum: [...PILLAR_KEYS] },
      priority_issue_family: { type: "string", enum: [...ISSUE_FAMILIES] },
      overall_score: { type: "number", minimum: 0, maximum: 10 },
      pillars: {
        type: "object",
        additionalProperties: false,
        required: ["thumbnail", "lighting", "background", "click_appeal"],
        properties: {
          thumbnail: { type: "integer", minimum: 0, maximum: 10 },
          lighting: { type: "integer", minimum: 0, maximum: 10 },
          background: { type: "integer", minimum: 0, maximum: 10 },
          click_appeal: { type: "integer", minimum: 0, maximum: 10 },
        },
      },
      detected_category: {
        type: "string",
        enum: [...DETECTED_CATEGORY_VALUES],
      },
      priority_action: { type: "string" },
      priority_explanation: { type: "string" },
      next_steps: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["observation", "action"],
          properties: {
            observation: { type: "string" },
            action: { type: "string" },
          },
        },
      },
      share_headline: { type: "string" },
      crop_suggestion: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "w", "h"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              w: { type: "number", minimum: 0, maximum: 1 },
              h: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        ],
      },
      light_adjustment: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["exposure", "warmth"],
            properties: {
              exposure: { type: "number", minimum: -1, maximum: 1 },
              warmth: { type: "number", minimum: -1, maximum: 1 },
            },
          },
        ],
      },
      generation_risk: {
        type: "string",
        enum: ["standard", "review_text", "unsupported"],
      },
      generation_risk_reason: { type: "string" },
      is_marketing_graphic: { type: "boolean" },
      answers_question_ids: { type: "array", items: { type: "string" } },
    },
  },
} as const;

const CHECKLIST_RESPONSE_SCHEMA = {
  name: "mavya_supporting_checklist",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["checklist_category", "supporting_photo_checklist"],
    properties: {
      checklist_category: { type: "string" },
      supporting_photo_checklist: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rank",
            "shot_id",
            "title",
            "reason",
            "how_to",
            "buyer_question",
            "answers_doubt",
            "priority",
            "avoid",
            "feasible_because",
          ],
          properties: {
            rank: { type: "integer", minimum: 1, maximum: 5 },
            shot_id: { type: "string" },
            title: { type: "string" },
            reason: { type: "string" },
            how_to: { type: "string" },
            buyer_question: { type: "string" },
            answers_doubt: {
              type: "string",
              enum: [
                "identity",
                "scale",
                "quality",
                "fit",
                "completeness",
                "risk",
                "desire",
              ],
            },
            priority: { type: "string", enum: ["critical", "recommended"] },
            avoid: { type: "string" },
            feasible_because: { type: "string" },
          },
        },
      },
    },
  },
} as const;

/**
 * OpenAI blocked the image edit/generation via its own safety system
 * (error.code "moderation_blocked"). This is a distinct, expected failure mode
 * — not an infrastructure error and not something the seller did wrong — so
 * callers can surface an honest message instead of a generic "failed" one.
 * Thrown with the full parsed provider error attached (never logged with a
 * blind text slice, so the moderation category is never silently cut off).
 */
export class ProviderModerationError extends Error {
  readonly providerError: unknown;
  constructor(message: string, providerError: unknown) {
    super(message);
    this.name = "ProviderModerationError";
    this.providerError = providerError;
  }
}

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY not set. Add it to .env.local (see .env.local.example)."
    );
  }
  return key;
}

export function getVisionModel(): string {
  // 2026-08-23: default bumped gpt-4o -> gpt-5.6-sol (founder decision,
  // main-v22/supporting-v17). OPENAI_VISION_MODEL still overrides this in
  // any environment, e.g. Vercel production.
  return process.env.OPENAI_VISION_MODEL || "gpt-5.6-sol";
}

export function getImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
}

const FIDELITY_RESPONSE_SCHEMA = {
  name: "mavya_fidelity_comparison",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "publishable",
      "fidelity_score",
      "authenticity_score",
      "full_product_visible",
      "ai_looking",
      "invented_or_missing_details",
      "text_or_pattern_drift",
      "collage_or_duplicate_product",
      "remaining_issues",
      "recommended_next_action",
      "reason",
    ],
    properties: {
      publishable: { type: "boolean" },
      fidelity_score: { type: "number", minimum: 0, maximum: 10 },
      authenticity_score: { type: "number", minimum: 0, maximum: 10 },
      full_product_visible: { type: "boolean" },
      ai_looking: { type: "boolean" },
      invented_or_missing_details: { type: "boolean" },
      text_or_pattern_drift: { type: "boolean" },
      collage_or_duplicate_product: { type: "boolean" },
      remaining_issues: {
        type: "array",
        items: { type: "string" },
      },
      recommended_next_action: {
        type: "string",
        enum: [
          "deliver",
          "deterministic_finish",
          "regenerate",
          "request_clearer_source",
        ],
      },
      reason: { type: "string" },
    },
  },
} as const;

/**
 * Score a product photo using a vision-capable chat model with strict JSON output.
 * Returns the raw JSON string from the model (caller parses + validates).
 */
export async function visionScoreCall(args: {
  imageDataUrl: string;
  systemPrompt: string;
  /** Descriptive summary of the main listing product, used only for supporting-photo relevance. */
  mainProductContext?: string;
}): Promise<string> {
  const ctx = args.mainProductContext?.trim();
  const userText = ctx
    ? `This is a SUPPORTING photo for an Etsy listing whose main product is: "${ctx}". Judge whether this photo is evidence for that SAME listing and score it. Return only the JSON object.`
    : "Score this product photo. Return only the JSON object.";
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: getVisionModel(),
      response_format: {
        type: "json_schema",
        json_schema: RUBRIC_RESPONSE_SCHEMA,
      },
      temperature: 0.2,
      messages: [
        { role: "system", content: args.systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userText,
            },
            {
              type: "image_url",
              image_url: { url: args.imageDataUrl, detail: "high" },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI vision ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Generate the supporting-photo checklist with a cheap, TEXT-ONLY chat call.
 * No image is sent. The caller passes the product context extracted by the main
 * score. Returns the raw JSON string (caller parses + validates + pool-filters).
 */
export async function checklistCall(args: {
  systemPrompt: string;
  userMessage: string;
}): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: getVisionModel(),
      response_format: {
        type: "json_schema",
        json_schema: CHECKLIST_RESPONSE_SCHEMA,
      },
      temperature: 0.3,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI checklist ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Compare an original photo with a generated candidate. Returns the raw JSON
 * string the model produced under the fidelity schema (caller parses + validates).
 */
export async function visionCompareCall(args: {
  originalDataUrl: string;
  candidateDataUrl: string;
  systemPrompt: string;
}): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: getVisionModel(),
      response_format: {
        type: "json_schema",
        json_schema: FIDELITY_RESPONSE_SCHEMA,
      },
      temperature: 0.1,
      messages: [
        { role: "system", content: args.systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Image 1 is the ORIGINAL product photo the seller uploaded. Image 2 is the AI-IMPROVED candidate. Compare them and return only the JSON object.",
            },
            {
              type: "image_url",
              image_url: { url: args.originalDataUrl, detail: "high" },
            },
            {
              type: "image_url",
              image_url: { url: args.candidateDataUrl, detail: "high" },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI vision compare ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Edit a product photo using the OpenAI Images Edit endpoint.
 * Returns the generated image as a base64 PNG string (no data URL prefix).
 */
export async function imageEditCall(args: {
  imageBuffer: Buffer;
  imageMimeType: "image/png" | "image/jpeg";
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
}): Promise<string> {
  const form = new FormData();
  form.set("model", getImageModel());
  form.set("prompt", args.prompt);
  form.set("size", args.size ?? "1024x1024");

  // Convert Node Buffer to a Blob for the FormData body.
  const blob = new Blob([new Uint8Array(args.imageBuffer)], {
    type: args.imageMimeType,
  });
  const filename = args.imageMimeType === "image/png" ? "input.png" : "input.jpg";
  form.set("image", blob, filename);

  const res = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    // Parse the structured error FIRST (never a blind slice) so a moderation
    // block's category detail is never silently truncated in logs, and so it
    // can be distinguished from a generic provider failure.
    let parsed: { error?: { code?: string; message?: string } } | null = null;
    try {
      parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    } catch {
      // Not JSON: fall through to the generic error below.
    }
    if (parsed?.error?.code === "moderation_blocked") {
      throw new ProviderModerationError(
        parsed.error.message || "Blocked by the provider's safety system.",
        parsed
      );
    }
    throw new Error(`OpenAI image edit ${res.status}: ${text.slice(0, 2000)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string }>;
  };
  const b64 = data.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("Image edit response had no b64_json payload");
  }
  return b64;
}
