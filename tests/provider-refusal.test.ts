import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRefundable } from "@/lib/usage";

/**
 * Founder report: an OpenAI image-edit call returned
 * `{ error: { code: "moderation_blocked" } }` (the provider's own safety
 * system blocked the generated result — not an infra failure, not the
 * seller's fault). The failure was silently collapsed into the generic
 * "AI generation failed. Try again." message, AND the log line truncated the
 * provider's error body at 400 chars, cutting off the moderation category.
 * Neither the seller nor the founder could tell what actually happened.
 */
describe("provider_refusal: moderation-blocked results are distinct, refundable, honestly messaged", () => {
  it("is refundable (not the seller's fault)", () => {
    expect(isRefundable("provider_refusal")).toBe(true);
  });

  const openai = readFileSync(path.resolve("src/lib/openai.ts"), "utf8");
  it("parses the provider error JSON instead of blindly slicing the raw text", () => {
    expect(openai).toContain('JSON.parse(text)');
    expect(openai).toContain('"moderation_blocked"');
    expect(openai).toContain("ProviderModerationError");
  });

  const improvePhoto = readFileSync(
    path.resolve("src/lib/improve-photo.ts"),
    "utf8"
  );
  it("catches ProviderModerationError distinctly and returns provider_refusal", () => {
    expect(improvePhoto).toContain("err instanceof ProviderModerationError");
    expect(improvePhoto).toContain('code: "provider_refusal"');
    // Never blame the seller or invent a cause (product naming rule: name the
    // real failure, not a vague generic).
    expect(improvePhoto).toMatch(/safety system/i);
  });

  const route = readFileSync(
    path.resolve("src/app/api/generate/route.ts"),
    "utf8"
  );
  it("jobPayload surfaces an honest message for provider_refusal (not the generic fallback)", () => {
    expect(route).toContain('job.error_code === "provider_refusal"');
    expect(route).toMatch(/safety system/i);
  });

  const workspace = readFileSync(
    path.resolve("src/components/dashboard/product-workspace.tsx"),
    "utf8"
  );
  it("the client allows a manual retry for provider_refusal", () => {
    expect(workspace).toMatch(/RETRYABLE_CODES = new Set\(\[[\s\S]*"provider_refusal"[\s\S]*\]\)/);
  });
});
