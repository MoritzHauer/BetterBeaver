import type { VocabList, VocabListStore } from "@betterbeaver/engine";
import { readJson } from "./local-storage";

const LISTS_PREFIX = "bb.vocablists.";

/**
 * Creates a `VocabListStore` backed by `localStorage` (plan 0004): each
 * topic's lists are stored under `bb.vocablists.<topicId>` as a JSON array.
 */
export function createLocalStorageVocabListStore(): VocabListStore {
  const keyOf = (topicId: string) => `${LISTS_PREFIX}${topicId}`;
  const read = (topicId: string): VocabList[] =>
    readJson<VocabList[]>(keyOf(topicId)) ?? [];
  const write = (topicId: string, lists: VocabList[]) =>
    localStorage.setItem(keyOf(topicId), JSON.stringify(lists));

  return {
    getLists(topicId: string): Promise<VocabList[]> {
      return Promise.resolve(read(topicId));
    },
    saveList(topicId: string, list: VocabList): Promise<void> {
      const lists = read(topicId);
      const index = lists.findIndex((l) => l.id === list.id);
      if (index === -1) {
        lists.push(list);
      } else {
        lists[index] = list;
      }
      write(topicId, lists);
      return Promise.resolve();
    },
    deleteList(topicId: string, listId: string): Promise<void> {
      write(
        topicId,
        read(topicId).filter((l) => l.id !== listId),
      );
      return Promise.resolve();
    },
  };
}
