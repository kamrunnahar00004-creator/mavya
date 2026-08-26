import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/openai", () => ({
  getImageModel: () => "test-model",
  imageEditCall: vi.fn(),
}));
vi.mock("@/lib/usage", () => ({
  generationDisabled: () => false,
  withinGlobalBudget: async () => true,
  isRefundable: () => false,
}));

import { maybeQueueRefinement } from "@/lib/refinement";

type InsertedRow = Record<string, unknown>;

function makeAdmin() {
  const inserted: InsertedRow[] = [];
  const insert = vi.fn((row: InsertedRow) => {
    inserted.push(row);
    return {
      select: () => ({
        maybeSingle: async () => ({ data: { id: "refine-job-id" }, error: null }),
      }),
    };
  });
  const from = vi.fn(() => ({ insert }));
  return { admin: { from } as never, insert, inserted };
}

const baseJob = {
  id: "job-1",
  user_id: "user-1",
  product_id: "product-1",
  photo_id: "photo-1",
  source_audit_id: "audit-1",
  workflow_id: "wf-1",
  attempt_number: 1,
  allowance_key: "user-1:workflow:key",
  generation_style: "matches_original" as const,
};

describe("background refinement after seller edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a sub-7.5 EDIT result queues attempt 2 and carries the edit instruction", async () => {
    const { admin, inserted } = makeAdmin();
    const queued = await maybeQueueRefinement({
      admin,
      completedJob: {
        ...baseJob,
        operation: "edit",
        edit_instruction: "Remove the text overlay",
      },
      acceptedRawScore: 6.9,
    });
    expect(queued).toBe("refine-job-id");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      operation: "refine",
      edit_instruction: "Remove the text overlay",
      attempt_number: 2,
      idempotency_key: "wf-1:a2",
      charged: 0,
      allowance_key: baseJob.allowance_key,
    });
  });

  it("an improve workflow queues refinement with a null edit instruction", async () => {
    const { admin, inserted } = makeAdmin();
    const queued = await maybeQueueRefinement({
      admin,
      completedJob: { ...baseJob, operation: "improve", edit_instruction: null },
      acceptedRawScore: 5.0,
    });
    expect(queued).toBe("refine-job-id");
    expect(inserted[0]).toMatchObject({
      operation: "refine",
      edit_instruction: null,
      attempt_number: 2,
    });
  });

  it("an edit result at raw 7.5+ does NOT refine (no fraction-chasing)", async () => {
    const { admin, insert } = makeAdmin();
    const queued = await maybeQueueRefinement({
      admin,
      completedJob: {
        ...baseJob,
        operation: "edit",
        edit_instruction: "Brighten the photo",
      },
      acceptedRawScore: 7.5,
    });
    expect(queued).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("never queues a fourth attempt, even for an edit workflow", async () => {
    const { admin, insert } = makeAdmin();
    const queued = await maybeQueueRefinement({
      admin,
      completedJob: {
        ...baseJob,
        operation: "refine",
        edit_instruction: "Remove the text overlay",
        attempt_number: 3,
      },
      acceptedRawScore: 4.0,
    });
    expect(queued).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("a failed edit attempt (no accepted score) still refines", async () => {
    const { admin, inserted } = makeAdmin();
    const queued = await maybeQueueRefinement({
      admin,
      completedJob: {
        ...baseJob,
        operation: "edit",
        edit_instruction: "Remove the text overlay",
      },
      acceptedRawScore: null,
    });
    expect(queued).toBe("refine-job-id");
    expect(inserted[0]).toMatchObject({
      edit_instruction: "Remove the text overlay",
      attempt_number: 2,
    });
  });
});

describe("0013 selection migration invariants", () => {
  const sql = readFileSync(
    path.resolve("supabase/migrations/0013_user_lock_blocks_only_refine.sql"),
    "utf8"
  );

  it("keeps the legacy score fallback from migration 0008", () => {
    expect(sql).toContain("coalesce(");
    expect(sql).toContain("nullif(candidate_rubric->>'raw_overall_score', '')::numeric");
    expect(sql).toContain("nullif(candidate_rubric->>'overall_score', '')::numeric");
  });

  it("the user lock blocks only automatic background refinement", () => {
    expect(sql).toContain(
      "if p_operation = 'refine' and v_photo.selection_source = 'user' then"
    );
    expect(sql).not.toContain(
      "if p_operation <> 'edit' and v_photo.selection_source = 'user'"
    );
  });

  it("a seller-directed edit always selects, even without a rescore", () => {
    // The edit branch must run BEFORE the raw_score null guard.
    const editBranch = sql.indexOf("if p_operation = 'edit' then");
    const nullGuard = sql.indexOf("if v_candidate.raw_score is null then return false");
    expect(editBranch).toBeGreaterThan(-1);
    expect(nullGuard).toBeGreaterThan(-1);
    expect(editBranch).toBeLessThan(nullGuard);
  });

  it("stays service-role only", () => {
    expect(sql).toContain(
      "revoke all on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean) from public, anon, authenticated"
    );
    expect(sql).toContain(
      "grant execute on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean) to service_role"
    );
  });
});
