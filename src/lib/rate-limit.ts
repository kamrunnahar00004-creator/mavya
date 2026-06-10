/**
 * Minimal in-memory rate limit for localhost validation.
 * Per-instance state. Not durable, not multi-server safe. Replace with
 * Upstash/Redis when production traffic begins.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): { ok: boolean } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return { ok: false };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true };
}
