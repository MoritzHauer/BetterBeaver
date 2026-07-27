import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { openContentDb, requestToPromise, PRIVATE_STORE } from "./idb";

/**
 * One record per private Book (plan 0017 §3): its Book document, the Domain
 * it owns, its note markdown and its assets, all together — so export is a
 * serialisation of one record and delete is one key. Nothing here ever
 * reaches the backend; there is no `version`/`schemaVersion` pair like
 * `CachedDocument` has, because there is no published version to diff
 * against.
 */
export interface PrivateBookRecord {
  /** The Book id — a bare `crypto.randomUUID()`, also the store key. */
  id: string;
  book: BookDocument;
  domain: DomainDocument;
  /**
   * Asset stem -> blob (plan 0017 §4). Assets, and only assets, live outside
   * the documents: `BookDocument` already carries `notes` inline, but by
   * design it holds no asset bytes ("minus asset stems" — `documents.ts:5`),
   * so this is the one thing a private Book has nowhere else to put.
   */
  assets: Record<string, Blob>;
  updatedAt: number;
}

/** All private Books; `[]` on any failure (mirrors `readCachedDocuments`). */
export async function readPrivateBooks(): Promise<PrivateBookRecord[]> {
  try {
    const db = await openContentDb();
    try {
      const store = db
        .transaction(PRIVATE_STORE, "readonly")
        .objectStore(PRIVATE_STORE);
      return (await requestToPromise(store.getAll())) as PrivateBookRecord[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** One private Book by id; `undefined` on miss or failure. */
export async function readPrivateBook(
  id: string,
): Promise<PrivateBookRecord | undefined> {
  try {
    const db = await openContentDb();
    try {
      const store = db
        .transaction(PRIVATE_STORE, "readonly")
        .objectStore(PRIVATE_STORE);
      return (await requestToPromise(store.get(id))) as
        PrivateBookRecord | undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Upsert. Stamps `updatedAt` itself — callers do not supply it. Rejects on
 * failure (a failed write must not look like a success).
 */
export async function putPrivateBook(
  record: Omit<PrivateBookRecord, "updatedAt">,
): Promise<void> {
  const db = await openContentDb();
  try {
    const full: PrivateBookRecord = { ...record, updatedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PRIVATE_STORE, "readwrite");
      tx.objectStore(PRIVATE_STORE).put(full);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB"));
    });
  } finally {
    db.close();
  }
}

/** Delete one record. Rejects on failure. */
export async function deletePrivateBook(id: string): Promise<void> {
  const db = await openContentDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PRIVATE_STORE, "readwrite");
      tx.objectStore(PRIVATE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB"));
    });
  } finally {
    db.close();
  }
}

/**
 * Delete every private Book record. **Only `eraseAllData` may call this**
 * (plan 0017 step 6) — nothing else.
 */
export async function clearPrivateBooks(): Promise<void> {
  const db = await openContentDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PRIVATE_STORE, "readwrite");
      tx.objectStore(PRIVATE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB"));
    });
  } finally {
    db.close();
  }
}
