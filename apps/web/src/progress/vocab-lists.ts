import type { VocabList, VocabListStore } from "@betterbeaver/engine";
import { readJson } from "./local-storage";

const LISTS_PREFIX = "bb.vocablists.";

/** Reserved id of the built-in "Saved words" list (plan 0006): auto-created,
 * undeletable, one-tap save appends to it idempotently. */
export const SAVED_LIST_ID = "saved";
const SAVED_LIST_NAME = "Saved words";

/**
 * Idempotently appends `itemId` to the domain's "Saved words" list (plan
 * 0006's one-tap save action, shared by the Vocabulary screen's "My words"
 * row and the tap-to-lookup popup so neither reimplements the
 * find-or-create-then-append logic). Reads current lists fresh off `store`
 * rather than relying on caller-held state, so it's safe to call from
 * anywhere. Returns the resulting list.
 */
export async function saveWordToSavedList(
  store: VocabListStore,
  domainId: string,
  itemId: string,
): Promise<VocabList> {
  const lists = await store.getLists(domainId);
  const saved = lists.find((l) => l.id === SAVED_LIST_ID) ?? {
    id: SAVED_LIST_ID,
    name: SAVED_LIST_NAME,
    itemIds: [],
  };
  if (saved.itemIds.includes(itemId)) {
    return saved;
  }
  const updated: VocabList = {
    ...saved,
    itemIds: [...saved.itemIds, itemId],
  };
  await store.saveList(domainId, updated);
  return updated;
}

/**
 * Creates a `VocabListStore` backed by `localStorage`: each domain's lists
 * (plan 0006: re-scoped from book) are stored under
 * `bb.vocablists.<domainId>` as a JSON array.
 */
export function createLocalStorageVocabListStore(): VocabListStore {
  const keyOf = (domainId: string) => `${LISTS_PREFIX}${domainId}`;
  const read = (domainId: string): VocabList[] =>
    readJson<VocabList[]>(keyOf(domainId)) ?? [];
  const write = (domainId: string, lists: VocabList[]) =>
    localStorage.setItem(keyOf(domainId), JSON.stringify(lists));

  return {
    getLists(domainId: string): Promise<VocabList[]> {
      const lists = read(domainId);
      // Auto-create "Saved words" on first read (plan 0006, pinned): no
      // migration needed, it's just conjured into the returned set whenever
      // it isn't already there.
      if (!lists.some((l) => l.id === SAVED_LIST_ID)) {
        lists.unshift({
          id: SAVED_LIST_ID,
          name: SAVED_LIST_NAME,
          itemIds: [],
        });
      }
      return Promise.resolve(lists);
    },
    saveList(domainId: string, list: VocabList): Promise<void> {
      const lists = read(domainId);
      const index = lists.findIndex((l) => l.id === list.id);
      if (index === -1) {
        lists.push(list);
      } else {
        lists[index] = list;
      }
      write(domainId, lists);
      return Promise.resolve();
    },
    deleteList(domainId: string, listId: string): Promise<void> {
      // "Saved words" is undeletable (plan 0006, pinned) — a no-op guard
      // here, belt-and-suspenders alongside the UI hiding its Delete button.
      if (listId === SAVED_LIST_ID) {
        return Promise.resolve();
      }
      write(
        domainId,
        read(domainId).filter((l) => l.id !== listId),
      );
      return Promise.resolve();
    },
  };
}
