import type { SrsState } from "@betterbeaver/srs";
import type { ProgressStore } from "@betterbeaver/engine";

const ITEM_STATE_PREFIX = "bb.item.";
const ATTEMPTED_KEY = "bb.attempted";

/** Parses JSON from `localStorage`, treating a corrupt/missing value as absent. */
function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Creates a `ProgressStore` backed by `localStorage`. Per-item SM-2 state
 * is stored under `bb.item.<itemId>`; the set of attempted task ids is
 * stored under `bb.attempted` as a JSON string array.
 */
export function createLocalStorageProgressStore(): ProgressStore {
  return {
    getItemState(itemId: string): Promise<SrsState | null> {
      return Promise.resolve(
        readJson<SrsState>(`${ITEM_STATE_PREFIX}${itemId}`),
      );
    },
    setItemState(itemId: string, state: SrsState): Promise<void> {
      localStorage.setItem(
        `${ITEM_STATE_PREFIX}${itemId}`,
        JSON.stringify(state),
      );
      return Promise.resolve();
    },
    getAttemptedTaskIds(): Promise<string[]> {
      return Promise.resolve(readJson<string[]>(ATTEMPTED_KEY) ?? []);
    },
    markTaskAttempted(taskId: string): Promise<void> {
      const attempted = new Set(readJson<string[]>(ATTEMPTED_KEY) ?? []);
      attempted.add(taskId);
      localStorage.setItem(ATTEMPTED_KEY, JSON.stringify([...attempted]));
      return Promise.resolve();
    },
  };
}
