import { Redis } from "@upstash/redis";

type RateLimitResult = {
  ok: boolean;
  reason?: "limited" | "missing_durable_store" | "store_error";
};

/**
 * Production uses Upstash Redis so limits are shared across serverless
 * instances. Local development falls back to memory for convenience.
 */
const buckets = new Map<string, number[]>();
let redis: Redis | null = null;

function durableRateLimitConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function requiresDurableRateLimit(): boolean {
  return process.env.VERCEL === "1" || process.env.REQUIRE_DURABLE_RATE_LIMIT === "true";
}

function rateLimitDisabled(): boolean {
  return process.env.DISABLE_RATE_LIMITS === "true";
}

function getRedis(): Redis {
  if (redis) return redis;
  redis = Redis.fromEnv();
  return redis;
}

async function redisRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const namespacedKey = `rl:${key}`;
    const count = await getRedis().incr(namespacedKey);
    if (count === 1) {
      await getRedis().pexpire(namespacedKey, windowMs);
    }
    return count <= max ? { ok: true } : { ok: false, reason: "limited" };
  } catch (err) {
    console.error("[rate-limit] durable store failed:", err);
    return { ok: false, reason: "store_error" };
  }
}

function memoryRateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return { ok: false, reason: "limited" };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true };
}

export async function rateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (rateLimitDisabled()) {
    return { ok: true };
  }

  if (durableRateLimitConfigured()) {
    return redisRateLimit(key, max, windowMs);
  }

  if (requiresDurableRateLimit()) {
    return { ok: false, reason: "missing_durable_store" };
  }

  return memoryRateLimit(key, max, windowMs);
}
