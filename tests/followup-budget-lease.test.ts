import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireLease, rollingRateLimitMany } from "@/lib/rate-limit";

beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("REQUIRE_DURABLE_RATE_LIMIT", "false");
  vi.stubEnv("DISABLE_RATE_LIMITS", "false");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("free usage leaves paid capacity and failed free requests charge neither bucket", async () => {
  const shared = { key: "test-total", max: 5 };
  const free = { key: "test-free", max: 2 };
  expect((await rollingRateLimitMany([shared, free], 1000)).ok).toBe(true);
  expect((await rollingRateLimitMany([shared, free], 1000)).ok).toBe(true);
  for (let i = 0; i < 5; i++) expect((await rollingRateLimitMany([shared, free], 1000)).ok).toBe(false);
  for (let i = 0; i < 3; i++) expect((await rollingRateLimitMany([shared], 1000)).ok).toBe(true);
  expect((await rollingRateLimitMany([shared], 1000)).ok).toBe(false);
});

it("rolling capacity expires individual calls, not an entire fixed window", async () => {
  vi.useFakeTimers();
  const limits = [{ key: "test-rolling", max: 2 }];
  await rollingRateLimitMany(limits, 1000);
  vi.advanceTimersByTime(500);
  await rollingRateLimitMany(limits, 1000);
  vi.advanceTimersByTime(501);
  expect((await rollingRateLimitMany(limits, 1000)).ok).toBe(true);
  expect((await rollingRateLimitMany(limits, 1000)).ok).toBe(false);
});

it("only one overlapping scan owns a lease; release allows retry", async () => {
  const [first, second] = await Promise.all([acquireLease("overlap", 1000), acquireLease("overlap", 1000)]);
  expect(first).not.toBeNull();
  expect(second).toBeNull();
  await first!();
  const retry = await acquireLease("overlap", 1000);
  expect(retry).not.toBeNull();
  await retry!();
});

it("an expired owner's release cannot remove its replacement", async () => {
  vi.useFakeTimers();
  const expired = await acquireLease("replacement", 1000);
  vi.advanceTimersByTime(1001);
  const replacement = await acquireLease("replacement", 1000);
  await expired!();
  expect(await acquireLease("replacement", 1000)).toBeNull();
  await replacement!();
});

it("both protections fail closed without durable storage in production", async () => {
  vi.stubEnv("VERCEL", "1");
  expect(await acquireLease("production", 1000)).toBeNull();
  expect(await rollingRateLimitMany([{ key: "production", max: 5 }], 1000)).toEqual({ ok: false, reason: "missing_durable_store" });
});
