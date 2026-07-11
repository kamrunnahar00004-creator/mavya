import { describe, expect, it } from "vitest";
import { coveredShotIds, ROLE_COVERS_SHOTS } from "@/lib/checklist-coverage";
import { poolFor, ALL_SHOT_IDS } from "@/data/photo-checklist-pool";

describe("checklist coverage diffing", () => {
  it("a scale photo covers the scale recommendation", () => {
    const covered = coveredShotIds(["scale_reference"]);
    expect(covered.has("scale_reference")).toBe(true);
    expect(covered.has("packaging_gift")).toBe(false);
  });

  it("unknown roles cover nothing", () => {
    expect(coveredShotIds(["other", "unrelated_or_wrong_product"]).size).toBe(0);
    expect(coveredShotIds([]).size).toBe(0);
  });

  it("every mapped shot id exists in the real pool vocabulary", () => {
    for (const shots of Object.values(ROLE_COVERS_SHOTS)) {
      for (const shot of shots) {
        expect(ALL_SHOT_IDS.has(shot)).toBe(true);
      }
    }
  });
});

describe("checklist pool routing", () => {
  it("digital categories never receive physical shots", () => {
    const pool = poolFor("digital_product", "digital_planner");
    expect(pool.some((s) => s.shot_id === "lit_glow")).toBe(false);
  });

  it("unknown category falls back to the universal pool for the kind", () => {
    expect(poolFor("physical_product", "definitely-not-a-category").length).toBeGreaterThan(0);
  });
});
