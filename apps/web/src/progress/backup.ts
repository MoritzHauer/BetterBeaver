/**
 * Export/import of all learner data (plan 0006's durability floor): every
 * `bb.*` localStorage key round-trips through a downloadable JSON file. No
 * versioning, no partial import, no schema validation beyond "an object
 * keyed by `bb.*` strings" — real sync is a later milestone, this is just
 * the floor.
 */

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

/** Downloads every `bb.*` localStorage key as a JSON file. */
export function exportBackup(): void {
  const blob = new Blob([JSON.stringify(readAllBbKeys(), null, 2)], {
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
 */
export async function importBackup(file: File): Promise<void> {
  const data = JSON.parse(await file.text()) as Record<string, string>;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("bb.")) {
      localStorage.removeItem(key);
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("bb.")) {
      localStorage.setItem(key, value);
    }
  }
}
