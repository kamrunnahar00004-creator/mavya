import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

const m = vi.hoisted(() => ({
  user: vi.fn(), entitlement: vi.fn(), limit: vi.fn(), server: vi.fn(), admin: vi.fn(),
  findShop: vi.fn(), runShop: vi.fn(), batch: vi.fn(), image: vi.fn(), persist: vi.fn(), kick: vi.fn(),
  runListing: vi.fn(), ideas: vi.fn(), disabled: vi.fn(), after: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: m.user, createSupabaseServerClient: m.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@/lib/entitlements", () => ({ getEntitlement: m.entitlement }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/usage", () => ({ aiDisabled: m.disabled }));
vi.mock("@/lib/shop-monitor", () => ({ runShopMonitor: m.runShop }));
vi.mock("@/lib/photo-persistence", () => ({ persistPhotoAndQueueRating: m.persist, kickRatingWorker: m.kick }));
vi.mock("@/lib/listing-monitor", () => ({ runListingMonitor: m.runListing, todayUtc: () => "2026-09-25" }));
vi.mock("@/lib/keyword-finder-server", () => ({ findKeywordIdeas: m.ideas }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logEvent: vi.fn() }));
vi.mock("@/lib/etsy", async (orig) => ({
  ...(await orig<typeof import("@/lib/etsy")>()),
  isEtsyConfigured: () => true,
  fetchShopByName: m.findShop,
  fetchListingsBatch: m.batch,
  fetchEtsyImage: m.image,
}));
import { POST as connect } from "@/app/api/shop/connect/route";
import { POST as open } from "@/app/api/shop/open/route";
import { POST as keywords } from "@/app/api/listings/keywords/route";

/** Chainable query mock: `responses[table]` is what every query on that table resolves to. */
function db(responses: Record<string, unknown>, errors: Record<string, string> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order", "upsert", "update", "lte", "or", "in", "maybeSingle"]) {
      q[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return q;
      });
    }
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: responses[table] ?? null, error: errors[table] ? { message: errors[table] } : null }).then(resolve);
    return q;
  });
  return { from, calls };
}
const req = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "u" });
  m.entitlement.mockResolvedValue({ active: true, activeListingLimit: 100 });
  m.limit.mockResolvedValue({ ok: true });
  m.disabled.mockReturnValue(false);
  m.server.mockResolvedValue(db({}));
  m.admin.mockReturnValue(db({}));
});

describe("POST /api/shop/connect", () => {
  it("requires login and a paid plan before touching Etsy", async () => {
    m.user.mockResolvedValue(null);
    expect((await connect(req("http://x/api/shop/connect", { shop: "Abc" }))).status).toBe(401);
    m.user.mockResolvedValue({ id: "u" });
    m.entitlement.mockResolvedValue({ active: false, reason: "no_subscription" });
    expect((await connect(req("http://x/api/shop/connect", { shop: "Abc" }))).status).toBe(402);
    expect(m.findShop).not.toHaveBeenCalled();
  });
  it("rejects input that is not a shop name or shop link", async () => {
    expect((await connect(req("http://x/api/shop/connect", { shop: "https://evil.com/shop/Abc" }))).status).toBe(400);
    expect(m.findShop).not.toHaveBeenCalled();
  });
  it("says not found for an unknown shop", async () => {
    m.findShop.mockResolvedValue(null);
    expect((await connect(req("http://x/api/shop/connect", { shop: "NoSuchShop" }))).status).toBe(404);
  });
  it("saves the shop for this user and runs the first check with the plan's listing limit", async () => {
    m.findShop.mockResolvedValue({ shopId: 7, shopName: "Abc", activeListings: 80 });
    m.runShop.mockResolvedValue({ listings: 80 });
    const admin = db({});
    m.admin.mockReturnValue(admin);
    const res = await connect(req("http://x/api/shop/connect", { shop: "etsy.com/shop/Abc" }));
    expect(res.status).toBe(200);
    const saved = admin.calls.find((c) => c.table === "shop_monitors" && c.method === "upsert")!.args[0] as Record<string, unknown>;
    expect(saved).toMatchObject({ user_id: "u", etsy_shop_id: 7, shop_name: "Abc" });
    expect(m.runShop.mock.calls[0][2]).toBe(100);
  });
});

describe("POST /api/shop/open", () => {
  it("rejects a historical listing from a previously connected shop", async () => {
    m.server.mockResolvedValue(db({ shop_monitors: { etsy_shop_id: 8, current_listing_ids: [456] }, shop_listing_snapshots: { listing_id: 123 } }));
    expect((await open(req("http://x/api/shop/open", { listingId: 123 }))).status).toBe(403);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it("reports a recoverable link failure after saving the imported photo", async () => {
    m.server.mockResolvedValue(db({ shop_monitors: { etsy_shop_id: 7, current_listing_ids: [123] }, shop_listing_snapshots: { listing_id: 123 } }));
    m.admin.mockReturnValue(db({}, { listing_monitors: "write unavailable" }));
    m.batch.mockResolvedValue(new Map([[123, { listingId: 123, shopId: 7, title: "Soy candle", tags: [], images: [{ urlFull: "https://i.etsystatic.com/main.jpg" }] }]]));
    m.image.mockResolvedValue({ buffer: await sharp({ create: { width: 200, height: 200, channels: 3, background: "white" } }).jpeg().toBuffer() });
    m.persist.mockResolvedValue({ ok: true, productId: "p", jobId: "j", photoId: "f", status: "queued" });
    const response = await open(req("http://x/api/shop/open", { listingId: 123 }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "persistence_failed", error: expect.stringContaining("Open this listing again") });
    expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "u:etsy-import:123:main" }));
  });
  it("only opens listings in the caller's own tracked shop", async () => {
    m.server.mockResolvedValue(db({ shop_listing_snapshots: null }));
    expect((await open(req("http://x/api/shop/open", { listingId: 123 }))).status).toBe(403);
    expect(m.batch).not.toHaveBeenCalled();
    expect(m.persist).not.toHaveBeenCalled();
  });
  it("returns the existing product without importing again", async () => {
    m.server.mockResolvedValue(db({ shop_monitors: { etsy_shop_id: 7, current_listing_ids: [123] }, shop_listing_snapshots: { listing_id: 123 }, listing_monitors: { product_id: "p1" } }));
    const res = await open(req("http://x/api/shop/open", { listingId: 123 }));
    expect(await res.json()).toMatchObject({ ok: true, productId: "p1", created: false });
    expect(m.persist).not.toHaveBeenCalled();
  });
  it("rejects a non-numeric listing id", async () => {
    expect((await open(req("http://x/api/shop/open", { listingId: "123" }))).status).toBe(400);
  });
  it("honors the AI kill switch before importing (import costs one photo score)", async () => {
    m.server.mockResolvedValue(db({ shop_monitors: { etsy_shop_id: 7, current_listing_ids: [123] }, shop_listing_snapshots: { listing_id: 123 } }));
    m.disabled.mockReturnValue(true);
    expect((await open(req("http://x/api/shop/open", { listingId: 123 }))).status).toBe(503);
    expect(m.persist).not.toHaveBeenCalled();
  });
});

describe("POST /api/listings/keywords", () => {
  const productId = "11111111-1111-4111-8111-111111111111";
  it("is paid-only and owner-only", async () => {
    m.entitlement.mockResolvedValue({ active: false, reason: "no_subscription" });
    expect((await keywords(req("http://x/api/listings/keywords", { productId }))).status).toBe(402);
    m.entitlement.mockResolvedValue({ active: true, activeListingLimit: 100 });
    m.server.mockResolvedValue(db({ listing_monitors: null }));
    expect((await keywords(req("http://x/api/listings/keywords", { productId }))).status).toBe(403);
    expect(m.ideas).not.toHaveBeenCalled();
  });
  it("returns labeled ideas for the owner's linked listing", async () => {
    m.server.mockResolvedValue(db({ listing_monitors: { etsy_listing_id: 5, keywords: ["soy candle"], listing_revision: "r" }, listing_snapshots: { title: "Soy candle", tags: [] } }));
    m.ideas.mockResolvedValue([{ keyword: "soy candle", label: "winning" }]);
    const res = await keywords(req("http://x/api/listings/keywords", { productId }));
    expect(res.status).toBe(200);
    expect(m.ideas.mock.calls[0][1]).toMatchObject({ listingId: 5, title: "Soy candle" });
    expect(m.ideas.mock.calls[0][2]).toBe("soy candle");
  });
});
