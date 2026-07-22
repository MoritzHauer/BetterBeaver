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

const MYBOOKS_KEY = "bb.mybooks";
const ARCHIVED_KEY = "bb.mybooks.archived";

function readIds(key: string): string[] {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  localStorage.setItem(key, JSON.stringify(ids));
}

/** True before the membership key has ever been written — the first-run signal (decisions 9/12). */
export function isFirstRun(): boolean {
  return localStorage.getItem(MYBOOKS_KEY) === null;
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
