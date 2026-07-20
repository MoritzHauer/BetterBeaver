import type { SrsState } from "@betterbeaver/srs";
import type { ProgressStore, Streak } from "@betterbeaver/engine";

// Exported so callers that delete an item outright (e.g. removing a
// learner-created word, plan 0006) can drop its SRS state without going
// through `ProgressStore` (which has no delete method — items normally only
// ever get created or updated, never removed).
export const ITEM_STATE_PREFIX = "bb.item.";
const ATTEMPTED_KEY = "bb.attempted";
const STREAK_PREFIX = "bb.streak.";
export const REPS_KEY = "bb.reps";

/** Parses JSON from `localStorage`, treating a corrupt/missing value as absent. */
export function readJson<T>(key: string): T | null {
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
 * stored under `bb.attempted` as a JSON string array; the streak is
 * per-domain (plan 0006), under `bb.streak.<domainId>`.
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
    getStreak(domainId: string): Promise<Streak | null> {
      return Promise.resolve(readJson<Streak>(`${STREAK_PREFIX}${domainId}`));
    },
    setStreak(domainId: string, streak: Streak): Promise<void> {
      localStorage.setItem(
        `${STREAK_PREFIX}${domainId}`,
        JSON.stringify(streak),
      );
      return Promise.resolve();
    },
    incrementReps(): Promise<void> {
      localStorage.setItem(
        REPS_KEY,
        String((readJson<number>(REPS_KEY) ?? 0) + 1),
      );
      return Promise.resolve();
    },
  };
}
