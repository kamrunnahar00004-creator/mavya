import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const limit = vi.hoisted(() => vi.fn());
const daily = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ weightedRateLimit: limit, rollingRateLimitMany: daily }));
import { fetchEtsyImage, fetchListingsBatch, normalizeListing, searchActiveListings, withEtsyRequestTier } from "@/lib/etsy";

beforeEach(() => {
  vi.stubEnv("ETSY_API_KEYSTRING", "test");
  vi.stubEnv("ETSY_SHARED_SECRET", "test");
  limit.mockReset().mockResolvedValue({ ok: true });
  daily.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Etsy client safety", () => {
  it("charges each free provider retry to both actual-request budgets", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    await withEtsyRequestTier("free", () => searchActiveListings("soy candle"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(daily).toHaveBeenCalledTimes(2);
    for (const call of daily.mock.calls) expect(call).toEqual([[{ key: "requests:day", max: 4500 }, { key: "free:day", max: 1000 }], 86_400_000]);
  });
  it("free context cannot leak into a concurrent paid call", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
    await Promise.all([withEtsyRequestTier("free", () => searchActiveListings("soy candle")), searchActiveListings("mug")]);
    expect(daily.mock.calls.map(c => c[0].length).sort()).toEqual([1, 2]);
  });
  it("charges batch fallback requests to the free allowance too", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
    await withEtsyRequestTier("free", () => fetchListingsBatch([1, 2]));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(daily).toHaveBeenCalledTimes(3);
    expect(daily.mock.calls.every(c => c[0].some((e: { key: string }) => e.key === "free:day"))).toBe(true);
  });
  it("a denied daily budget never reaches the provider", async () => {
    daily.mockResolvedValue({ ok: false });
    await expect(withEtsyRequestTier("free", () => searchActiveListings("soy candle"))).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies provider traffic when the durable shared budget denies it", async () => {
    limit.mockResolvedValue({ ok: false });
    await expect(searchActiveListings("bunny", 100, Date.now() + 400)).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("waits out a busy shared second instead of failing the keyword", async () => {
    limit.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await expect(searchActiveListings("bunny")).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("never spends daily quota while waiting for a per-second slot", async () => {
    limit.mockImplementation(async (key: string) => ({ ok: key !== "etsy:requests:second" }));
    await expect(searchActiveListings("bunny", 100, Date.now() + 400)).rejects.toMatchObject({ code: "rate_limited" });
    expect(daily).not.toHaveBeenCalled();
  });
  it("does not launch a request after its caller's deadline", async () => {
    await expect(fetchListingsBatch([123456], Date.now() - 1)).rejects.toMatchObject({ status: 504 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a missing single listing becomes an empty result", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    expect((await fetchListingsBatch([123456])).size).toBe(0);
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it.each(["http://i.etsystatic.com/a", "https://evil.com/a", "https://i.etsystatic.com.evil.com/a", "https://i.etsystatic.com:8443/a", "https://user:pass@i.etsystatic.com/a"])("rejects unsafe image URL %s", async (url) => {
    await expect(fetchEtsyImage(url)).rejects.toMatchObject({ code: "bad_response" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels an oversized image while streaming it", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel });
    vi.mocked(fetch).mockResolvedValue(new Response(stream, { headers: { "content-type": "image/jpeg" } }));
    await expect(fetchEtsyImage("https://i.etsystatic.com/a.jpg")).rejects.toThrow("Image too large");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds the image fetch and refuses redirects", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    expect((await fetchEtsyImage("https://i.etsystatic.com/a.png")).buffer.length).toBe(3);
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("ignores malformed image entries rather than crashing the whole listing", () => {
    expect(normalizeListing({ listing_id: 1, images: [null, false, { listing_image_id: 10, rank: 1 }] })?.images.map((i) => i.id)).toEqual([10]);
  });
});
