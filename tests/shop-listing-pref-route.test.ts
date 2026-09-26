import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ user: vi.fn(), server: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: m.user, createSupabaseServerClient: m.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/listing-monitor", () => ({ todayUtc: () => "2026-09-26" }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logEvent: vi.fn() }));
import { POST } from "@/app/api/shop/listing-pref/route";

function db(row: unknown) {
  const updates: unknown[] = [];
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "maybeSingle"]) q[k] = vi.fn(() => q);
  q.update = vi.fn((u: unknown) => { updates.push(u); return q; });
  q.then = (r: (x: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(r);
  return { from: vi.fn(() => q), updates };
}
const req = (body: unknown) => new NextRequest("http://x/api/shop/listing-pref", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "u" });
  m.limit.mockResolvedValue({ ok: true });
});

describe("POST /api/shop/listing-pref", () => {
  it("only acts on listings in the caller's own shop", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1], fix_dismissed: {}, protected_listing_ids: [] }));
    m.admin.mockReturnValue(db(null));
    expect((await POST(req({ listingId: 99, action: "protect" }))).status).toBe(403);
  });
  it("'Not now' hides for 30 days and drops expired entries", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1, 2], fix_dismissed: { "2": "2026-09-01" }, protected_listing_ids: [] }));
    const admin = db(null);
    m.admin.mockReturnValue(admin);
    expect((await POST(req({ listingId: 1, action: "dismiss" }))).status).toBe(200);
    expect(admin.updates[0]).toMatchObject({ fix_dismissed: { "1": "2026-10-26" }, protected_listing_ids: [] });
  });
  it("protect and unprotect toggle the listing", async () => {
    m.server.mockResolvedValue(db({ etsy_shop_id: 7, current_listing_ids: [1], fix_dismissed: {}, protected_listing_ids: ["1"] }));
    const admin = db(null);
    m.admin.mockReturnValue(admin);
    await POST(req({ listingId: 1, action: "unprotect" }));
    expect(admin.updates[0]).toMatchObject({ protected_listing_ids: [] });
  });
  it("rejects unknown actions", async () => {
    expect((await POST(req({ listingId: 1, action: "delete" }))).status).toBe(400);
  });
});
