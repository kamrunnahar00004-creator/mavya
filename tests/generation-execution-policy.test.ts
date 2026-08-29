import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generationStyleAllowedForExecution } from "@/lib/refinement";

describe("durable generation execution policy", () => {
  it("blocks an informational supporting row persisted under older policy", () => {
    expect(
      generationStyleAllowedForExecution({
        photoRole: "supporting",
        audit: {
          detected_category: "apparel",
          supporting_photo_role: "size_chart",
        },
        generationStyle: "matches_original",
      }),
    ).toBe(false);
  });

  it("does not apply the supporting-role block to a main photo", () => {
    expect(
      generationStyleAllowedForExecution({
        photoRole: "main",
        audit: {
          detected_category: "apparel",
          supporting_photo_role: "size_chart",
        },
        generationStyle: "studio",
      }),
    ).toBe(true);
  });

  it("keeps ordinary supporting styles aligned with the shared matrix", () => {
    expect(
      generationStyleAllowedForExecution({
        photoRole: "supporting",
        audit: {
          detected_category: "jewelry",
          supporting_photo_role: "detail_closeup",
        },
        generationStyle: "studio",
      }),
    ).toBe(true);
  });

  it("revalidates both root and refinement workers before provider work", () => {
    const source = readFileSync("src/lib/refinement.ts", "utf8");
    expect(source.match(/!generationStyleAllowedForExecution\(/g)).toHaveLength(2);

    const refinementStart = source.indexOf("export async function runQueuedRefinementOnce");
    const rootStart = source.indexOf("export async function runQueuedGenerationOnce");
    const refinementWorker = source.slice(refinementStart, rootStart);
    const rootWorker = source.slice(rootStart);

    expect(refinementWorker.indexOf("!generationStyleAllowedForExecution(")).toBeLessThan(
      refinementWorker.indexOf('withinGlobalBudget("generate")'),
    );
    expect(rootWorker.indexOf("!generationStyleAllowedForExecution(")).toBeLessThan(
      rootWorker.indexOf('withinGlobalBudget("generate")'),
    );
    expect(rootWorker.indexOf("!generationStyleAllowedForExecution(")).toBeLessThan(
      rootWorker.indexOf("const charge = await consumeAllowance"),
    );
    expect(rootWorker.indexOf("!generationStyleAllowedForExecution(")).toBeLessThan(
      rootWorker.indexOf("const result = await improvePhoto"),
    );
  });
});
