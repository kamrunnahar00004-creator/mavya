import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blocksFreePreview } from "@/lib/improve-photo";
import type { FidelityReport } from "@/lib/fidelity";

const safeReport: FidelityReport = {
  publishable: false,
  fidelity_score: 6,
  authenticity_score: 6,
  full_product_visible: true,
  ai_looking: false,
  invented_or_missing_details: false,
  text_or_pattern_drift: false,
  collage_or_duplicate_product: false,
  remaining_issues: [],
  recommended_next_action: "regenerate",
  reason: "Safe but below the publish-ready gate.",
};

describe("trusted generation state", () => {
  it("never normalizes known product drift as a useful preview", () => {
    expect(
      blocksFreePreview({ ...safeReport, text_or_pattern_drift: true }, "main")
    ).toBe(true);
    expect(
      blocksFreePreview(
        { ...safeReport, invented_or_missing_details: true },
        "main"
      )
    ).toBe(true);
    expect(blocksFreePreview(safeReport, "main")).toBe(false);
  });

  it("migration removes browser credit and audit authority", () => {
    const sql = readFileSync(
      path.resolve("supabase/migrations/0004_trusted_generation_state.sql"),
      "utf8"
    );
    expect(sql).toContain("revoke update on table public.profiles from authenticated");
    expect(sql).toContain("grant update (username)");
    expect(sql).toContain('drop policy if exists "audits_insert_own"');
    expect(sql).toContain("revoke insert on table public.audits from authenticated");
    expect(sql).toContain("selected_generation_job_id");
  });
});
