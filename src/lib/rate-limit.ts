import { Redis } from "@upstash/redis";

export type RateLimitResult = {
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

/**
 * Weighted variant, added for bulk photo-batch init (Codex review, 2026-08-22):
 * a 10-file batch must consume more of its budget than a 1-file batch in one
 * atomic check, which plain incr()-by-1 rate limiting cannot express. Kept as
 * a fully separate code path (own Redis key namespace via the caller-supplied
 * key, own memory map) so the existing single-photo limiter's behavior and
 * tests are untouched.
 */
const weightedBuckets = new Map<string, { count: number; resetAt: number }>();

export type WeightedRateLimitEntry = {
  key: string;
  max: number;
};

async function redisWeightedRateLimit(
  key: string,
  weight: number,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const namespacedKey = `rlw:${key}`;
    const count = await getRedis().incrby(namespacedKey, weight);
    if (count === weight) {
      await getRedis().pexpire(namespacedKey, windowMs);
    }
    return count <= max ? { ok: true } : { ok: false, reason: "limited" };
  } catch (err) {
    console.error("[rate-limit] durable store failed:", err);
    return { ok: false, reason: "store_error" };
  }
}

function memoryWeightedRateLimit(
  key: string,
  weight: number,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const win = weightedBuckets.get(key);
  if (!win || win.resetAt <= now) {
    weightedBuckets.set(key, { count: weight, resetAt: now + windowMs });
    return weight <= max ? { ok: true } : { ok: false, reason: "limited" };
  }
  win.count += weight;
  return win.count <= max ? { ok: true } : { ok: false, reason: "limited" };
}

export async function weightedRateLimit(
  key: string,
  weight: number,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (rateLimitDisabled()) {
    return { ok: true };
  }

  if (durableRateLimitConfigured()) {
    return redisWeightedRateLimit(key, weight, max, windowMs);
  }

  if (requiresDurableRateLimit()) {
    return { ok: false, reason: "missing_durable_store" };
  }

  return memoryWeightedRateLimit(key, weight, max, windowMs);
}

const MULTI_WEIGHTED_RATE_LIMIT_SCRIPT = `
local limitCount = tonumber(ARGV[1])
local weight = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local marker = KEYS[limitCount + 1]

if marker and redis.call('EXISTS', marker) == 1 then
  return 1
end

for i = 1, limitCount do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  local maximum = tonumber(ARGV[i + 3])
  if current + weight > maximum then
    return 0
  end
end

for i = 1, limitCount do
  local count = redis.call('INCRBY', KEYS[i], weight)
  if count == weight then
    redis.call('PEXPIRE', KEYS[i], window)
  end
end

if marker then
  redis.call('SET', marker, '1', 'PX', window, 'NX')
end

return 1
`;

/**
 * Atomically checks and consumes several weighted limits. Batch init uses
 * this for its user and IP budgets so one limit can never be charged when
 * the other rejects. The optional token also makes a repeated init request
 * free within the window after a response is lost.
 */
export async function weightedRateLimitMany(
  entries: readonly WeightedRateLimitEntry[],
  weight: number,
  windowMs: number,
  idempotencyToken?: string
): Promise<RateLimitResult> {
  if (rateLimitDisabled() || entries.length === 0) return { ok: true };

  if (durableRateLimitConfigured()) {
    try {
      // Redis Cluster requires every key used by one script to share a hash
      // slot. The fixed hash tag keeps this atomic check executable on both
      // single-node and clustered Upstash deployments.
      const keys = entries.map((entry) => `rlw:{multi}:bucket:${entry.key}`);
      if (idempotencyToken) keys.push(`rlw:{multi}:idem:${idempotencyToken}`);
      const result = await getRedis().eval(
        MULTI_WEIGHTED_RATE_LIMIT_SCRIPT,
        keys,
        [entries.length, weight, windowMs, ...entries.map((entry) => entry.max)]
      );
      return Number(result) === 1 ? { ok: true } : { ok: false, reason: "limited" };
    } catch (err) {
      console.error("[rate-limit] durable store failed:", err);
      return { ok: false, reason: "store_error" };
    }
  }

  if (requiresDurableRateLimit()) {
    return { ok: false, reason: "missing_durable_store" };
  }

  const now = Date.now();
  const markerKey = idempotencyToken ? `multi:idem:${idempotencyToken}` : null;
  if (markerKey) {
    const marker = weightedBuckets.get(markerKey);
    if (marker && marker.resetAt > now) return { ok: true };
  }

  const windows = entries.map((entry) => {
    const bucketKey = `multi:bucket:${entry.key}`;
    const current = weightedBuckets.get(bucketKey);
    return {
      entry,
      bucketKey,
      count: !current || current.resetAt <= now ? 0 : current.count,
      resetAt: !current || current.resetAt <= now ? now + windowMs : current.resetAt,
    };
  });
  if (windows.some(({ entry, count }) => count + weight > entry.max)) {
    return { ok: false, reason: "limited" };
  }
  for (const { bucketKey, count, resetAt } of windows) {
    weightedBuckets.set(bucketKey, { count: count + weight, resetAt });
  }
  if (markerKey) {
    weightedBuckets.set(markerKey, { count: 1, resetAt: now + windowMs });
  }
  return { ok: true };
}
