import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ user: vi.fn(), server: vi.fn(), admin: vi.fn(), limit: vi.fn(), lease: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: m.user, createSupabaseServerClient: m.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit, acquireLease: m.lease }));
vi.mock("@/lib/listing-monitor", () => ({ todayUtc: () => "2026-09-26" }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logEvent: vi.fn() }));
import { POST } from "@/app/api/shop/listing-pref/route";

function db(row: unknown) {
  const updates: unknown[] = [];
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "contains", "maybeSingle"]) q[k] = vi.fn(() => q);
  q.update = vi.fn((u: unknown) => { updates.push(u); return q; });
  q.then = (r: (x: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(r);
  return { from: vi.fn(() => q), updates };
}
const req = (body: unknown) => new NextRequest("http://x/api/shop/listing-pref", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "u" });
  m.limit.mockResolvedValue({ ok: true });
  m.lease.mockResolvedValue(m.release);
});

describe("POST /api/shop/listing-pref", () => {
  it("only acts on listings in the caller's own shop", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1], fix_dismissed: {}, protected_listing_ids: [] }));
    m.admin.mockReturnValue(db(null));
    expect((await POST(req({ listingId: 99, action: "protect" }))).status).toBe(403);
  });
  it("'Not now' hides for 30 days and drops expired entries", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1, 2], fix_dismissed: { "2": "2026-09-01" }, protected_listing_ids: [] }));
    const admin = db({ user_id: "u" });
    m.admin.mockReturnValue(admin);
    expect((await POST(req({ listingId: 1, action: "dismiss" }))).status).toBe(200);
    expect(admin.updates[0]).toMatchObject({ fix_dismissed: { "1": "2026-10-26" }, protected_listing_ids: [] });
  });
  it("protect and unprotect toggle the listing", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1], fix_dismissed: {}, protected_listing_ids: ["1"] }));
    const admin = db({ user_id: "u" });
    m.admin.mockReturnValue(admin);
    await POST(req({ listingId: 1, action: "unprotect" }));
    expect(admin.updates[0]).toMatchObject({ protected_listing_ids: [] });
  });
  it("rejects unknown actions", async () => {
    expect((await POST(req({ listingId: 1, action: "delete" }))).status).toBe(400);
  });
  it("serializes overlapping preferences and preserves both after retry", async () => {
    const state: Record<string, unknown> = { user_id: "u", etsy_shop_id: 7, current_listing_ids: [1, 2], fix_dismissed: {}, protected_listing_ids: [] };
    let held = false;
    m.lease.mockImplementation(async () => {
      if (held) return null;
      held = true;
      return async () => { held = false; };
    });
    const client = {
      from: () => {
        let patch: Record<string, unknown> | null = null;
        const filters: [string, unknown][] = [];
        const q = {
          select: () => q, maybeSingle: () => q,
          contains: () => q,
          eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
          update: (p: Record<string, unknown>) => { patch = p; return q; },
          then: (resolve: (r: unknown) => unknown) => {
            if (!patch) return Promise.resolve({ data: structuredClone(state), error: null }).then(resolve);
            const matches = filters.every(([k, v]) => {
              const actual = k === "fix_dismissed" ? JSON.stringify(state[k]) : Array.isArray(state[k]) ? `{${state[k].join(",")}}` : state[k];
              return actual === v;
            });
            if (matches) Object.assign(state, patch);
            return Promise.resolve({ data: matches ? { user_id: "u" } : null, error: null }).then(resolve);
          },
        };
        return q;
      },
    };
    m.server.mockResolvedValue(client);
    m.admin.mockReturnValue(client);
    const responses = await Promise.all([POST(req({ listingId: 1, action: "dismiss" })), POST(req({ listingId: 2, action: "protect" }))]);
    expect(responses.map(r => r.status)).toEqual([200, 429]);
    expect((await POST(req({ listingId: 2, action: "protect" }))).status).toBe(200);
    expect(state.fix_dismissed).toEqual({ "1": "2026-10-26" });
    expect(state.protected_listing_ids).toEqual([2]);
  });
  it("does not report success if a switched shop no longer matches the write", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1], fix_dismissed: {}, protected_listing_ids: [] }));
    const admin = db(null);
    m.admin.mockReturnValue(admin);
    expect((await POST(req({ listingId: 1, action: "protect" }))).status).toBe(500);
    expect(admin.updates).toHaveLength(1);
    expect(m.release).toHaveBeenCalledOnce();
  });
});
