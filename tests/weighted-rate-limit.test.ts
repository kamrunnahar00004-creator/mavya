import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { weightedRateLimit, weightedRateLimitMany } from "../src/lib/rate-limit";

/**
 * Weighted rate limiter added for bulk photo-batch init (Codex review,
 * 2026-08-22): a 10-file batch must consume 10 units of budget in one
 * atomic check, not 1. Exercises the in-memory fallback path (no Upstash
 * env vars set in the test environment); source assertions below pin the
 * equivalent check-before-consume ordering in the Redis Lua path.
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

  it("does not consume capacity when a weighted request is rejected", async () => {
    const key = `test:${crypto.randomUUID()}`;
    expect(await weightedRateLimit(key, 6, 10, 60_000)).toEqual({ ok: true });
    expect(await weightedRateLimit(key, 5, 10, 60_000)).toEqual({
      ok: false,
      reason: "limited",
    });
    expect(await weightedRateLimit(key, 4, 10, 60_000)).toEqual({ ok: true });
  });

  it("does not create a spent bucket for an oversized first request", async () => {
    const key = `test:${crypto.randomUUID()}`;
    expect(await weightedRateLimit(key, 11, 10, 60_000)).toEqual({
      ok: false,
      reason: "limited",
    });
    expect(await weightedRateLimit(key, 10, 10, 60_000)).toEqual({ ok: true });
  });

  it("checks the Redis budget before incrementing it", () => {
    const source = readFileSync("src/lib/rate-limit.ts", "utf8");
    const start = source.indexOf("async function redisWeightedRateLimit");
    const end = source.indexOf("function memoryWeightedRateLimit", start);
    const redisPath = source.slice(start, end);
    expect(redisPath.indexOf("if current + weight > maximum")).toBeGreaterThan(-1);
    expect(redisPath.indexOf("if current + weight > maximum")).toBeLessThan(
      redisPath.indexOf("redis.call('INCRBY'")
    );
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

describe("weightedRateLimitMany", () => {
  it("atomically consumes every supplied budget", async () => {
    const suffix = crypto.randomUUID();
    const entries = [
      { key: `user:${suffix}`, max: 10 },
      { key: `ip:${suffix}`, max: 20 },
    ];
    expect(await weightedRateLimitMany(entries, 10, 60_000)).toEqual({ ok: true });
    expect(await weightedRateLimitMany(entries, 1, 60_000)).toEqual({
      ok: false,
      reason: "limited",
    });
  });

  it("does not charge a permissive budget when another budget rejects", async () => {
    const suffix = crypto.randomUUID();
    const blocked = { key: `blocked:${suffix}`, max: 10 };
    const available = { key: `available:${suffix}`, max: 10 };
    expect(await weightedRateLimitMany([blocked], 10, 60_000)).toEqual({ ok: true });
    expect(await weightedRateLimitMany([blocked, available], 1, 60_000)).toEqual({
      ok: false,
      reason: "limited",
    });
    expect(await weightedRateLimitMany([available], 10, 60_000)).toEqual({ ok: true });
  });

  it("makes a repeated idempotent init free without making a different init free", async () => {
    const suffix = crypto.randomUUID();
    const entries = [
      { key: `user:${suffix}`, max: 10 },
      { key: `ip:${suffix}`, max: 10 },
    ];
    expect(await weightedRateLimitMany(entries, 7, 60_000, `same:${suffix}`)).toEqual({ ok: true });
    expect(await weightedRateLimitMany(entries, 7, 60_000, `same:${suffix}`)).toEqual({ ok: true });
    expect(await weightedRateLimitMany(entries, 4, 60_000, `other:${suffix}`)).toEqual({
      ok: false,
      reason: "limited",
    });
  });

  it("uses script keys for the idempotency marker and one Redis cluster hash slot", () => {
    const source = readFileSync("src/lib/rate-limit.ts", "utf8");
    expect(source).toContain("local marker = KEYS[limitCount + 1]");
    expect(source).toContain("rlw:{multi}:bucket:");
    expect(source).toContain("rlw:{multi}:idem:");
    expect(source).not.toMatch(/redis\.call\([^\n]+ARGV\[limitCount \+ 1\]/);
  });
});
