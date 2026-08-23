import { describe, expect, it } from "vitest";
import {
  classifyPhotoForBulkFix,
  deriveBulkPhotoKey,
  rosterEntryFromQueueOutcome,
  buildBulkSummary,
  type BulkRosterEntry,
} from "@/lib/bulk-fix";
import type { QueueGenerationOutcome, JobRow } from "@/lib/generation-queue";

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    user_id: "u1",
    product_id: "p1",
    photo_id: "photo-1",
    idempotency_key: "key-1",
    status: "queued",
    stage: "queued",
    operation: "improve",
    edit_instruction: null,
    result_storage_path: null,
    candidate_rubric: null,
    fidelity: null,
    outcome: null,
    error_code: null,
    credit_key: null,
    allowance_key: null,
    workflow_id: "job-1",
    attempt_number: 1,
    refunded: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("deriveBulkPhotoKey", () => {
  it("is deterministic: same inputs always produce the same key", () => {
    const a = deriveBulkPhotoKey("u1", "p1", "req-key", "photo-1");
    const b = deriveBulkPhotoKey("u1", "p1", "req-key", "photo-1");
    expect(a).toBe(b);
  });

  it("changes when any single input changes (user, product, bulk key, or photo)", () => {
    const base = deriveBulkPhotoKey("u1", "p1", "req-key", "photo-1");
    expect(deriveBulkPhotoKey("u2", "p1", "req-key", "photo-1")).not.toBe(base);
    expect(deriveBulkPhotoKey("u1", "p2", "req-key", "photo-1")).not.toBe(base);
    expect(deriveBulkPhotoKey("u1", "p1", "other-key", "photo-1")).not.toBe(base);
    expect(deriveBulkPhotoKey("u1", "p1", "req-key", "photo-2")).not.toBe(base);
  });

  it("retrying the same bulk idempotencyKey re-derives the SAME per-photo key for every photo (exact idempotent replay)", () => {
    const photoIds = ["a", "b", "c", "d", "e", "f"];
    const first = photoIds.map((id) => deriveBulkPhotoKey("u1", "p1", "req-key", id));
    const retry = photoIds.map((id) => deriveBulkPhotoKey("u1", "p1", "req-key", id));
    expect(retry).toEqual(first);
  });

  it("is a 64-char hex sha256 digest, never leaking raw ids verbatim", () => {
    const key = deriveBulkPhotoKey("u1", "p1", "req-key", "photo-1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("classifyPhotoForBulkFix", () => {
  it("no current audit is a stale_audit skip", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: false,
        bucket: null,
        alreadyImproved: false,
        alreadyActive: false,
      })
    ).toEqual({ eligible: false, reason: "stale_audit" });
  });

  it("a strong photo is skipped with reason strong", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "strong",
        alreadyImproved: false,
        alreadyActive: false,
      })
    ).toEqual({ eligible: false, reason: "strong" });
  });

  it("a not_generatable photo is skipped with reason not_generatable", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "not_generatable",
        alreadyImproved: false,
        alreadyActive: false,
      })
    ).toEqual({ eligible: false, reason: "not_generatable" });
  });

  it("an already-improved (selected preview) photo is skipped even when the bucket is eligible", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "needs_work",
        alreadyImproved: true,
        alreadyActive: false,
      })
    ).toEqual({ eligible: false, reason: "already_improved" });
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "acceptable",
        alreadyImproved: true,
        alreadyActive: false,
      })
    ).toEqual({ eligible: false, reason: "already_improved" });
  });

  it("needs_work or acceptable, not already improved, is eligible", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "needs_work",
        alreadyImproved: false,
        alreadyActive: false,
      })
    ).toEqual({ eligible: true });
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "acceptable",
        alreadyImproved: false,
        alreadyActive: false,
      })
    ).toEqual({ eligible: true });
  });

  it("an already-active workflow is skipped before bulk queueing", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: true,
        bucket: "needs_work",
        alreadyImproved: false,
        alreadyActive: true,
      })
    ).toEqual({ eligible: false, reason: "already_active" });
  });

  it("a missing audit wins over already_improved: stale_audit is reported, not already_improved", () => {
    expect(
      classifyPhotoForBulkFix({
        hasCurrentAudit: false,
        bucket: null,
        alreadyImproved: true,
        alreadyActive: true,
      })
    ).toEqual({ eligible: false, reason: "stale_audit" });
  });
});

describe("rosterEntryFromQueueOutcome", () => {
  it("a freshly queued job reports status queued with its jobId", () => {
    const outcome: QueueGenerationOutcome = { ok: true, job: job({ id: "j-new" }), origin: "new" };
    expect(rosterEntryFromQueueOutcome("photo-1", outcome)).toEqual({
      photoId: "photo-1",
      status: "queued",
      jobId: "j-new",
    });
  });

  it("same_key (this photo's derived key was already used by a prior identical call) also reports queued", () => {
    const outcome: QueueGenerationOutcome = {
      ok: true,
      job: job({ id: "j-existing" }),
      origin: "same_key",
    };
    expect(rosterEntryFromQueueOutcome("photo-1", outcome)).toEqual({
      photoId: "photo-1",
      status: "queued",
      jobId: "j-existing",
    });
  });

  it("an active root workflow already in flight is skipped as already_active, with the existing jobId (active-workflow skip)", () => {
    const outcome: QueueGenerationOutcome = {
      ok: true,
      job: job({ id: "j-active", status: "generating" }),
      origin: "active_root_conflict",
    };
    expect(rosterEntryFromQueueOutcome("photo-1", outcome)).toEqual({
      photoId: "photo-1",
      status: "skipped",
      reason: "already_active",
      jobId: "j-active",
    });
  });

  it("stale_audit from queueGeneration maps to a stale_audit skip", () => {
    const outcome: QueueGenerationOutcome = {
      ok: false,
      code: "stale_audit",
      message: "x",
    };
    expect(rosterEntryFromQueueOutcome("photo-1", outcome)).toEqual({
      photoId: "photo-1",
      status: "skipped",
      reason: "stale_audit",
    });
  });

  it("generation_disabled (global daily capacity) maps to a capacity skip", () => {
    const outcome: QueueGenerationOutcome = {
      ok: false,
      code: "generation_disabled",
      message: "x",
    };
    expect(rosterEntryFromQueueOutcome("photo-1", outcome)).toEqual({
      photoId: "photo-1",
      status: "skipped",
      reason: "capacity",
    });
  });

  it("every permanent generation gate code maps to a not_generatable skip", () => {
    for (const code of [
      "unsupported_digital_generation",
      "unsupported_graphic_generation",
      "unsupported_product",
      "wrong_product",
    ] as const) {
      expect(rosterEntryFromQueueOutcome("photo-1", { ok: false, code, message: "x" })).toEqual({
        photoId: "photo-1",
        status: "skipped",
        reason: "not_generatable",
      });
    }
  });

  it("an unanticipated failure code is a real per-photo failure, never silently dropped", () => {
    const outcome: QueueGenerationOutcome = {
      ok: false,
      code: "internal_error",
      message: "x",
    };
    expect(rosterEntryFromQueueOutcome("photo-1", outcome)).toEqual({
      photoId: "photo-1",
      status: "failed",
      reason: "queue_failed",
    });
  });
});

describe("buildBulkSummary (partial success, batch larger than two photos)", () => {
  it("counts a mixed six-photo batch correctly -- one photo failing never affects the others' counts", () => {
    const roster: BulkRosterEntry[] = [
      { photoId: "1", status: "queued", jobId: "j1" },
      { photoId: "2", status: "queued", jobId: "j2" },
      { photoId: "3", status: "skipped", reason: "strong" },
      { photoId: "4", status: "skipped", reason: "already_active", jobId: "j4" },
      { photoId: "5", status: "skipped", reason: "already_improved" },
      { photoId: "6", status: "failed", reason: "queue_failed" },
    ];
    expect(buildBulkSummary(roster)).toEqual({ total: 6, queued: 2, skipped: 3, failed: 1 });
  });

  it("an empty roster (no photos on the product) summarizes to all zeros", () => {
    expect(buildBulkSummary([])).toEqual({ total: 0, queued: 0, skipped: 0, failed: 0 });
  });
});
