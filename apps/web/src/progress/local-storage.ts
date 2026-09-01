import type { SrsState } from "@betterbeaver/srs";
import type { ProgressStore, Streak } from "@betterbeaver/engine";

// Exported so callers that delete an item outright (e.g. removing a
// learner-created word, plan 0006) can drop its SRS state without going
// through `ProgressStore` (which has no delete method — items normally only
// ever get created or updated, never removed).
export const ITEM_STATE_PREFIX = "bb.item.";
const STREAK_PREFIX = "bb.streak.";
export const REPS_KEY = "bb.reps";

/** Parses JSON from `localStorage`, treating a corrupt/missing value — or a
 * blocked `localStorage` itself (`SecurityError`, e.g. private-browsing
 * storage restrictions) — as absent. */
export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/**
 * Creates a `ProgressStore` backed by `localStorage`. Per-scheduling-unit
 * state is stored under `bb.item.<itemId>`; the streak is per-domain (plan
 * 0006), under `bb.streak.<domainId>`.
 *
 * `bb.attempted` is no longer written or read: plan 0025 §8 derives
 * completion from the word levels instead. The key is deliberately not
 * deleted — it rides the `bb.*` backup sweep, so an existing export stays
 * importable, and nothing is lost by leaving it where it is.
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
