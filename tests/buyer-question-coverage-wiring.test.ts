import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checklistRoute = readFileSync("src/app/api/checklist/route.ts", "utf8");
const productPage = readFileSync(
  "src/app/(app)/dashboard/product/[id]/page.tsx",
  "utf8"
);
const productWorkspace = readFileSync(
  "src/components/dashboard/product-workspace.tsx",
  "utf8"
);

describe("buyer-question coverage wiring (slice 2)", () => {
  it("16. /api/checklist fetches the audit by current_audit_id, not an independent latest-by-created_at lookup", () => {
    expect(checklistRoute).toContain(
      'select("id, role, current_audit_id")'
    );
    expect(checklistRoute).toContain("if (!photo.current_audit_id) return empty();");
    expect(checklistRoute).toContain('.eq("id", photo.current_audit_id)');
    expect(checklistRoute).toContain('.eq("photo_id", photo.id)');
    // The old independent derivation must be gone, not just supplemented.
    expect(checklistRoute).not.toContain(
      '.order("created_at", { ascending: false })\n    .limit(1)'
    );
  });

  it("17. the product page computes coverage server-side and passes it as a prop; the workspace does not recompute it", () => {
    expect(productPage).toContain("computeBuyerQuestionCoverage(");
    expect(productPage).toContain("coverageState={coverageState}");
    expect(productPage).toContain(
      'coverageState={{ status: "unavailable", reason: "no_main_audit" }}'
    );
    // The client component only imports the TYPE, never the computation.
    expect(productWorkspace).toContain(
      'import type { CoverageState } from "@/lib/buyer-question-coverage";'
    );
    expect(productWorkspace).not.toContain("computeBuyerQuestionCoverage");
    expect(productWorkspace).toContain("coverageState: CoverageState;");
  });

  it("18. the rating_jobs query for the product page is proven exact, not merely bounded", () => {
    // rating_jobs has a UNIQUE constraint on photo_id (migration 0012), so
    // .in("photo_id", photoIds) can return at most photoIds.length rows --
    // structurally, not by luck. Assert both the constraint's continued
    // existence and the page's own documentation of relying on it.
    const migration = readFileSync(
      "supabase/migrations/0012_durable_rating_jobs.sql",
      "utf8"
    );
    expect(migration).toContain("unique (photo_id)");
    expect(productPage).toContain("UNIQUE constraint on photo_id");
    expect(productPage).toContain(
      'select("id, photo_id, status, error_message, error_code, created_at")'
    );
  });

  it("the product-page query widens audits/rating_jobs selects without adding a new round trip", () => {
    expect(productPage).toContain(
      '.select("id, rubric, rubric_version, created_at")'
    );
    expect(productPage).toContain("type AuditRow = { id: string; rubric: RubricJson; rubric_version: string | null; created_at: string };");
  });
});
