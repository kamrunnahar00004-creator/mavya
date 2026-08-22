"use client";

/**
 * Pure, unit-testable pieces of the bulk-upload client flow. Network calls
 * (fetch to /api/photos/batch/*) stay in the component; everything that can
 * be tested without a browser or a server lives here, same split as
 * rating-queue.ts for the single-photo flow.
 */

export type BatchRole = "main" | "supporting";

export type SelectedFile = {
  requestId: string;
  file: File;
  role: BatchRole;
  contentHash: string;
};

/** SHA-256 of the exact prepared bytes, hex-encoded. Must be computed AFTER
 *  prepareUploadImage() so the declared hash matches what the server will
 *  receive and recompute (image-hash.ts's hashImageBytes uses the same
 *  algorithm server-side). */
export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Client-side duplicate detection within one selection: identical prepared
 *  bytes hash the same regardless of filename, so this catches "picked the
 *  same file twice" and "picked two different filenames with the same
 *  photo" alike. */
export function findDuplicateHashIndex(
  hashes: readonly string[],
  candidate: string
): number {
  return hashes.findIndex((h) => h === candidate);
}

export type BatchInitPayload = {
  idempotencyKey: string;
  productName?: string;
  files: { requestId: string; role: BatchRole; contentHash: string; byteSize: number; mimeType: string }[];
};

export function buildBatchInitPayload(
  selected: readonly SelectedFile[],
  idempotencyKey: string,
  productName?: string
): BatchInitPayload {
  return {
    idempotencyKey,
    productName,
    files: selected.map((s) => ({
      requestId: s.requestId,
      role: s.role,
      contentHash: s.contentHash,
      byteSize: s.file.size,
      mimeType: s.file.type,
    })),
  };
}

export type BatchInitItem = { requestId: string; photoId: string; role: BatchRole; position: number };

export type BatchInitResult =
  | { ok: true; batchId: string; productId: string | null; items: BatchInitItem[] }
  | { ok: false; message: string };

export function parseBatchInitResponse(body: unknown): BatchInitResult {
  const b = (body ?? {}) as {
    batchId?: unknown;
    productId?: unknown;
    items?: unknown;
  };
  if (typeof b.batchId !== "string" || !b.batchId || !Array.isArray(b.items)) {
    return { ok: false, message: "Could not start the batch." };
  }
  return {
    ok: true,
    batchId: b.batchId,
    productId: typeof b.productId === "string" ? b.productId : null,
    items: b.items as BatchInitItem[],
  };
}

export type BatchUploadResult =
  | { ok: true; requestId: string; photoId: string; productId?: string }
  | { ok: false; requestId: string; message: string };

export function parseBatchUploadResponse(requestId: string, body: unknown): BatchUploadResult {
  const b = (body ?? {}) as { photoId?: unknown; productId?: unknown; ok?: unknown };
  if (typeof b.photoId !== "string" || !b.photoId) {
    return { ok: false, requestId, message: "Could not save this photo." };
  }
  return {
    ok: true,
    requestId,
    photoId: b.photoId,
    productId: typeof b.productId === "string" ? b.productId : undefined,
  };
}

export function batchErrorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as { error?: unknown; code?: unknown };
  const code = typeof b.code === "string" ? b.code : "";
  if (code === "insufficient_credits") return "Your rating credit ran out";
  if (code === "subscription_required" || code === "subscription_past_due") {
    return "An active plan is needed to rate photos. Check Settings to update billing.";
  }
  if (code === "unauthenticated") return "Your session expired. Log in again.";
  if (code === "rate_limited") return "Too many photos at once. Wait a minute and try again.";
  if (typeof b.error === "string" && b.error) return b.error;
  return `Could not save this photo (${status})`;
}

/** Bounded-concurrency runner. No network here -- takes any async function,
 *  used both by the real upload flow (concurrency 2, after the declared
 *  main uploads alone/first) and directly in tests with a fake worker. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  }
  const pool = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => runOne());
  await Promise.all(pool);
}

/** Reorders a selection array so the declared main is first, preserving the
 *  relative order of everything else -- this is the "main first, awaited"
 *  upload sequencing the server-side promotion logic depends on. */
export function withMainFirst<T extends { role: BatchRole }>(items: readonly T[]): T[] {
  const main = items.filter((i) => i.role === "main");
  const rest = items.filter((i) => i.role !== "main");
  return [...main, ...rest];
}
