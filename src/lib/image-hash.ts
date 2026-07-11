import { createHash } from "node:crypto";

/**
 * Stable content hash for uploaded image bytes. Server-only (node:crypto).
 * The hash is computed over the exact bytes received by the API AFTER the
 * client-side canvas normalization (client-image.ts re-encodes most uploads to
 * a deterministic JPEG), so identical re-uploads of the same photo hash equal.
 */
export function hashImageBytes(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Short hash for secondary cache keys (e.g. product-context strings). */
export function hashText(text: string): string {
  if (!text) return "";
  return createHash("md5").update(text).digest("hex");
}
