import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ user: vi.fn(), entitlement: vi.fn(), limit: vi.fn(), disabled: vi.fn(), budget: vi.fn(), ctx: vi.fn(), call: vi.fn(), server: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: m.user, createSupabaseServerClient: m.server }));
vi.mock("@/lib/entitlements", () => ({ getEntitlement: m.entitlement }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/usage", () => ({ aiDisabled: m.disabled, withinGlobalBudget: m.budget }));
vi.mock("@/lib/listing-writer-context", () => ({ loadWriterContext: m.ctx }));
vi.mock("@/lib/openai", () => ({ writerCall: m.call }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logEvent: vi.fn() }));
import { POST } from "@/app/api/listings/write/route";

const productId = "11111111-1111-4111-8111-111111111111";
const req = (body: unknown) => new NextRequest("http://localhost/api/listings/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { current: { title: "Soy candle", tags: ["soy candle"], description: "A candle." }, photo: { productSummary: null, category: null }, keywords: [], winnerTags: [], isDigital: false, facts: {} };
const good = JSON.stringify({
  titles: ["Soy Candle, Lavender Scented Jar Candle", "Lavender Soy Candle in a Glass Jar"],
  tags: ["soy candle", "lavender candle", "jar candle", "scented candle", "gift candle", "relaxing gift"],
  description: "A lavender soy candle in a glass jar.\n\n- Size: [add size]",
});

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "u" });
  m.entitlement.mockResolvedValue({ active: true });
  m.limit.mockResolvedValue({ ok: true });
  m.disabled.mockReturnValue(false);
  m.budget.mockResolvedValue(true);
  m.ctx.mockResolvedValue(ctx);
  m.call.mockResolvedValue(good);
  m.server.mockResolvedValue({});
});

describe("POST /api/listings/write", () => {
  it("requires login", async () => {
    m.user.mockResolvedValue(null);
    expect((await POST(req({ productId }))).status).toBe(401);
    expect(m.call).not.toHaveBeenCalled();
  });
  it("is paid-only", async () => {
    m.entitlement.mockResolvedValue({ active: false, reason: "no_subscription" });
    expect((await POST(req({ productId }))).status).toBe(402);
    expect(m.call).not.toHaveBeenCalled();
  });
  it("honors the AI kill switch and the global budget before calling the model", async () => {
    m.disabled.mockReturnValue(true);
    expect((await POST(req({ productId }))).status).toBe(503);
    m.disabled.mockReturnValue(false);
    m.budget.mockResolvedValue(false);
    expect((await POST(req({ productId }))).status).toBe(429);
    expect(m.call).not.toHaveBeenCalled();
  });
  it("refuses products the caller cannot see or that are not linked", async () => {
    m.ctx.mockResolvedValue(null);
    expect((await POST(req({ productId }))).status).toBe(403);
    expect(m.call).not.toHaveBeenCalled();
  });
  it("rejects bad input", async () => {
    expect((await POST(req({ productId: "x" }))).status).toBe(400);
    expect((await POST(req({ productId, facts: { size: 5 } }))).status).toBe(400);
    expect((await POST(req([]))).status).toBe(400);
  });
  it("returns validated titles, tags with data reasons, and blanks", async () => {
    const res = await POST(req({ productId, facts: { size: "8 oz" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.titles).toHaveLength(2);
    expect(json.tags[0]).toMatchObject({ tag: "soy candle", isNew: false });
    expect(json.placeholders).toEqual(["[add size]"]);
    expect(m.ctx).toHaveBeenCalledWith(expect.anything(), productId, { size: "8 oz" });
  });
  it("retries once with a repair instruction, then fails cleanly", async () => {
    m.call.mockResolvedValueOnce("garbage").mockResolvedValueOnce(good);
    expect((await POST(req({ productId }))).status).toBe(200);
    expect(m.call.mock.calls[1][0].systemPrompt).toContain("could not be used");
    m.call.mockReset().mockResolvedValue("garbage");
    const failed = await POST(req({ productId }));
    expect(failed.status).toBe(500);
    expect((await failed.json()).code).toBe("bad_ai_response");
    expect(m.call).toHaveBeenCalledTimes(2);
  });
});
