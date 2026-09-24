import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ user: vi.fn(), entitlement: vi.fn(), server: vi.fn(), admin: vi.fn(), limit: vi.fn(), fetch: vi.fn(), runner: vi.fn(), scores: vi.fn(), after: vi.fn(), today: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: m.user, createSupabaseServerClient: m.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@/lib/entitlements", () => ({ getEntitlement: m.entitlement }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/listing-monitor", () => ({ runListingMonitor: m.runner, scoreWinnerPhotos: m.scores, todayUtc: m.today }));
vi.mock("@/lib/etsy", async (original) => ({ ...await original<typeof import("@/lib/etsy")>(), fetchListingsBatch: m.fetch, isEtsyConfigured: () => true }));
import { POST as link } from "@/app/api/listings/link/route";
import { POST as settings } from "@/app/api/listings/settings/route";
import { GET as cron } from "@/app/api/listings/monitor/route";

const productId = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const listingRevision = "33333333-3333-4333-8333-333333333333";
const row = { product_id: productId, user_id: "user", etsy_listing_id: 123456, keywords: ["bunny"], revision, listing_revision: listingRevision, enabled: true, last_checked_on: null };
function db(responses: Record<string, unknown>, options: { emptyUpdate?: boolean } = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    let updated = false;
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "lte", "or", "order", "limit", "upsert", "update", "maybeSingle"]) {
      q[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === "update") updated = true;
        return q;
      });
    }
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: updated && options.emptyUpdate ? [] : responses[table] ?? null, error: null }).then(resolve);
    return q;
  });
  return { from, calls };
}
function request(body: unknown) {
  return new NextRequest("http://localhost/api/listings/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  m.today.mockReturnValue("2026-09-24");
  m.user.mockResolvedValue({ id: "user" });
  m.entitlement.mockResolvedValue({ active: true });
  m.limit.mockResolvedValue({ ok: true });
  m.server.mockResolvedValue(db({ products: { id: productId }, listing_monitors: row }));
  m.admin.mockReturnValue(db({ listing_monitors: [row] }));
  m.fetch.mockResolvedValue(new Map([[123456, { listingId: 123456, title: "Bunny", tags: ["bunny"], shopId: 1 }]]));
  m.runner.mockResolvedValue({ snapshots: 1, keywordSnapshots: 1, winnerPhotosScored: 0, errors: 0 });
  vi.stubEnv("CRON_SECRET", "test-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("listing write authorization", () => {
  it.each([link, settings])("rejects anonymous writes before any work %#", async (handler) => {
    m.user.mockResolvedValue(null);
    expect((await handler(request({ productId }))).status).toBe(401);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it.each([null, [], "bad"])("rejects valid JSON that is not an object: %s", async (body) => {
    expect((await link(request(body))).status).toBe(400);
    expect((await settings(request(body))).status).toBe(400);
  });
  it("requires an active subscription for linking or enabling", async () => {
    m.entitlement.mockResolvedValue({ active: false, reason: "past_due" });
    expect((await link(request({ productId, listing: "123456" }))).status).toBe(402);
    expect((await settings(request({ productId, enabled: true }))).status).toBe(402);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("allows an unpaid owner to stop monitoring, without Etsy or AI", async () => {
    m.entitlement.mockResolvedValue({ active: false });
    expect((await settings(request({ productId, enabled: false }))).status).toBe(200);
    expect(m.entitlement).not.toHaveBeenCalled();
    expect(m.runner).not.toHaveBeenCalled();
    expect(m.after).not.toHaveBeenCalled();
  });
  it("rejects a product not visible under caller RLS before external work", async () => {
    m.server.mockResolvedValue(db({}));
    expect((await link(request({ productId, listing: "123456" }))).status).toBe(403);
    expect((await settings(request({ productId, enabled: false }))).status).toBe(403);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("returns not-found for a missing listing rather than a provider outage", async () => {
    m.fetch.mockResolvedValue(new Map());
    expect((await link(request({ productId, listing: "123456" }))).status).toBe(404);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("starts a new history revision on keyword changes and scopes the write to its owner and old revision", async () => {
    const admin = db({ listing_monitors: [row] });
    m.admin.mockReturnValue(admin);
    expect((await settings(request({ productId, keywords: ["new phrase"] }))).status).toBe(200);
    const patch = admin.calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    expect(patch.revision).not.toBe(revision);
    expect(patch.last_checked_on).toBeNull();
    expect(admin.calls).toContainEqual({ table: "listing_monitors", method: "eq", args: ["user_id", "user"] });
    expect(admin.calls).toContainEqual({ table: "listing_monitors", method: "eq", args: ["revision", revision] });
    expect(m.runner.mock.calls[0][1][0].revision).toBe(patch.revision);
    // Keyword edits never touch the linked-listing history scope.
    expect(patch).not.toHaveProperty("listing_revision");
    expect(m.runner.mock.calls[0][1][0].listing_revision).toBe(listingRevision);
  });
  it("relinking the SAME listing with new keywords keeps its views history scope", async () => {
    const admin = db({ listing_monitors: [row] });
    m.admin.mockReturnValue(admin);
    expect((await link(request({ productId, listing: "123456", keywords: ["other phrase"] }))).status).toBe(200);
    const saved = admin.calls.find((c) => c.method === "upsert")!.args[0] as Record<string, unknown>;
    expect(saved.revision).not.toBe(revision);
    expect(saved.listing_revision).toBe(listingRevision);
  });
  it("linking a DIFFERENT listing starts a fresh views history", async () => {
    m.fetch.mockResolvedValue(new Map([[654321, { listingId: 654321, title: "Fox", tags: ["fox"], shopId: 1 }]]));
    const admin = db({ listing_monitors: [row] });
    m.admin.mockReturnValue(admin);
    expect((await link(request({ productId, listing: "654321" }))).status).toBe(200);
    const saved = admin.calls.find((c) => c.method === "upsert")!.args[0] as Record<string, unknown>;
    expect(saved.listing_revision).not.toBe(listingRevision);
    expect(m.runner.mock.calls[0][1][0].listing_revision).toBe(saved.listing_revision);
  });
  it("resuming monitoring responds without waiting for the Etsy check", async () => {
    m.admin.mockReturnValue(db({ listing_monitors: [{ ...row, enabled: false }] }));
    m.server.mockResolvedValue(db({ products: { id: productId }, listing_monitors: { ...row, enabled: false } }));
    expect((await settings(request({ productId, enabled: true }))).status).toBe(200);
    expect(m.runner).not.toHaveBeenCalled();
    expect(m.after).toHaveBeenCalledTimes(1);
  });
  it("reports concurrent configuration changes rather than false success", async () => {
    m.admin.mockReturnValue(db({}, { emptyUpdate: true }));
    expect((await settings(request({ productId, keywords: ["new phrase"] }))).status).toBe(409);
    expect(m.runner).not.toHaveBeenCalled();
  });
});

describe("daily cron boundaries", () => {
  function scheduledDatabase() {
    const rows = Array.from({ length: 15 }, (_, i) => ({ ...row, product_id: String(i).padStart(2, "0"), next_check_at: "2026-09-23T09:00:00.000Z", last_checked_on: null as string | null }));
    type Row = typeof rows[number];
    const claims: string[][] = [];
    const admin = {
      from: () => {
        const predicates: ((r: Row) => boolean)[] = [];
        const ordering: (keyof Row)[] = [];
        let patch: Partial<Row> | null = null;
        let max = Infinity;
        const q = {
          select: () => q,
          eq: (key: keyof Row, value: unknown) => { predicates.push((r) => r[key] === value); return q; },
          lte: (key: keyof Row, value: string) => { predicates.push((r) => String(r[key]) <= value); return q; },
          in: (key: keyof Row, values: unknown[]) => { predicates.push((r) => values.includes(r[key])); return q; },
          or: (expression: string) => { const day = expression.split(".lt.")[1]; predicates.push((r) => r.last_checked_on === null || r.last_checked_on < day); return q; },
          order: (key: keyof Row) => { ordering.push(key); return q; },
          limit: (n: number) => { max = n; return q; },
          update: (values: Partial<Row>) => { patch = values; return q; },
          then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
            const selected = rows.filter((r) => predicates.every((p) => p(r))).sort((a, b) => {
              for (const key of ordering) { const result = String(a[key]).localeCompare(String(b[key])); if (result) return result; }
              return 0;
            }).slice(0, max);
            if (patch) {
              claims.push(selected.map((r) => r.product_id));
              for (const r of selected) Object.assign(r, patch);
              selected.reverse(); // UPDATE RETURNING need not preserve scan order.
            }
            return Promise.resolve({ data: selected.map((r) => ({ ...r })), error: null as null }).then(resolve);
          },
        };
        return q;
      },
    };
    return { admin, rows, claims };
  }
  it("reaches every listing across daily timeouts without claiming or reprioritizing the untouched tail", async () => {
    vi.useFakeTimers();
    const state = scheduledDatabase();
    m.admin.mockReturnValue(state.admin);
    const processed: string[][] = [];
    m.runner.mockImplementation(async (_admin, chunk: typeof state.rows) => {
      const ids = chunk.map((r) => r.product_id);
      processed.push(ids);
      for (const r of state.rows) if (ids.includes(r.product_id)) r.last_checked_on = m.today();
      vi.setSystemTime(Date.now() + 240_001);
      return { snapshots: chunk.length, keywordSnapshots: 0, winnerPhotosScored: 0, errors: 0 };
    });
    for (const day of [24, 25, 26]) {
      const date = `2026-09-${day}`;
      m.today.mockReturnValue(date);
      vi.setSystemTime(new Date(`${date}T09:00:00Z`));
      expect((await cron(cronRequest("test-secret"))).status).toBe(200);
      if (day === 24) expect(state.rows.slice(5).every((r) => r.next_check_at === "2026-09-23T09:00:00.000Z")).toBe(true);
    }
    expect(processed).toEqual([
      ["00", "01", "02", "03", "04"], ["05", "06", "07", "08", "09"], ["10", "11", "12", "13", "14"],
    ]);
    expect(state.claims.every((ids) => ids.length <= 5)).toBe(true);
    expect(state.rows.every((r) => r.last_checked_on !== null)).toBe(true);
  });
  it("a failing batch also rotates behind untouched listings the next day", async () => {
    vi.useFakeTimers();
    const state = scheduledDatabase();
    m.admin.mockReturnValue(state.admin);
    const processed: string[][] = [];
    m.runner.mockImplementation(async (_admin, chunk: typeof state.rows) => {
      processed.push(chunk.map((r) => r.product_id));
      vi.setSystemTime(Date.now() + 240_001);
      throw new Error("provider unavailable");
    });
    for (const day of [24, 25]) {
      m.today.mockReturnValue(`2026-09-${day}`);
      vi.setSystemTime(new Date(`2026-09-${day}T09:00:00Z`));
      await cron(cronRequest("test-secret"));
    }
    expect(processed).toEqual([["00", "01", "02", "03", "04"], ["05", "06", "07", "08", "09"]]);
  });
  const cronRequest = (secret?: string) => new NextRequest("http://localhost/api/listings/monitor", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
  it("denies missing and invalid worker secrets", async () => {
    expect((await cron(cronRequest())).status).toBe(403);
    expect((await cron(cronRequest("wrong"))).status).toBe(403);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("leases due rows before processing them and passes a bounded deadline", async () => {
    const admin = db({ listing_monitors: [row] });
    m.admin.mockReturnValue(admin);
    expect((await cron(cronRequest("test-secret"))).status).toBe(200);
    expect(admin.calls).toContainEqual({ table: "listing_monitors", method: "limit", args: [200] });
    expect(admin.calls.filter((c) => c.method === "lte" && c.args[0] === "next_check_at")).toHaveLength(2);
    expect(m.runner).toHaveBeenCalledTimes(1);
    expect(m.runner.mock.calls[0][2]).toEqual(expect.objectContaining({ maxWinnerScores: 0, deadlineAt: expect.any(Number) }));
  });
  it("does no work when another invocation won the lease", async () => {
    m.admin.mockReturnValue(db({ listing_monitors: [row] }, { emptyUpdate: true }));
    await cron(cronRequest("test-secret"));
    expect(m.runner).not.toHaveBeenCalled();
  });
  it("does not monitor unpaid accounts", async () => {
    m.entitlement.mockResolvedValue({ active: false });
    await cron(cronRequest("test-secret"));
    expect(m.runner).not.toHaveBeenCalled();
    expect(m.scores).not.toHaveBeenCalled();
  });
});
