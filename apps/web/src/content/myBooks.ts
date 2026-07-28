/**
 * My Books membership (plan 0015 decisions 2/3/9/12): which Books the
 * learner has added or archived, stored as ordered id arrays in
 * `localStorage`. Insertion order is normative — it's the tie-break for a
 * cross-Book collision at boot (`createDocumentContentSource`'s "earliest
 * wins", plan 0015 decision 11a). A Book id lives in at most one of the two
 * lists.
 *
 * Absence of the `bb.mybooks` key (not an empty array) is the first-run
 * signal (decisions 9/12): every existing install hits the pre-add-and-purge
 * path in `content/source.ts` exactly once.
 */

import { noteStorageUnwritable } from "../storage-health";

const MYBOOKS_KEY = "bb.mybooks";
const ARCHIVED_KEY = "bb.mybooks.archived";

function readIds(key: string): string[] {
  // `getItem` inside the try, like `progress/local-storage.ts`'s `readJson`
  // (spec 0019 §1): blocked storage is "absent", not a crash.
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Unwritable storage must not brick boot: `initMembership` runs inside
    // `initContentSource()`, whose promise `main.tsx` awaits before its only
    // `createRoot(...).render(...)` — an escaping throw left a blank page
    // with no error screen. Membership then lives for this session only,
    // and the learner is told: Add/Archive/Remove/Restore all land here, so
    // one report covers every membership write, including the boot one that
    // happens before React mounts.
    noteStorageUnwritable();
  }
}

/** True before the membership key has ever been written — the first-run signal (decisions 9/12). */
export function isFirstRun(): boolean {
  try {
    return localStorage.getItem(MYBOOKS_KEY) === null;
  } catch {
    // Can't tell — answer "not first run", the non-destructive side. Saying
    // `true` would run `initContentSource`'s seed-and-purge path against a
    // membership list that `writeIds` just failed to persist, and
    // `purgeUnmembered` would drop every cached document as unmembered.
    return false;
  }
}

export function readMyBooks(): string[] {
  return readIds(MYBOOKS_KEY);
}

export function readArchived(): string[] {
  return readIds(ARCHIVED_KEY);
}

/** First-run initialization (decision 9): writes both lists outright. */
export function initMembership(added: string[], archived: string[]): void {
  writeIds(MYBOOKS_KEY, added);
  writeIds(ARCHIVED_KEY, archived);
}

/** Appends to the front (added) list — Add and Restore both land here in add order. */
export function addToMyBooks(bookId: string): void {
  const ids = readMyBooks();
  if (!ids.includes(bookId)) {
    writeIds(MYBOOKS_KEY, [...ids, bookId]);
  }
}

/** Drops `bookId` from both lists (Remove). */
export function removeFromMembership(bookId: string): void {
  writeIds(
    MYBOOKS_KEY,
    readMyBooks().filter((id) => id !== bookId),
  );
  writeIds(
    ARCHIVED_KEY,
    readArchived().filter((id) => id !== bookId),
  );
}

/** Moves `bookId` from the added list to the archived list (Archive). */
export function archiveInMembership(bookId: string): void {
  writeIds(
    MYBOOKS_KEY,
    readMyBooks().filter((id) => id !== bookId),
  );
  const archived = readArchived();
  if (!archived.includes(bookId)) {
    writeIds(ARCHIVED_KEY, [...archived, bookId]);
  }
}

/** Moves `bookId` from the archived list back to the added list, at the end (Restore). */
export function restoreInMembership(bookId: string): void {
  writeIds(
    ARCHIVED_KEY,
    readArchived().filter((id) => id !== bookId),
  );
  addToMyBooks(bookId);
}
