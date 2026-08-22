import { describe, expect, it } from "vitest";
import { weightedRateLimit } from "../src/lib/rate-limit";

/**
 * Weighted rate limiter added for bulk photo-batch init (Codex review,
 * 2026-08-22): a 10-file batch must consume 10 units of budget in one
 * atomic check, not 1. Exercises the in-memory fallback path (no Upstash
 * env vars set in the test environment); the Redis path uses the same
 * incrby-based logic against a real store in production.
 */
describe("weightedRateLimit", () => {
  it("allows a single request within budget", async () => {
    const result = await weightedRateLimit(`test:${crypto.randomUUID()}`, 3, 10, 60_000);
    expect(result.ok).toBe(true);
  });

  it("allows exactly one full 10-file batch against a limit of 10", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const result = await weightedRateLimit(key, 10, 10, 60_000);
    expect(result.ok).toBe(true);
  });

  it("rejects a batch that would exceed the limit in one call", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const result = await weightedRateLimit(key, 11, 10, 60_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("limited");
  });

  it("accumulates weight across calls within the same window", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const first = await weightedRateLimit(key, 6, 10, 60_000);
    expect(first.ok).toBe(true);
    const second = await weightedRateLimit(key, 5, 10, 60_000);
    // 6 + 5 = 11 > 10
    expect(second.ok).toBe(false);
  });

  it("keeps separate keys independent", async () => {
    const keyA = `test:${crypto.randomUUID()}`;
    const keyB = `test:${crypto.randomUUID()}`;
    const a = await weightedRateLimit(keyA, 10, 10, 60_000);
    const b = await weightedRateLimit(keyB, 10, 10, 60_000);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const first = await weightedRateLimit(key, 10, 10, 30);
    expect(first.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    const second = await weightedRateLimit(key, 10, 10, 30);
    expect(second.ok).toBe(true);
  });
});
