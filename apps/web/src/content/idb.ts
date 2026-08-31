/**
 * Shared IndexedDB opener for the content database (plan 0017 §2). Two
 * object stores live here: `documents` (backend + bundled content, evictable
 * and re-downloadable) and `private` (user-authored Books that exist nowhere
 * else). They are deliberately separate stores rather than one store with a
 * provenance flag, so that the cache sweeps — `clearCachedDocuments` behind
 * "erase all my data", and `purgeUnmembered` on Remove — cannot reach
 * private content by construction rather than by remembering a boolean.
 * (Settings' "Refresh content" was a third sweep until it stopped emptying
 * the store and started re-downloading into it instead.)
 *
 * Every caller must open at DB_VERSION; opening at a lower version throws
 * VersionError once any client has upgraded.
 */
import { recordNav } from "../nav-diary";

const DB_NAME = "bb-content";
const DB_VERSION = 2;

export const DOCUMENTS_STORE = "documents";
export const PRIVATE_STORE = "private";

/** How long an open may take before it is called a failure. Generous by an
 * order of magnitude — a real open is milliseconds, cold cache included —
 * because the only thing this protects against is *never*. */
const OPEN_TIMEOUT_MS = 20_000;

export function openContentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // A promise that never settles is the one failure `readCachedDocuments`'s
    // try/catch cannot rescue, and the boot awaits it before anything is
    // rendered — so it showed up on the owner's phone as a black screen that
    // only an app restart cleared (see docs/STATUS.md, 2026-08-21). Two ways
    // in, both closed here:
    //
    //   `blocked` — fires instead of `success` when another connection to
    //   this database is still open at a lower version. It is not an error
    //   event: without a handler the request simply waits, forever if the
    //   other connection belongs to a document Chrome is holding in bfcache.
    //   An open that has to wait for someone else is a failure for our
    //   purposes; the caller's fallback is better than a hang.
    //
    //   the timer — for everything else that can leave a request pending on
    //   a real device (storage pressure, an evicted origin) and that no spec
    //   text will enumerate for us.
    let settled = false;
    const finish = (run: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        run();
      }
    };
    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error("the content database did not respond (timed out)")),
      );
    }, OPEN_TIMEOUT_MS);

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
    request.onsuccess = () => finish(() => resolve(request.result));
    request.onerror = () =>
      finish(() => reject(request.error ?? new Error("indexedDB")));
    request.onblocked = () => {
      recordNav("idb-blocked", "another tab or a cached page holds the db");
      finish(() =>
        reject(new Error("the content database is in use by another window")),
      );
    };
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}
