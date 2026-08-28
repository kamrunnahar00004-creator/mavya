import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for shared secrets presented over the network
 * (the metrics token, the worker bearer token).
 *
 * A plain `!==` short-circuits on the first differing byte, which is
 * theoretically observable. Across the public internet, serverless cold
 * starts and network jitter swamp that signal by orders of magnitude, so
 * this is defence in depth rather than a fix for a live risk -- but it costs
 * nothing and removes the question.
 *
 * Compares SHA-256 digests rather than the raw strings: timingSafeEqual
 * throws when its inputs differ in length, which would leak the secret's
 * length through an exception. Digests are always the same size, so the
 * length check can never decide the outcome.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}
