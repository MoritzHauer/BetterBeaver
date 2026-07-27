/**
 * Shared IndexedDB opener for the content database (plan 0017 §2). Two
 * object stores live here: `documents` (backend + bundled content, evictable
 * and re-downloadable) and `private` (user-authored Books that exist nowhere
 * else). They are deliberately separate stores rather than one store with a
 * provenance flag, so that the cache sweeps — `clearCachedDocuments` behind
 * Settings' "Refresh content", and `purgeUnmembered` on Remove — cannot reach
 * private content by construction rather than by remembering a boolean.
 *
 * Every caller must open at DB_VERSION; opening at a lower version throws
 * VersionError once any client has upgraded.
 */
const DB_NAME = "bb-content";
const DB_VERSION = 2;

export const DOCUMENTS_STORE = "documents";
export const PRIVATE_STORE = "private";

export function openContentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Idempotent: runs for a fresh install (no stores) and for a v1
      // install (documents already present, private missing).
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PRIVATE_STORE)) {
        db.createObjectStore(PRIVATE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}
