import { describe, expect, it } from "vitest";
import { hashImageBytes, hashText } from "@/lib/image-hash";
import {
  RUBRIC_VERSION,
  SUPPORTING_RUBRIC_VERSION,
  GENERATION_PROMPT_VERSION,
  FIDELITY_PROMPT_VERSION,
  CHECKLIST_PROMPT_VERSION,
  rubricVersionFor,
} from "@/lib/versions";

describe("image hashing (score-cache key)", () => {
  it("is deterministic for identical bytes", () => {
    const a = Buffer.from("same-image-bytes");
    const b = Buffer.from("same-image-bytes");
    expect(hashImageBytes(a)).toBe(hashImageBytes(b));
    expect(hashImageBytes(a)).toHaveLength(64); // sha256 hex
  });

  it("differs for different bytes and contexts", () => {
    expect(hashImageBytes(Buffer.from("a"))).not.toBe(hashImageBytes(Buffer.from("b")));
    expect(hashText("pink candle")).not.toBe(hashText("blue mug"));
    expect(hashText("")).toBe("");
  });
});

describe("prompt/model versioning", () => {
  it("all versions are non-empty and distinct per concern", () => {
    const versions = [
      RUBRIC_VERSION,
      SUPPORTING_RUBRIC_VERSION,
      GENERATION_PROMPT_VERSION,
      FIDELITY_PROMPT_VERSION,
      CHECKLIST_PROMPT_VERSION,
    ];
    for (const v of versions) expect(v.length).toBeGreaterThan(0);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("routes scoring modes to the right rubric version", () => {
    expect(rubricVersionFor("main")).toBe(RUBRIC_VERSION);
    expect(rubricVersionFor("supporting")).toBe(SUPPORTING_RUBRIC_VERSION);
  });
});
