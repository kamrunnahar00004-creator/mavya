export type PendingDownload = {
  dataUrl: string;
  filename: string;
  savedAt: number;
};

const DB_NAME = "mavya-downloads";
const STORE_NAME = "pending";
const DOWNLOAD_KEY = "latest";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = operation(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      })
  );
}

export async function savePendingDownload(
  download: PendingDownload
): Promise<void> {
  await storeOperation("readwrite", (store) =>
    store.put(download, DOWNLOAD_KEY)
  );
}

export async function readPendingDownload(): Promise<PendingDownload | null> {
  const result = await storeOperation("readonly", (store) =>
    store.get(DOWNLOAD_KEY)
  );

  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.dataUrl !== "string" ||
    !result.dataUrl.startsWith("data:image/") ||
    typeof result.filename !== "string"
  ) {
    return null;
  }

  return {
    dataUrl: result.dataUrl,
    filename: result.filename,
    savedAt: typeof result.savedAt === "number" ? result.savedAt : Date.now(),
  };
}
