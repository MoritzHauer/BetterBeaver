import type { Item } from "@betterbeaver/schema";
import type { UserEntryStore } from "@betterbeaver/engine";
import { readJson } from "./local-storage";

const USERWORDS_PREFIX = "bb.userwords.";

/** Ids of learner-created entries are `user-<uuid>` (plan 0006): lowercase
 * hex + hyphens satisfies the slug pattern, and the validator reserves this
 * prefix so shipped content can never collide with one. */
export const USER_ENTRY_ID_PREFIX = "user-";

/** Mints a fresh learner-created entry id. */
export function newUserEntryId(): string {
  return `${USER_ENTRY_ID_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Creates a `UserEntryStore` backed by `localStorage`: each domain's
 * learner-created entries (plan 0006) are stored under
 * `bb.userwords.<domainId>` as a JSON array — same pattern as
 * `createLocalStorageVocabListStore`.
 */
export function createLocalStorageUserEntryStore(): UserEntryStore {
  const keyOf = (domainId: string) => `${USERWORDS_PREFIX}${domainId}`;
  const read = (domainId: string): Item[] =>
    readJson<Item[]>(keyOf(domainId)) ?? [];
  const write = (domainId: string, entries: Item[]) =>
    localStorage.setItem(keyOf(domainId), JSON.stringify(entries));

  return {
    getEntries(domainId: string): Promise<Item[]> {
      return Promise.resolve(read(domainId));
    },
    saveEntry(domainId: string, entry: Item): Promise<void> {
      const entries = read(domainId);
      const index = entries.findIndex((e) => e.id === entry.id);
      if (index === -1) {
        entries.push(entry);
      } else {
        // Editing keeps the id (plan 0006, pinned): overwriting in place is
        // what lets `bb.item.<id>` SRS state survive an edit.
        entries[index] = entry;
      }
      write(domainId, entries);
      return Promise.resolve();
    },
    deleteEntry(domainId: string, entryId: string): Promise<void> {
      write(
        domainId,
        read(domainId).filter((e) => e.id !== entryId),
      );
      return Promise.resolve();
    },
  };
}
