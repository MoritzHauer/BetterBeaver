import type { DomainDocument, TopicDocument } from "@betterbeaver/schema";

/**
 * IndexedDB cache of content documents (plan 0012 §6). One record per
 * document; `version`/`schemaVersion` mirror the backend's
 * `published_version`/`schema_version` and drive the update check.
 * localStorage was rejected: its ~5 MB ceiling is shared with learner state.
 */
export interface CachedDocument {
  id: string;
  kind: "topic" | "domain";
  version: number;
  schemaVersion: number;
  doc: TopicDocument | DomainDocument;
}

const DB_NAME = "bb-content";
const STORE = "documents";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

/** All cached documents; `[]` when the cache is empty or unreadable (a broken cache degrades to the bundled seed, never to a crash). */
export async function readCachedDocuments(): Promise<CachedDocument[]> {
  try {
    const db = await openDb();
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      return (await requestToPromise(store.getAll())) as CachedDocument[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Replaces the entire cache with `docs` in one transaction — the
 * all-or-nothing accept (plan 0012 §6): either the new set commits fully or
 * the old cache stays untouched.
 */
export async function replaceCachedDocuments(
  docs: CachedDocument[],
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const doc of docs) {
        store.put(doc);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB"));
    });
  } finally {
    db.close();
  }
}

export async function clearCachedDocuments(): Promise<void> {
  await replaceCachedDocuments([]);
}
