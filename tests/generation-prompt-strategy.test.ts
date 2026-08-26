import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const strategy = read("src/lib/generation-prompt-strategy.ts");
const improve = read("src/lib/improve-photo.ts");
const refinement = read("src/lib/refinement.ts");

describe("generation prompt strategy execution", () => {
  it("keeps prompt text server-only and separate from the client-safe policy", () => {
    expect(strategy).toContain("Server-only execution policy");
    expect(strategy).toContain("generationStylePromptBlock");
    expect(improve).toContain(
      'import { generationStylePromptBlock } from "@/lib/generation-prompt-strategy"'
    );
    expect(read("src/lib/generation-style.ts")).not.toContain(
      "CATEGORY-SPECIFIC STUDIO DIRECTION"
    );
    const importers = readdirSync(path.resolve("src"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) =>
        readFileSync(file, "utf8").includes("@/lib/generation-prompt-strategy")
      )
      .map((file) => path.relative(path.resolve("."), file).replaceAll("\\", "/"));
    expect(importers).toEqual(["src/lib/improve-photo.ts"]);
  });

  it("defines genuinely distinct matches-original, studio, and lifestyle instructions", () => {
    expect(strategy).toContain("SELECTED GENERATION STYLE: MATCHES ORIGINAL");
    expect(strategy).toContain("SELECTED GENERATION STYLE: STUDIO");
    expect(strategy).toContain("SELECTED GENERATION STYLE: MODEL / LIFESTYLE");
    expect(strategy).toContain("plain white or light-gray background/surface");
    expect(strategy).toContain("fit, scale, use, or placement");
  });

  it("makes product, text, count, condition, and supporting-role preservation absolute", () => {
    expect(strategy).toContain("ABSOLUTE PRODUCT-FIDELITY FLOOR");
    expect(strategy).toContain("every visible character of text");
    expect(strategy).toContain("count, bundle pieces, included accessories");
    expect(strategy).toContain("condition");
    expect(strategy).toContain("SUPPORTING-PHOTO ROLE LOCK");
  });

  it("has category-specific studio guidance for every physical taxonomy category", () => {
    for (const category of [
      "jewelry",
      "candles",
      "soap",
      "mugs",
      "crochet_plush",
      "apparel",
      "wall_art",
      "home_decor",
      "vintage",
      "bags",
      "personalized",
      "stickers",
      "stationery",
      "art_supplies",
    ]) {
      expect(strategy).toContain(`${category}:`);
    }
  });

  it("defines lifestyle guidance only for the client-safe allowlist categories", () => {
    for (const category of [
      "jewelry",
      "apparel",
      "bags",
      "wall_art",
      "home_decor",
      "mugs",
      "candles",
    ]) {
      expect(strategy).toMatch(new RegExp(`LIFESTYLE_BY_CATEGORY[\\s\\S]*${category}:`));
    }
    expect(strategy).toContain("generation_lifestyle_prompt_missing_for_category");
  });

  it("composes the strategy into audit-driven and seller-edit prompts", () => {
    expect(improve).toContain("const styleBlock = generationStylePromptBlock({");
    expect(improve.match(/styleBlock,/g)).toHaveLength(4);
    expect(improve).toContain('const generationStyle = args.generationStyle ?? "matches_original"');
  });

  it("passes the durable job style through both root and refinement execution", () => {
    expect(refinement.match(/generationStyle: job\.generation_style/g)).toHaveLength(2);
  });
});
