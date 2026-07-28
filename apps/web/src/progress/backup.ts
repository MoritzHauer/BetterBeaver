/**
 * Export/import of all learner data (plan 0006's durability floor): every
 * `bb.*` localStorage key round-trips through a downloadable JSON file. No
 * versioning, no partial import, no schema validation beyond "an object
 * keyed by `bb.*` strings" — real sync is a later milestone, this is just
 * the floor.
 *
 * Private Books ride along under the single `privateBooks` key (same payload
 * as a `.bbbook` export). They are the one thing here that exists nowhere
 * else, so "export before you erase" was a false promise without them. The
 * key sits outside the `bb.*` namespace both loops filter on, so old app
 * versions ignore it and old backup files simply lack it.
 */
import {
  putPrivateBook,
  readPrivateBooks,
  clearPrivateBooks,
} from "../content/private-store";
import {
  privateBookExportFile,
  readPrivateBookFile,
} from "../content/private-transfer";
import { clearCachedDocuments } from "../content/cache";

/** Every `bb.*` localStorage key and its raw (already-JSON-stringified) value. */
function readAllBbKeys(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("bb.")) {
      data[key] = localStorage.getItem(key) ?? "";
    }
  }
  return data;
}

/** Downloads every `bb.*` localStorage key plus every private Book as a JSON file. */
export async function exportBackup(): Promise<void> {
  const privateBooks = await Promise.all(
    (await readPrivateBooks()).map(privateBookExportFile),
  );
  const file = { ...readAllBbKeys(), privateBooks };
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `betterbeaver-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Restores learner data from an exported JSON file: first deletes every
 * existing `bb.*` key, then writes the file's keys — a true restore, no
 * stale leftovers. The caller is responsible for confirming with the
 * learner first, since this unconditionally wipes current data.
 *
 * The private-Book half deliberately diverges: it upserts and never deletes,
 * so restoring an old backup cannot destroy a Book authored since. That
 * leaves ids in the store whose membership the restored `bb.mybooks` no
 * longer lists — harmless (they're unloaded, and Archive lists them), and
 * strictly better than the alternative, since `eraseAllData` is the only
 * path allowed to delete private records (`content/private-store.ts`).
 * Restored Books are not validated: a Book that fails validation is exactly
 * the one you most need back so you can fix it in the editor. The one thing
 * that can still reject an entry is a `schemaVersion` newer than this app
 * (`checkImportFileShape`) — those are counted and returned so the caller can
 * say so, since silently dropping a Book is the one failure this whole
 * durability floor exists to prevent.
 */
export async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text()) as Record<string, unknown>;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("bb.")) {
      localStorage.removeItem(key);
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("bb.") && typeof value === "string") {
      localStorage.setItem(key, value);
    }
  }
  const privateBooks = Array.isArray(data.privateBooks)
    ? (data.privateBooks as unknown[])
    : [];
  let skipped = 0;
  for (const entry of privateBooks) {
    const parsed = await readPrivateBookFile(entry);
    if (parsed.ok) {
      await putPrivateBook({
        id: parsed.bookId,
        book: parsed.book,
        domain: parsed.domain,
        assets: parsed.assets,
      });
    } else {
      skipped += 1;
    }
  }
  return skipped;
}

/**
 * The nuclear "Erase all my data" action (Settings › Danger): drops every
 * `bb.*` key (progress, settings, author drafts), the content cache, and the
 * private-Book store (plan 0017 §6) — this is the one sweep allowed to take
 * private Books with it, since it's already the explicit "erase everything"
 * action behind its own confirm, and it's the one thing here that can't be
 * re-downloaded afterwards. The caller must confirm and nudge an export
 * first; this wipes unconditionally and touches nothing on the backend.
 */
export async function eraseAllData(): Promise<void> {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("bb.")) {
      localStorage.removeItem(key);
    }
  }
  await clearCachedDocuments();
  await clearPrivateBooks();
}
