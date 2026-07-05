/**
 * Server-only OpenAI client wrappers.
 * Never import from client components — relies on OPENAI_API_KEY.
 *
 * Model IDs are env-var driven so the founder can swap to newer models
 * (e.g. gpt-image-2) without code changes.
 */

const OPENAI_BASE = "https://api.openai.com/v1";

const RUBRIC_RESPONSE_SCHEMA = {
  name: "mavya_photo_audit",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "upload_kind",
      "checklist_category",
      "supporting_photo_checklist",
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
    ],
    properties: {
      upload_kind: {
        type: "string",
        enum: ["physical_product", "digital_product", "invalid"],
      },
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
        enum: ["jewelry", "candles", "crochet_plush", "soap", "mugs", "other"],
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
    },
  },
} as const;

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
  return process.env.OPENAI_VISION_MODEL || "gpt-4o";
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
              text: "Score this product photo. Return only the JSON object.",
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
    throw new Error(`OpenAI image edit ${res.status}: ${text.slice(0, 400)}`);
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
