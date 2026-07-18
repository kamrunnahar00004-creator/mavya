import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDashboardOverview } from "@/lib/dashboard-overview";

type Result = { data: unknown; error?: unknown };

/**
 * Minimal thenable query builder: every filter/order call chains; awaiting
 * resolves to a `{ data, error }` result (returned error) or rejects (thrown
 * exception), matching both supabase-js failure modes.
 */
function tableBuilder(result: Result | (() => never)) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "in", "eq", "limit"]) {
    b[m] = () => b;
  }
  b.then = (
    onFulfilled: (v: Result) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => {
    const p =
      typeof result === "function"
        ? Promise.reject(new Error("thrown table failure"))
        : Promise.resolve(result);
    return p.then(onFulfilled, onRejected);
  };
  return b;
}

function makeClient(opts: {
  rpc: Result | (() => Promise<Result>);
  tables?: Record<string, Result>;
}) {
  const fromCalls: string[] = [];
  const client = {
    rpc: () =>
      typeof opts.rpc === "function" ? opts.rpc() : Promise.resolve(opts.rpc),
    from: (table: string) => {
      fromCalls.push(table);
      return tableBuilder(opts.tables?.[table] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, fromCalls };
}

const legacyTables: Record<string, Result> = {
  products: {
    data: [
      {
        id: "p1",
        name: null,
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
        photos: [
          {
            id: "ph1",
            role: "main",
            storage_path: "user/p1/ph1.jpg",
            created_at: "2026-01-01T00:00:01Z",
            audits: [
              {
                id: "a1",
                overall_score: 6.5,
                rubric: { priority_action: "  Fix the lighting  " },
                created_at: "2026-01-01T00:01:00Z",
              },
            ],
          },
        ],
      },
      {
        id: "p2",
        name: "Strong listing",
        position: 1,
        created_at: "2026-01-02T00:00:00Z",
        photos: [
          {
            id: "ph2",
            role: "main",
            storage_path: "user/p2/ph2.jpg",
            created_at: "2026-01-02T00:00:01Z",
            audits: [
              {
                id: "a2",
                overall_score: 8.2,
                rubric: { priority_action: "Should never surface" },
                created_at: "2026-01-02T00:01:00Z",
              },
            ],
          },
        ],
      },
    ],
    error: null,
  },
  rating_jobs: {
    data: [
      {
        id: "rj1",
        photo_id: "ph1",
        status: "completed",
        error_message: null,
        created_at: "2026-01-01T00:00:30Z",
      },
    ],
    error: null,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadDashboardOverview", () => {
  it("uses ONLY the RPC data on success — the legacy path never runs", async () => {
    const rpcRow = {
      product_id: "p1",
      product_name: "RPC row",
      product_position: 0,
      product_created_at: "2026-01-01T00:00:00Z",
      photo_id: "ph1",
      storage_path: "user/p1/ph1.jpg",
      score: 7.1,
      priority_action: "Brighten the photo",
      rating_job_id: "rj1",
      rating_status: "completed",
      rating_error: null,
    };
    const { client, fromCalls } = makeClient({ rpc: { data: [rpcRow], error: null } });

    const rows = await loadDashboardOverview(client);

    expect(rows).toEqual([rpcRow]);
    expect(fromCalls).toEqual([]); // no legacy queries on success
  });

  it("a returned RPC error never renders a fake empty dashboard — legacy fallback hydrates rows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, fromCalls } = makeClient({
      rpc: { data: null, error: { message: "function does not exist" } },
      tables: legacyTables,
    });

    const rows = await loadDashboardOverview(client);

    // The seller's products are still there — NOT [].
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      product_id: "p1",
      photo_id: "ph1",
      storage_path: "user/p1/ph1.jpg",
      score: 6.5,
      priority_action: "Fix the lighting", // trimmed, surfaced below 8
      rating_job_id: "rj1",
      rating_status: "completed",
      rating_error: null,
    });
    // RPC card rule mirrored: no priority action at/above 8.
    expect(rows[1]).toMatchObject({
      product_id: "p2",
      score: 8.2,
      priority_action: null,
      rating_status: null,
    });
    expect(fromCalls).toContain("products");
    expect(fromCalls).toContain("rating_jobs");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("a THROWN RPC exception (network failure) also runs the legacy fallback", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, fromCalls } = makeClient({
      rpc: async () => {
        throw new Error("fetch failed: db-host-secret.supabase.co");
      },
      tables: legacyTables,
    });

    const rows = await loadDashboardOverview(client);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ product_id: "p1", score: 6.5 });
    expect(fromCalls).toContain("products");
    // Log stays static: no exception message, host, or details leak.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(JSON.parse(logged)).toEqual({ event: "dashboard.rpc_failed" });
    expect(logged).not.toContain("fetch failed");
    expect(logged).not.toContain("db-host-secret");
  });

  it("logs only a static failure event — no database error details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      rpc: { data: null, error: { message: "secret db detail 42", code: "PGRST202" } },
      tables: legacyTables,
    });

    await loadDashboardOverview(client);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(JSON.parse(logged)).toEqual({ event: "dashboard.rpc_failed" });
    expect(logged).not.toContain("secret db detail");
    expect(logged).not.toContain("PGRST202");
  });

  it("treats null RPC data without an error as a failure, not an empty dashboard", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      rpc: { data: null, error: null },
      tables: legacyTables,
    });

    const rows = await loadDashboardOverview(client);
    expect(rows).toHaveLength(2);
  });

  it("a failed legacy products query rejects with a safe error — never returns []", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      rpc: { data: null, error: { message: "rpc down" } },
      tables: {
        products: {
          data: null,
          error: { message: "connection refused to internal-db:5432" },
        },
      },
    });

    await expect(loadDashboardOverview(client)).rejects.toThrow(
      "dashboard_hydration_failed"
    );
    // The thrown error is static: no database details ride along.
    await loadDashboardOverview(client).catch((e: Error) => {
      expect(e.message).toBe("dashboard_hydration_failed");
      expect(e.message).not.toContain("connection refused");
    });
  });

  it("a failed legacy rating query rejects — rating states are never silently dropped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      rpc: { data: null, error: { message: "rpc down" } },
      tables: {
        products: legacyTables.products,
        rating_jobs: {
          data: null,
          error: { message: "permission denied for table rating_jobs" },
        },
      },
    });

    await expect(loadDashboardOverview(client)).rejects.toThrow(
      "dashboard_hydration_failed"
    );
  });
});
