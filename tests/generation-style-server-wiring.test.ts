import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const singleRoute = read("src/app/api/generate/route.ts");
const bulkRoute = read("src/app/api/generate/bulk/route.ts");
const queue = read("src/lib/generation-queue.ts");
const refinement = read("src/lib/refinement.ts");
const migration = read("supabase/migrations/0031_generation_styles.sql");

describe("generation style request boundaries", () => {
  it("rejects malformed styles before either route queues work", () => {
    for (const route of [singleRoute, bulkRoute]) {
      expect(route).toContain("isGenerationStyle(rawGenerationStyle)");
      expect(route).toContain('apiError("bad_request", "Invalid generation style.")');
      expect(route).toContain('rawGenerationStyle ?? "matches_original"');
    }
  });

  it("authorizes the style from the persisted audit and photo role", () => {
    expect(queue).toContain("availableGenerationStyles({");
    expect(queue).toContain(
      "normalizeGenerationStyleCategory(originalAudit.detected_category)"
    );
    expect(queue).toContain("supportingPhotoRole: originalAudit.supporting_photo_role");
    expect(queue).toContain("if (!availableStyles.includes(generationStyle))");
    expect(queue).toContain('code: "bad_request"');
  });

  it("keeps recommendation informational rather than using it as authorization", () => {
    expect(queue).toContain("recommendedMainStyle(");
    expect(queue).toContain("availableStyles.includes(generationStyle)");
    expect(queue).not.toMatch(/recommendedStyle\s*===\s*generationStyle/);
  });
});

describe("single-photo idempotency and workflow persistence", () => {
  it("treats a changed style as a same-key parameter conflict on both race paths", () => {
    expect(queue.match(/job\.generation_style !== generationStyle/g)).toHaveLength(2);
    expect(queue).toContain('code: "idempotency_conflict"');
  });

  it("persists the style and returns it in the refresh-safe payload", () => {
    expect(queue).toContain("generation_style: generationStyle");
    expect(singleRoute).toContain("generationStyle: job.generation_style");
  });

  it("inherits the root style for every automatic refinement", () => {
    expect(refinement).toContain('| "generation_style"');
    expect(refinement).toContain("generation_style: job.generation_style");
    expect(refinement).toContain("source_audit_id, operation, generation_style");
  });
});

describe("bulk style durability", () => {
  it("binds replay identity to product and style", () => {
    expect(bulkRoute).toContain("requestRow.generation_style !== generationStyle");
    expect(bulkRoute).toContain("freezeResult.style_conflict");
    expect(bulkRoute).toContain('apiError(\n      "idempotency_conflict"');
  });

  it("freezes style with the roster and passes the stored parent value to every photo", () => {
    expect(bulkRoute).toContain("p_generation_style: generationStyle");
    expect(bulkRoute).toContain("generationStyle: requestRow.generation_style");
    expect(bulkRoute).toContain("generationStyle: requestRow.generation_style,");
  });

  it("skips photos for which the selected batch style is unavailable", () => {
    expect(bulkRoute).toContain("availableGenerationStyles({");
    expect(bulkRoute).toContain("const eligible = verdict.eligible && styleAvailable");
    expect(bulkRoute).toContain(
      'verdict.eligible ? "not_generatable" : verdict.reason'
    );
  });
});

describe("0031 generation style migration", () => {
  it("backfills both durable tables with the live behavior and constrains values", () => {
    expect(migration.match(/add column if not exists generation_style/g)).toHaveLength(2);
    expect(migration.match(/not null default 'matches_original'/g)).toHaveLength(2);
    expect(
      migration.match(/'matches_original', 'studio', 'lifestyle'/g) ?? []
    ).toHaveLength(3);
  });

  it("adds a five-argument style-aware freeze overload without dropping the old function", () => {
    expect(migration).toContain("p_generation_style text");
    expect(migration).toContain("style_conflict boolean");
    expect(migration).toContain("v_request.generation_style <> p_generation_style");
    expect(migration).toContain("uuid, uuid, text, text, jsonb");
    expect(migration).not.toContain(
      "drop function public.freeze_bulk_generation_request(uuid, uuid, text, jsonb)"
    );
  });

  it("keeps the new overload service-role-only", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
