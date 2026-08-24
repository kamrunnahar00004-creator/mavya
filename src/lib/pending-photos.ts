"use client";

/**
 * Pending-PHOTOS preservation (plural): a visitor may pick up to 10 listing
 * photos BEFORE signing in or paying. The compressed files are stashed in
 * IndexedDB so they survive the Google OAuth redirect, the Stripe Checkout
 * round-trip, and a closed browser. After entitlement is confirmed the
 * photos are recovered and handed back to the SAME dropzone
 * (AddProductCard) that picked them, in the same order, so recovery behaves
 * exactly like a live pick (1 photo submits immediately, 2+ show the review
 * grid) -- never a separate, second implementation of that decision.
 *
 * Supersedes the older single-photo pending-photo.ts, which this file does
 * not read or migrate: nothing has gone to real traffic yet with a stashed
 * single photo, so there is nothing to migrate from.
 *
 * Same honest-failure philosophy as pending-photo.ts:
 *  - Private browsing / IndexedDB unavailable: fall back to an in-memory
 *    slot (survives the auth MODAL, not a redirect) and report
 *    `durable: false` so the UI can warn the visitor.
 *  - Entries older than 24h are treated as expired and cleared.
 *  - Corrupted/missing entries load as null; callers show the normal upload UI.
 *  - Not bound to a user account: browser-local pre-auth state: whichever
 *    account completes sign-in owns the upload.
 */

import type { BatchRole } from "@/lib/photo-batch-client";

const DB_NAME = "mavya-pending";
const STORE = "pending-photos";
const KEY = "photos";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_PHOTOS = 10;

export type PendingPhotoItem = { file: File; role: BatchRole };

type PendingRecordItem = {
  blob: Blob;
  name: string;
  type: string;
  role: BatchRole;
};

type PendingRecord = {
  items: PendingRecordItem[];
  savedAt: number;
};

let memoryFallback: PendingRecord | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
      // The older single-photo store, if present from a prior schema
      // version, is left alone -- pending-photo.ts still owns it.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => reject(req.error ?? new Error("indexeddb_tx_failed"));
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error("indexeddb_tx_aborted"));
    t.onerror = () => reject(t.error ?? new Error("indexeddb_tx_failed"));
  });
}

/** Save the picked photos (main first). Returns whether the stash is
 *  durable across redirects. Silently caps at MAX_PENDING_PHOTOS -- callers
 *  are expected to have already capped/warned before calling this. */
export async function savePendingPhotos(
  items: readonly PendingPhotoItem[]
): Promise<{ durable: boolean }> {
  const record: PendingRecord = {
    items: items.slice(0, MAX_PENDING_PHOTOS).map((item) => ({
      blob: item.file,
      name: item.file.name,
      type: item.file.type,
      role: item.role,
    })),
    savedAt: Date.now(),
  };
  try {
    const db = await openDb();
    await tx(db, "readwrite", (s) => s.put(record, KEY));
    db.close();
    memoryFallback = null;
    return { durable: true };
  } catch {
    // Private browsing or blocked storage: keep it for this page's lifetime.
    memoryFallback = record;
    return { durable: false };
  }
}

/** Load valid pending photos (main first), or null (expired/corrupted/empty
 *  entries are cleared). */
export async function loadPendingPhotos(): Promise<PendingPhotoItem[] | null> {
  let record: PendingRecord | null = memoryFallback;
  if (!record) {
    try {
      const db = await openDb();
      record = ((await tx(db, "readonly", (s) => s.get(KEY))) as PendingRecord) ?? null;
      db.close();
    } catch {
      return null;
    }
  }
  if (!record || !Array.isArray(record.items) || record.items.length === 0) {
    await clearPendingPhotos();
    return null;
  }
  if (typeof record.savedAt !== "number" || Date.now() - record.savedAt > MAX_AGE_MS) {
    await clearPendingPhotos();
    return null;
  }
  const files: PendingPhotoItem[] = [];
  for (const item of record.items) {
    if (
      !item ||
      !(item.blob instanceof Blob) ||
      item.blob.size === 0 ||
      typeof item.type !== "string" ||
      !item.type.startsWith("image/") ||
      (item.role !== "main" && item.role !== "supporting")
    ) {
      continue; // one corrupted item never invalidates the rest of the pick
    }
    try {
      files.push({
        file: new File([item.blob], item.name || "photo.jpg", { type: item.type }),
        role: item.role,
      });
    } catch {
      continue;
    }
  }
  if (files.length === 0) {
    await clearPendingPhotos();
    return null;
  }
  // main first, always -- AddProductCard's own role assignment on a live
  // pick is purely positional (index 0 = main), so recovery must preserve
  // that same ordering to reproduce the exact same choice the visitor made.
  files.sort((a, b) => (a.role === "main" ? -1 : 0) - (b.role === "main" ? -1 : 0));
  return files;
}

export async function clearPendingPhotos(): Promise<void> {
  memoryFallback = null;
  try {
    const db = await openDb();
    await tx(db, "readwrite", (s) => s.delete(KEY));
    db.close();
  } catch {
    // Nothing durable to clear.
  }
}
