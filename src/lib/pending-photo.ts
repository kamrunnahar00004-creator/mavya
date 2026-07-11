"use client";

/**
 * Pending-photo preservation: a visitor may pick a photo BEFORE signing in or
 * paying. The compressed file is stashed in IndexedDB so it survives the
 * Google OAuth redirect, the Stripe Checkout round-trip, and a closed browser.
 * After entitlement is confirmed the photo is recovered and the assessment
 * starts automatically. Nothing is uploaded and no paid AI runs before then.
 *
 * Honest failure handling:
 *  - Private browsing / IndexedDB unavailable: fall back to an in-memory slot
 *    (survives the auth MODAL, not a redirect) and report `durable: false` so
 *    the UI can warn the user they may need to re-pick after checkout.
 *  - Entries older than 24h are treated as expired and cleared.
 *  - Corrupted/missing entries load as null; callers show the normal upload UI.
 *  - The stash is intentionally NOT bound to a user account: it is browser-local
 *    pre-auth state, and whichever account completes sign-in owns the upload.
 */

const DB_NAME = "mavya-pending";
const STORE = "pending";
const KEY = "photo";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type PendingRecord = {
  blob: Blob;
  name: string;
  type: string;
  savedAt: number;
};

let memoryFallback: PendingRecord | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
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

/** Save the picked file. Returns whether the stash is durable across redirects. */
export async function savePendingPhoto(file: File): Promise<{ durable: boolean }> {
  const record: PendingRecord = {
    blob: file,
    name: file.name,
    type: file.type,
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

/** Load a valid pending photo, or null (expired/corrupted entries are cleared). */
export async function loadPendingPhoto(): Promise<File | null> {
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
  if (!record || !(record.blob instanceof Blob) || record.blob.size === 0) {
    await clearPendingPhoto();
    return null;
  }
  if (typeof record.savedAt !== "number" || Date.now() - record.savedAt > MAX_AGE_MS) {
    await clearPendingPhoto();
    return null;
  }
  if (typeof record.type !== "string" || !record.type.startsWith("image/")) {
    await clearPendingPhoto();
    return null;
  }
  try {
    return new File([record.blob], record.name || "photo.jpg", { type: record.type });
  } catch {
    await clearPendingPhoto();
    return null;
  }
}

export async function clearPendingPhoto(): Promise<void> {
  memoryFallback = null;
  try {
    const db = await openDb();
    await tx(db, "readwrite", (s) => s.delete(KEY));
    db.close();
  } catch {
    // Nothing durable to clear.
  }
}
