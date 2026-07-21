import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/allowances", () => ({
  refundAllowance: vi.fn(async () => {}),
  consumeAllowance: vi.fn(async () => true),
}));
vi.mock("@/lib/usage", () => ({
  generationDisabled: () => false,
  withinGlobalBudget: async () => true,
  isRefundable: () => true,
}));
vi.mock("@/lib/openai", () => ({ getImageModel: () => "test-model" }));

import { refundAllowance } from "@/lib/allowances";
import {
  isStaleActiveGenerationJob,
  recoverStaleGenerationJob,
  RECOVERABLE_ACTIVE_STATUSES,
  STALE_GENERATION_MS,
} from "@/lib/refinement";

type Row = Record<string, unknown> | null;

/**
 * Mock admin recording update payloads, insert rows, and `.lt()` filters. The
 * FIRST update is the recovery CAS (its maybeSingle returns casResult); any
 * later update (the truthful `refunded` follow-up) resolves empty via `then`.
 */
function makeAdmin(opts: { casResult: Row; insertResult?: Row }) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const lts: [string, unknown][] = [];
  let updateCount = 0;
  const resolveUpdate = () => {
    updateCount += 1;
    return updateCount === 1
      ? { data: opts.casResult, error: null }
      : { data: null, error: null };
  };
  const from = () => {
    let op: "update" | "insert" | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.update = (fields: Record<string, unknown>) => (
      (op = "update"), updates.push(fields), b
    );
    b.insert = (row: Record<string, unknown>) => ((op = "insert"), inserts.push(row), b);
    b.select = () => b;
    b.eq = () => b;
    b.in = () => b;
    b.lt = (col: string, val: unknown) => (lts.push([col, val]), b);
    b.maybeSingle = async () => {
      if (op === "update") return resolveUpdate();
      if (op === "insert")
        return { data: opts.insertResult ?? { id: "successor-1" }, error: null };
      return { data: null, error: null };
    };
    b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
      const res =
        op === "update"
          ? resolveUpdate()
          : op === "insert"
          ? { data: opts.insertResult ?? { id: "successor-1" }, error: null }
          : { data: null, error: null };
      return Promise.resolve(res).then(onF, onR);
    };
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from } as any, updates, inserts, lts };
}

const activeJob = (overrides: Record<string, unknown> = {}) => ({
  id: "j1",
  user_id: "u1",
  product_id: "p1",
  photo_id: "ph1",
  source_audit_id: "a1",
  operation: "improve",
  edit_instruction: null,
  workflow_id: "w1",
  attempt_number: 1,
  allowance_key: "ak1",
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("isStaleActiveGenerationJob (shared predicate)", () => {
  const old = new Date(Date.now() - STALE_GENERATION_MS - 1000).toISOString();
  const fresh = new Date().toISOString();
  it("a queued job is NEVER a provider timeout, even when old", () => {
    expect(isStaleActiveGenerationJob({ status: "queued", updated_at: old })).toBe(false);
  });
  it("an old active generating attempt IS stale", () => {
    expect(isStaleActiveGenerationJob({ status: "generating", updated_at: old })).toBe(true);
    expect(isStaleActiveGenerationJob({ status: "fidelity_check", updated_at: old })).toBe(true);
    expect(isStaleActiveGenerationJob({ status: "rescoring", updated_at: old })).toBe(true);
  });
  it("a fresh active attempt is not stale", () => {
    expect(isStaleActiveGenerationJob({ status: "generating", updated_at: fresh })).toBe(false);
  });
  it("only generating/fidelity_check/rescoring are recoverable — not queued", () => {
    expect([...RECOVERABLE_ACTIVE_STATUSES]).toEqual(["generating", "fidelity_check", "rescoring"]);
  });
});

describe("recoverStaleGenerationJob", () => {
  it("verifies staleness ATOMICALLY: the CAS filters updated_at < cutoff", async () => {
    const { admin, lts } = makeAdmin({ casResult: activeJob() });
    await recoverStaleGenerationJob(admin, "j1");
    expect(lts.some(([col]) => col === "updated_at")).toBe(true);
  });

  it("a freshly-updated active job loses the CAS (0 rows): no refund, no successor", async () => {
    // casResult null models the row failing `updated_at < cutoff` because a live
    // executor refreshed it between any read and the UPDATE.
    const { admin, inserts, updates } = makeAdmin({ casResult: null });
    const id = await recoverStaleGenerationJob(admin, "j1");
    expect(id).toBeNull();
    expect(refundAllowance).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    // Only the CAS attempt ran; no truthful-refund follow-up update.
    expect(updates).toHaveLength(1);
  });

  it("CAS winner on attempt 1: refunds once, sets refunded=true truthfully, queues successor once", async () => {
    const { admin, inserts, updates } = makeAdmin({ casResult: activeJob() });
    const id = await recoverStaleGenerationJob(admin, "j1");
    expect(id).toBe("j1");
    expect(refundAllowance).toHaveBeenCalledTimes(1);
    expect(refundAllowance).toHaveBeenCalledWith("ak1");
    // The CAS update itself does NOT write refunded; a second update sets it true.
    expect(updates[0]).not.toHaveProperty("refunded");
    expect(updates[1]).toMatchObject({ refunded: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].attempt_number).toBe(2);
  });

  it("attempt 2: never refunds, never writes refunded=true, never queues attempt 3", async () => {
    const { admin, inserts, updates } = makeAdmin({
      casResult: activeJob({ attempt_number: 2 }),
    });
    const id = await recoverStaleGenerationJob(admin, "j1");
    expect(id).toBe("j1");
    expect(refundAllowance).not.toHaveBeenCalled();
    // No refund follow-up update at all -> refunded stays false.
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("refunded");
    expect(inserts).toHaveLength(0);
  });
});

describe("polling and worker share ONE recovery implementation", () => {
  const route = readFileSync(path.resolve("src/app/api/generate/route.ts"), "utf8");
  const worker = readFileSync(path.resolve("src/app/api/generate/worker/route.ts"), "utf8");
  it("the generate route no longer defines its own stale logic", () => {
    expect(route).not.toContain("failStaleJob");
    expect(route).toContain("recoverStaleGenerationJob");
    expect(route).toContain("isStaleActiveGenerationJob");
  });
  it("the worker recovers stale jobs through the shared batch function", () => {
    expect(worker).toContain("recoverStaleJobs");
  });
});
