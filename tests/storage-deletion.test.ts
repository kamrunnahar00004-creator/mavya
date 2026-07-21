import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/errors", () => ({
  logEvent: vi.fn(),
  apiError: vi.fn(),
}));

import { drainStorageCleanup } from "@/lib/storage-cleanup";
import { commitCompletedUpload } from "@/lib/refinement";

const read = (p: string) => readFileSync(path.resolve(p), "utf8");

// ---------------------------------------------------------------------------
// A fake private bucket that models the real nested layout so prefix cleanup is
// exercised for real: files live under `${user}/${product}/...` and
// `${user}/${product}/generated/...`. remove() mutates the store; list()
// paginates and reports folders (id === null) vs files.
// ---------------------------------------------------------------------------
function fakeBucket(initial: string[], opts?: { removeErrorFor?: Set<string> }) {
  const files = new Set(initial);
  const listOffsets: number[] = [];
  const removeCalls: string[][] = [];
  const bucket = {
    list: async (prefix: string, args: { limit: number; offset: number }) => {
      listOffsets.push(args.offset);
      const children = new Map<string, boolean>(); // name -> isFile
      const base = prefix ? `${prefix}/` : "";
      for (const f of files) {
        if (!f.startsWith(base)) continue;
        const rest = f.slice(base.length);
        const seg = rest.split("/")[0];
        const isFile = rest === seg;
        children.set(seg, (children.get(seg) ?? true) && isFile);
      }
      const arr = [...children.entries()]
        .sort()
        .map(([name, isFile]) => ({ name, id: isFile ? "obj-id" : null }));
      return { data: arr.slice(args.offset, args.offset + args.limit), error: null };
    },
    remove: async (paths: string[]) => {
      removeCalls.push(paths);
      for (const p of paths) {
        if (opts?.removeErrorFor?.has(p)) return { error: { message: "boom" } };
        files.delete(p);
      }
      return { error: null };
    },
    upload: async () => ({ error: null }),
  };
  return { bucket, files, listOffsets, removeCalls };
}

function makeAdmin(
  claimRows: unknown[],
  bucket: ReturnType<typeof fakeBucket>["bucket"],
  opts?: { completeReturns?: boolean }
) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "claim_storage_cleanup") return { data: claimRows, error: null };
      if (name === "complete_storage_cleanup")
        return { data: opts?.completeReturns ?? true, error: null };
      return { data: null, error: null };
    },
    storage: { from: () => bucket },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, rpcCalls };
}

beforeEach(() => vi.clearAllMocks());

describe("drainStorageCleanup", () => {
  it("removes an object row and completes it (row deleted) on success", async () => {
    const fb = fakeBucket(["u1/p1/ph1.jpg"]);
    const { admin, rpcCalls } = makeAdmin(
      [{ id: "q1", user_id: "u1", kind: "object", storage_path: "u1/p1/ph1.jpg", attempts: 0, lease_token: "t1" }],
      fb.bucket
    );
    const cleaned = await drainStorageCleanup(admin);
    expect(cleaned).toBe(1);
    expect(fb.files.has("u1/p1/ph1.jpg")).toBe(false);
    expect(rpcCalls.some((c) => c.name === "complete_storage_cleanup")).toBe(true);
    expect(rpcCalls.some((c) => c.name === "fail_storage_cleanup")).toBe(false);
  });

  it("RETAINS a row when storage removal fails (fail, not complete)", async () => {
    const fb = fakeBucket(["u1/p1/ph1.jpg"], {
      removeErrorFor: new Set(["u1/p1/ph1.jpg"]),
    });
    const { admin, rpcCalls } = makeAdmin(
      [{ id: "q1", user_id: "u1", kind: "object", storage_path: "u1/p1/ph1.jpg", attempts: 0, lease_token: "t1" }],
      fb.bucket
    );
    const cleaned = await drainStorageCleanup(admin);
    expect(cleaned).toBe(0);
    const failCall = rpcCalls.find((c) => c.name === "fail_storage_cleanup");
    expect(failCall).toBeTruthy();
    // Non-zero attempt cap => the row is retried, not discarded.
    expect(failCall!.args.p_max_attempts).toBeGreaterThan(0);
    expect(rpcCalls.some((c) => c.name === "complete_storage_cleanup")).toBe(false);
  });

  it("recursively empties a prefix, paginating every list(), then completes", async () => {
    // 150 originals + nested generated results under one product prefix.
    const initial: string[] = [];
    for (let i = 0; i < 150; i++) initial.push(`u1/p1/orig${i}.jpg`);
    for (let i = 0; i < 30; i++) initial.push(`u1/p1/generated/gen${i}.png`);
    const fb = fakeBucket(initial);
    const { admin, rpcCalls } = makeAdmin(
      [{ id: "q1", user_id: "u1", kind: "prefix", storage_path: "u1/p1/", attempts: 0, lease_token: "t1" }],
      fb.bucket
    );
    const cleaned = await drainStorageCleanup(admin);
    expect(cleaned).toBe(1);
    // Nothing left under the prefix.
    expect([...fb.files].some((f) => f.startsWith("u1/p1/"))).toBe(false);
    // Pagination actually happened (an offset beyond the first page was used).
    expect(Math.max(...fb.listOffsets)).toBeGreaterThanOrEqual(100);
    expect(rpcCalls.some((c) => c.name === "complete_storage_cleanup")).toBe(true);
  });

  it("a prefix that cannot be emptied is retried, never completed", async () => {
    const fb = fakeBucket(["u1/p1/stuck.jpg"], {
      removeErrorFor: new Set(["u1/p1/stuck.jpg"]),
    });
    const { admin, rpcCalls } = makeAdmin(
      [{ id: "q1", user_id: "u1", kind: "prefix", storage_path: "u1/p1/", attempts: 0, lease_token: "t1" }],
      fb.bucket
    );
    const cleaned = await drainStorageCleanup(admin);
    expect(cleaned).toBe(0);
    expect(rpcCalls.some((c) => c.name === "fail_storage_cleanup")).toBe(true);
    expect(rpcCalls.some((c) => c.name === "complete_storage_cleanup")).toBe(false);
  });

  it("never removes a path outside the row owner's folder", async () => {
    const fb = fakeBucket(["otheruser/p1/secret.jpg"]);
    const { admin, rpcCalls } = makeAdmin(
      [{ id: "q1", user_id: "u1", kind: "object", storage_path: "otheruser/p1/secret.jpg", attempts: 0, lease_token: "t1" }],
      fb.bucket
    );
    const cleaned = await drainStorageCleanup(admin);
    expect(cleaned).toBe(0);
    expect(fb.removeCalls).toHaveLength(0); // storage never touched
    const failCall = rpcCalls.find((c) => c.name === "fail_storage_cleanup");
    expect(failCall!.args.p_max_attempts).toBe(0); // straight to dead-letter
  });

  it("does NOT count a row when complete returns false (lease was taken over)", async () => {
    const fb = fakeBucket(["u1/p1/ph1.jpg"]);
    const { admin, rpcCalls } = makeAdmin(
      [{ id: "q1", user_id: "u1", kind: "object", storage_path: "u1/p1/ph1.jpg", attempts: 0, lease_token: "stale" }],
      fb.bucket,
      { completeReturns: false }
    );
    const cleaned = await drainStorageCleanup(admin);
    // The file was removed, but another drainer owns the row now: do not count,
    // and do not fail it (the lease owner will complete it).
    expect(cleaned).toBe(0);
    expect(rpcCalls.some((c) => c.name === "fail_storage_cleanup")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Worker generation-race: a completed upload must not orphan a file when the
// product/photo is deleted mid-generation.
// ---------------------------------------------------------------------------
function makeUploadAdmin(opts: {
  preStatus?: string | null;
  preError?: unknown;
  completionRow?: { id: string } | null;
  completionError?: unknown;
  uploadError?: unknown;
  removeError?: unknown;
}) {
  const removed: string[][] = [];
  const uploaded: string[] = [];
  const enqueued: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let op: "select" | "update" | "insert" | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => (op ?? (op = "select"), b);
    b.update = () => ((op = "update"), b);
    b.insert = (row: Record<string, unknown>) => (
      (op = "insert"), enqueued.push({ table, ...row }), b
    );
    b.eq = () => b;
    b.in = () => b;
    b.maybeSingle = async () => {
      if (op === "select")
        return {
          data: opts.preStatus ? { status: opts.preStatus } : null,
          error: opts.preError ?? null,
        };
      if (op === "update")
        return { data: opts.completionRow ?? null, error: opts.completionError ?? null };
      return { data: null, error: null };
    };
    // The insert (self-clean enqueue) is awaited directly.
    b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(onF, onR);
    return b;
  };
  const storage = {
    from: () => ({
      upload: async (p: string) => (uploaded.push(p), { error: opts.uploadError ?? null }),
      remove: async (paths: string[]) => (
        removed.push(paths), { error: opts.removeError ?? null }
      ),
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from, storage } as any, removed, uploaded, enqueued };
}

describe("commitCompletedUpload (generation-race protection)", () => {
  const base = {
    jobId: "j1",
    userId: "u1",
    resultPath: "u1/p1/generated/j1.png",
    imageBase64: "AAAA",
    completionFields: { candidate_rubric: {} },
  };

  it("normal completion: uploads and marks completed, no self-clean", async () => {
    const { admin, removed, uploaded } = makeUploadAdmin({
      preStatus: "rescoring",
      completionRow: { id: "j1" },
    });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: true });
    expect(uploaded).toEqual(["u1/p1/generated/j1.png"]);
    expect(removed).toHaveLength(0);
  });

  it("a pre-check DB error is a persistence failure, not a deletion", async () => {
    const { admin, uploaded } = makeUploadAdmin({
      preError: { message: "db down", code: "08006" },
    });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: false, reason: "upload_failed" });
    expect(uploaded).toHaveLength(0); // never uploaded on a DB error
  });

  it("deleted BEFORE upload: pre-check aborts, nothing uploaded", async () => {
    const { admin, removed, uploaded } = makeUploadAdmin({ preStatus: null });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: false, reason: "deleted" });
    expect(uploaded).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it("deleted DURING upload: 0-row completion self-cleans the uploaded file", async () => {
    const { admin, removed, uploaded } = makeUploadAdmin({
      preStatus: "rescoring",
      completionRow: null, // cascade-deleted between pre-check and completion
    });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: false, reason: "deleted" });
    expect(uploaded).toEqual(["u1/p1/generated/j1.png"]);
    expect(removed).toEqual([["u1/p1/generated/j1.png"]]); // orphan removed
  });

  it("a completion-update DB error is a persistence failure and still cleans the file", async () => {
    const { admin, removed } = makeUploadAdmin({
      preStatus: "rescoring",
      completionError: { message: "db down", code: "08006" },
    });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: false, reason: "upload_failed" });
    expect(removed).toEqual([["u1/p1/generated/j1.png"]]);
  });

  it("late-upload race: when self-clean removal fails, the path is durably enqueued", async () => {
    const { admin, enqueued } = makeUploadAdmin({
      preStatus: "rescoring",
      completionRow: null, // deleted mid-flight
      removeError: { message: "storage flaky" },
    });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: false, reason: "deleted" });
    // The exact generated path is enqueued to the outbox for a later drain.
    expect(enqueued).toEqual([
      { table: "storage_cleanup_queue", user_id: "u1", kind: "object", storage_path: "u1/p1/generated/j1.png" },
    ]);
  });

  it("upload failure is reported distinctly (not a deletion), no self-clean", async () => {
    const { admin, removed } = makeUploadAdmin({
      preStatus: "rescoring",
      uploadError: { message: "network" },
    });
    const res = await commitCompletedUpload({ admin, ...base });
    expect(res).toEqual({ ok: false, reason: "upload_failed" });
    expect(removed).toHaveLength(0);
  });
});

describe("0018 storage deletion migration structure", () => {
  const sql = read("supabase/migrations/0018_storage_deletion.sql");

  it("outbox is service-role only: RLS on, no browser policies", () => {
    expect(sql).toContain("create table if not exists public.storage_cleanup_queue");
    expect(sql).toContain("alter table public.storage_cleanup_queue enable row level security");
    expect(sql).not.toMatch(/create policy[^\n]+storage_cleanup_queue/);
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/storage_cleanup[\s\S]*to authenticated/);
  });

  it("claim RPC leases atomically with skip-locked and recovers expired leases", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("leased_until");
    expect(sql).toContain("status = 'claimed'");
    expect(sql).toContain("leased_until < now()");
  });

  it("product deletion enqueues originals, result paths, deterministic paths, and a prefix sweep", () => {
    expect(sql).toContain("request_product_deletion");
    expect(sql).toContain("/generated/' || id::text || '.png'");
    expect(sql).toContain("'prefix'");
    expect(sql).toContain("raise exception 'not_owner'");
  });

  it("photo deletion enqueues that photo's paths but NO prefix sweep", () => {
    const photoFn = sql.slice(
      sql.indexOf("request_photo_deletion"),
      sql.indexOf("claim_storage_cleanup")
    );
    expect(photoFn).toContain("/generated/' || id::text || '.png'");
    expect(photoFn).not.toContain("'prefix'");
  });

  it("failures retain the row and dead-letter past a cap (never deleted)", () => {
    expect(sql).toContain("fail_storage_cleanup");
    expect(sql).toContain("status = case when attempts + 1 >= p_max_attempts then 'failed'");
    // complete (the ONLY delete) is gated on the lease token.
    expect(sql).toContain("delete from public.storage_cleanup_queue");
    expect(sql).toContain("id = p_id and lease_token = p_token");
  });

  it("complete returns a boolean reporting whether the leased row was deleted", () => {
    const fn = sql.slice(
      sql.indexOf("function public.complete_storage_cleanup"),
      sql.indexOf("fail_storage_cleanup")
    );
    expect(fn).toContain("returns boolean");
    expect(fn).toContain("get diagnostics");
    expect(fn).toContain("return v_deleted > 0");
  });
});

describe("delete endpoints are server-authoritative (IDs only)", () => {
  const product = read("src/app/api/products/delete/route.ts");
  const photo = read("src/app/api/photos/delete/route.ts");

  it("accept only an id, never a client storage path", () => {
    expect(product).toContain("body.productId");
    expect(product).not.toMatch(/body\.(path|storagePath|storage_path)/);
    expect(photo).toContain("body.photoId");
    expect(photo).not.toMatch(/body\.(path|storagePath|storage_path)/);
  });

  it("verify ownership then call the service-role RPC", () => {
    expect(product).toContain('.from("products")');
    expect(product).toContain('request_product_deletion');
    expect(photo).toContain('.from("photos")');
    expect(photo).toContain('request_photo_deletion');
  });
});
