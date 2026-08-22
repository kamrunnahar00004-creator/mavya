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

export type BatchSubmissionIdentity = {
  fingerprint: string;
  idempotencyKey: string;
  batchId?: string;
};

export function parseBatchSubmissionIdentity(raw: string | null): BatchSubmissionIdentity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.fingerprint !== "string" ||
      typeof value.idempotencyKey !== "string" ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(value.idempotencyKey) ||
      (value.batchId !== undefined && typeof value.batchId !== "string")
    ) {
      return null;
    }
    return {
      fingerprint: value.fingerprint,
      idempotencyKey: value.idempotencyKey,
      ...(value.batchId ? { batchId: value.batchId } : {}),
    };
  } catch {
    return null;
  }
}

/** Stable across retries of the same prepared selection. File bytes are
 * represented by their already-computed hashes, so filenames do not affect
 * identity and changing order/role/name intentionally creates a new batch. */
export function batchSubmissionFingerprint(
  selected: readonly SelectedFile[],
  productName?: string
): string {
  return JSON.stringify({
    productName: productName?.trim() || null,
    files: selected.map((item) => ({
      requestId: item.requestId,
      role: item.role,
      contentHash: item.contentHash,
      byteSize: item.file.size,
      mimeType: item.file.type,
    })),
  });
}

export function resolveBatchSubmissionIdentity(
  previous: BatchSubmissionIdentity | null,
  fingerprint: string,
  createKey: () => string
): BatchSubmissionIdentity {
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, idempotencyKey: createKey() };
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
  const validProductId =
    b.productId === null || (typeof b.productId === "string" && b.productId.length > 0);
  const validItems =
    Array.isArray(b.items) &&
    b.items.length >= 2 &&
    b.items.length <= 10 &&
    b.items.every((item) => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return (
        typeof value.requestId === "string" &&
        value.requestId.length > 0 &&
        typeof value.photoId === "string" &&
        value.photoId.length > 0 &&
        (value.role === "main" || value.role === "supporting") &&
        typeof value.position === "number" &&
        Number.isInteger(value.position) &&
        value.position >= 0
      );
    });
  if (typeof b.batchId !== "string" || !b.batchId || !validProductId || !validItems) {
    return { ok: false, message: "Could not start the batch." };
  }
  return {
    ok: true,
    batchId: b.batchId,
    productId: b.productId as string | null,
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

export type BatchFinalizeResult =
  | { ok: true; productId: string | null }
  | { ok: false; message: string };

/** Finalization may legitimately return null after deleting an empty product.
 * Keep that distinct from a malformed response so the client never falls
 * back to an init-time product id that no longer exists. */
export function parseBatchFinalizeResponse(body: unknown): BatchFinalizeResult {
  const b = (body ?? {}) as { ok?: unknown; productId?: unknown };
  if (
    b.ok !== true ||
    !(b.productId === null || (typeof b.productId === "string" && b.productId.length > 0))
  ) {
    return { ok: false, message: "Could not finish this batch." };
  }
  return { ok: true, productId: b.productId };
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
