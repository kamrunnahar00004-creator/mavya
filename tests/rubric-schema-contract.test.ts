import { describe, expect, it } from "vitest";
import { RUBRIC_RESPONSE_SCHEMA } from "@/lib/openai";
import { RUBRIC_PROMPT, INVALID_RESPONSE } from "@/lib/rubric";
import { GENERAL_RUBRIC_PROMPT } from "@/lib/general-rubric";

/**
 * The strict OpenAI response schema is the CONTRACT for what the scorer may
 * return. A field the prompt asks for but the schema omits can never reach the
 * parser (additionalProperties:false strips it), which is exactly how
 * is_marketing_graphic was silently dropped. These guard that class of bug.
 */
describe("strict rubric response schema contract", () => {
  const schema = RUBRIC_RESPONSE_SCHEMA.schema;
  const required = schema.required as readonly string[];
  const properties = schema.properties as Record<string, unknown>;

  it("is strict and closed (additionalProperties:false)", () => {
    expect(RUBRIC_RESPONSE_SCHEMA.strict).toBe(true);
    expect(schema.additionalProperties).toBe(false);
  });

  it("declares is_marketing_graphic as a required boolean property", () => {
    expect(required).toContain("is_marketing_graphic");
    expect(properties.is_marketing_graphic).toEqual({ type: "boolean" });
  });

  it("OpenAI strict invariant: every property is required", () => {
    for (const key of Object.keys(properties)) {
      expect(required, `property "${key}" must be in required`).toContain(key);
    }
  });

  it("OpenAI strict invariant: every required field has a property", () => {
    for (const key of required) {
      expect(
        Object.keys(properties),
        `required "${key}" must have a property definition`
      ).toContain(key);
    }
  });
});

describe("both prompts define every schema-required field they must emit", () => {
  // The strict schema forces is_marketing_graphic on EVERY response, main and
  // supporting. A prompt that does not define the field leaves the model to
  // guess it — the exact gap that could wrongly disable One-click on an ordinary
  // main photo. Guard that both prompts define it.
  it("the main prompt defines is_marketing_graphic (guidance + JSON shapes)", () => {
    // At least: the instruction, the valid-shape line, and the invalid example.
    expect(
      RUBRIC_PROMPT.match(/is_marketing_graphic/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
    expect(RUBRIC_PROMPT).toContain('"is_marketing_graphic": false');
  });

  it("the supporting prompt defines is_marketing_graphic (guidance + JSON shapes)", () => {
    expect(
      GENERAL_RUBRIC_PROMPT.match(/is_marketing_graphic/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
    expect(GENERAL_RUBRIC_PROMPT).toContain('"is_marketing_graphic": false');
  });

  it("the canonical invalid response carries the field as false", () => {
    expect(INVALID_RESPONSE.is_marketing_graphic).toBe(false);
  });
});
