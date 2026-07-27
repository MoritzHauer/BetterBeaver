# Spec 0017-1: Private Book store (IndexedDB)

Step 1 of [plan 0017](../plans/0017-private-books.md). Storage layer only — **no UI, no schema changes, no editor, no export/import**. All design decisions are already resolved in the plan; implement as specified and do not reopen them.

## Context (read first, in this order)

- `apps/web/src/content/cache.ts` — the existing IndexedDB module. You are extending its database with a second object store. Read all 126 lines; you will be modifying it.
- `docs/plans/0017-private-books.md` §2, §3, §6 — why a separate store, the record shape, why ids are bare UUIDs.
- `apps/web/src/content/myBooks.ts` — the localStorage membership lists a private Book will later join (not this step; read for context on id handling).
- `packages/schema/src/entities.ts:7` — `slugPattern`. A `crypto.randomUUID()` value satisfies it. Do not add validation exemptions; none are needed.

## 1. The database migration — the risky part, get this right

`cache.ts` currently does:

```ts
const DB_NAME = "bb-content";
const STORE = "documents";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    ...
```

Two failure modes you must avoid, both affecting **existing installs**:

1. Bumping to version 2 while leaving `onupgradeneeded` unconditional makes it call `createObjectStore("documents")` on a database that already has that store → `ConstraintError`, and the content cache becomes unreadable.
2. If one module opens the database at version 2 and another still opens it at version 1, the version-1 open throws `VersionError`. **Both modules must open at the same version.**

Therefore: extract a single shared opener and have both modules use it. Create `apps/web/src/content/idb.ts`:

```ts
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
```

Then in `cache.ts`: delete its local `openDb` and `requestToPromise`, import `openContentDb`/`requestToPromise`/`DOCUMENTS_STORE` from `./idb`, and replace every `openDb()` call with `openContentDb()` and every `STORE` reference with `DOCUMENTS_STORE`. **Do not change any other behaviour in `cache.ts`** — `replaceCachedDocuments` must still clear and rewrite only the `documents` store, never touch `private`.

## 2. `apps/web/src/content/private-store.ts` (new)

```ts
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
  /** Note stem -> markdown source. */
  notes: Record<string, string>;
  /** Asset stem -> blob (plan 0017 §4; unused until step 4). */
  assets: Record<string, Blob>;
  updatedAt: number;
}
```

Exported functions — all of them must degrade the same way `cache.ts` does, i.e. reads return empty rather than throwing:

| Function                                                               | Behaviour                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readPrivateBooks(): Promise<PrivateBookRecord[]>`                     | All records. Returns `[]` on any failure (mirror `readCachedDocuments`'s try/catch).                                                                                                        |
| `readPrivateBook(id: string): Promise<PrivateBookRecord \| undefined>` | One record by id; `undefined` on miss or failure.                                                                                                                                           |
| `putPrivateBook(record: PrivateBookRecord): Promise<void>`             | Upsert. Stamps `updatedAt: Date.now()` itself — callers do not supply it, so take `Omit<PrivateBookRecord, "updatedAt">`. Rejects on failure (a failed write must not look like a success). |
| `deletePrivateBook(id: string): Promise<void>`                         | Delete one record. Rejects on failure.                                                                                                                                                      |
| `clearPrivateBooks(): Promise<void>`                                   | Delete every record. **Only** `eraseAllData` may call this (step 6); nothing else. Say so in its doc comment.                                                                               |

Follow `cache.ts`'s existing transaction idiom exactly — `db.transaction(...)`, `tx.oncomplete`/`tx.onerror`/`tx.onabort`, `finally { db.close(); }`.

## 3. `apps/web/src/content/private-ids.ts` (new)

```ts
/**
 * Ids for private content (plan 0017 decision 4). A bare `crypto.randomUUID()`
 * — lowercase hex in hyphen-separated segments, so it satisfies `slugPattern`
 * (`packages/schema/src/entities.ts:7`) and needs no schema change; and since
 * it does not start with `user-`, it passes validate.ts's class (y) check
 * untouched. UUIDs rather than readable slugs because two people can author
 * private Books independently and swap the exported files — slugs collide
 * there, UUIDs do not.
 */
export function newPrivateId(): string {
  return crypto.randomUUID();
}
```

Nothing more. Do not add a prefix, a counter, or a readable-slug fallback.

## 4. Tests — `apps/web/src/content/private-ids.test.ts` (new)

jsdom has no IndexedDB and `cache.ts` has never been unit-tested for that reason. **Do not add `fake-indexeddb` or any other dependency.** Test only what is pure:

1. `newPrivateId()` returns a value matching `slugPattern` imported from `@betterbeaver/schema`. Assert over 100 generated ids, not one — hex segments can start with a digit and you want the regex proven against that.
2. `newPrivateId()` does not start with `"user-"` (the class (y) reservation it must stay clear of).
3. Two calls return different values.

If `slugPattern` is not exported from the schema package's index, export it — that is a legitimate part of this step.

The IndexedDB layer is verified in the browser at step 2, when there is something to read it with. Do not write tests that mock `indexedDB` by hand.

## Done criteria

1. `corepack pnpm check` green.
2. The three `private-ids` tests above pass.
3. **The migration is proven against an existing install, not just a fresh one.** In a browser via the `apps/web:verify` skill: load the app on `main` first so a v1 `bb-content` database exists with real cached documents, then load the branch and confirm (a) the app still opens, (b) the Kyrgyz/onboarding Book still loads from cache, (c) `indexedDB.open("bb-content").result.objectStoreNames` contains both `documents` and `private`, and (d) no `ConstraintError`/`VersionError` in the console. Report the console output.
4. Settings → "Refresh content" still works and still empties only `documents`.

## Out of scope

Everything else in plan 0017: reading private Books into the content source, the runtime asset overlay, `PrivateEditScreen`, the "Create a Book" card, export/import, the branched Remove confirm, and `eraseAllData` clearing the private store. Do not add UI. Do not modify `source.ts`, `bundled.ts`, `App.tsx`, any screen, or anything under `packages/` except a `slugPattern` re-export if one is needed.
