import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/allowances", () => ({
  // Returns a boolean: true = credit actually returned. Tests override per case
  // so a FAILED refund (false) can be distinguished from a successful one.
  refundAllowance: vi.fn(async () => true),
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
  recoverFailuresWithoutSuccessor,
  shouldQueueSuccessorAfterFailure,
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

  it("CAS winner on attempt 1 with a SUCCESSFUL refund: sets refunded=true, queues successor once", async () => {
    (refundAllowance as unknown as { mockResolvedValueOnce: (v: boolean) => void })
      .mockResolvedValueOnce(true);
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

  it("a FAILED refund is NOT recorded as refunded (no lost-credit-as-returned)", async () => {
    // Finding 1: refundAllowance returns false (infra blip). refunded must stay
    // false so reconciliation retries; the workflow still advances a successor.
    (refundAllowance as unknown as { mockResolvedValueOnce: (v: boolean) => void })
      .mockResolvedValueOnce(false);
    const { admin, inserts, updates } = makeAdmin({ casResult: activeJob() });
    const id = await recoverStaleGenerationJob(admin, "j1");
    expect(id).toBe("j1");
    expect(refundAllowance).toHaveBeenCalledTimes(1);
    // Only the CAS update ran — NO refunded:true follow-up.
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("refunded");
    // Recovery still queues the bounded successor.
    expect(inserts).toHaveLength(1);
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

describe("shouldQueueSuccessorAfterFailure (Blocker 1: never strand a paid workflow)", () => {
  it("a refundable failure whose refund FAILED still queues a successor", () => {
    // The user is still charged, so they must get the bounded attempt, not nothing.
    expect(
      shouldQueueSuccessorAfterFailure({ cancelled: false, wantRefund: true, didRefund: false })
    ).toBe(true);
  });
  it("a successful refund returns the money and queues no successor", () => {
    expect(
      shouldQueueSuccessorAfterFailure({ cancelled: false, wantRefund: true, didRefund: true })
    ).toBe(false);
  });
  it("a non-refundable failure queues a successor (weak sources are helped)", () => {
    expect(
      shouldQueueSuccessorAfterFailure({ cancelled: false, wantRefund: false, didRefund: false })
    ).toBe(true);
  });
  it("a cancelled job queues nothing (no charge, no work owed)", () => {
    expect(
      shouldQueueSuccessorAfterFailure({ cancelled: true, wantRefund: false, didRefund: false })
    ).toBe(false);
  });
});

describe("recoverFailuresWithoutSuccessor (Blocker 2: starvation-proof backstop)", () => {
  // The RPC returns ONLY missing-successor rows (NOT EXISTS) oldest-first, so
  // the JS never re-filters; it just requeues each returned row idempotently.
  function makeOrphanAdmin(opts: {
    rows?: Record<string, unknown>[];
    rpcError?: unknown;
    insertError?: { code?: string };
  }) {
    const inserts: Record<string, unknown>[] = [];
    const from = () => {
      let op: "insert" | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.insert = (row: Record<string, unknown>) => ((op = "insert"), inserts.push(row), b);
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () =>
        op === "insert"
          ? {
              data: opts.insertError ? null : { id: "queued" },
              error: opts.insertError ?? null,
            }
          : { data: null, error: null };
      return b;
    };
    const admin = {
      rpc: async () => ({ data: opts.rows ?? [], error: opts.rpcError ?? null }),
      from,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { admin, inserts };
  }

  const failedJob = {
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
  };

  it("requeues each missing-successor row the RPC returns", async () => {
    const { admin, inserts } = makeOrphanAdmin({ rows: [failedJob] });
    const n = await recoverFailuresWithoutSuccessor(admin);
    expect(n).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].attempt_number).toBe(2);
  });

  it("is concurrent/idempotent: a 23505 on requeue is tolerated (counts 0, no throw)", async () => {
    const { admin, inserts } = makeOrphanAdmin({
      rows: [failedJob],
      insertError: { code: "23505" },
    });
    const n = await recoverFailuresWithoutSuccessor(admin);
    expect(n).toBe(0); // another actor already queued it
    expect(inserts).toHaveLength(1); // attempt was made, not a duplicate
  });

  it("surfaces a scan-query failure (throws) rather than silently reporting zero", async () => {
    const { admin } = makeOrphanAdmin({ rpcError: { message: "db down" } });
    await expect(recoverFailuresWithoutSuccessor(admin)).rejects.toThrow(
      "failure_scan_failed"
    );
  });
});

describe("0020 generation_failures_without_successor RPC structure", () => {
  const sql = readFileSync(
    path.resolve("supabase/migrations/0020_generation_failures_without_successor.sql"),
    "utf8"
  );

  it("owes-work filter: failed/rejected, refunded=false, below ceiling — NOT only timeouts", () => {
    expect(sql).toContain("g.status in ('failed', 'rejected')");
    expect(sql).toContain("g.refunded = false");
    expect(sql).toContain("g.attempt_number < p_max_attempts");
    // Generalized: the WHERE clause has no error_code restriction, so
    // image_failed / vision_failed / persistence_failed / rejected all qualify —
    // not just provider_timeout. (Scoped to the query body, not the header docs.)
    const whereClause = sql.slice(sql.indexOf("where"), sql.indexOf("order by"));
    expect(whereClause).not.toContain("error_code");
    expect(whereClause).not.toContain("provider_timeout");
  });

  it("excludes cancelled jobs and successfully-refunded jobs", () => {
    // 'cancelled' is not in the status set; refunded=true rows fail refunded=false.
    expect(sql).not.toContain("cancelled");
    expect(sql).toContain("g.refunded = false");
  });

  it("returns ONLY missing-successor rows, oldest first, bounded (no starvation)", () => {
    // NOT EXISTS excludes any row that already has a successor, so 20+ older
    // rows WITH successors can never crowd out a later missing-successor row;
    // oldest-first ordering guarantees older missing rows are reached.
    expect(sql).toContain("not exists");
    expect(sql).toContain("s.attempt_number = g.attempt_number + 1");
    expect(sql).toContain("order by g.created_at asc, g.id asc");
    expect(sql).toContain("limit p_limit");
  });

  it("is service-role only", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/to authenticated/);
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
  it("the worker isolates a failure-scan error and keeps doing its other work", () => {
    // The scan is wrapped so a throw is caught+reported, and later recovery
    // steps still run in the same tick.
    expect(worker).toContain("recoverFailuresWithoutSuccessor");
    expect(worker).toMatch(/try\s*{[\s\S]*recoverFailuresWithoutSuccessor[\s\S]*}\s*catch/);
    const catchIdx = worker.indexOf("failureScanError = true");
    // The CALL (not the import) of a later recovery step must follow the guarded scan.
    const ratingsCallIdx = worker.indexOf("recoverStaleRatingJobs()");
    expect(catchIdx).toBeGreaterThan(-1);
    expect(ratingsCallIdx).toBeGreaterThan(catchIdx); // other work runs after the guarded scan
  });
});
