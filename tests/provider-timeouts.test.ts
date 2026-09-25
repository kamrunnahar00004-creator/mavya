import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const openai = readFileSync(path.resolve("src/lib/openai.ts"), "utf8");

describe("OpenAI request deadlines", () => {
  it("bounds every provider fetch below the route ceiling", () => {
    // 5 provider calls (score, checklist, writer, fidelity, image); each must be bounded.
    expect(openai.match(/fetch\(`/g)).toHaveLength(5);
    expect(openai.match(/signal: AbortSignal\.timeout/g)).toHaveLength(5);
    expect(openai).toContain("OPENAI_JSON_TIMEOUT_MS = 45_000");
    expect(openai).toContain("OPENAI_IMAGE_TIMEOUT_MS = 120_000");
  });
});
