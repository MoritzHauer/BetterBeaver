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

/** The pre-0025 attempted-task set, minted here only. */
const LEGACY_ATTEMPTED_KEY = "bb.attempted";

/**
 * The attempted-task ids this device recorded before plan 0025 §8 moved
 * completion onto the word levels — **read, never written** (plan 0026 §4).
 *
 * The level rule is stricter than the one it replaced twice over: it wants
 * every word of the unit, and it wants them answered *correctly*. So a
 * learner mid-Book could watch finished units flip back to unfinished and
 * gates re-lock, having done nothing wrong. This is what
 * `unitProgressByBook` ORs in to stop that, in the repo's presence-based,
 * self-erasing shape (plan 0006): nothing writes the key again, and it ages
 * out as content is re-studied.
 *
 * A missing, corrupt or blocked value reads as the empty set, which simply
 * means no grandfathering — the same "failed reads degrade to absent" rule
 * every other read here follows (spec 0019 decision 2).
 */
export function readLegacyAttemptedTaskIds(): ReadonlySet<string> {
  const stored = readJson<unknown>(LEGACY_ATTEMPTED_KEY);
  if (!Array.isArray(stored)) {
    return new Set();
  }
  return new Set(stored.filter((id): id is string => typeof id === "string"));
}

/**
 * Creates a `ProgressStore` backed by `localStorage`. Per-scheduling-unit
 * state is stored under `bb.item.<itemId>`; the streak is per-domain (plan
 * 0006), under `bb.streak.<domainId>`.
 *
 * `bb.attempted` is never written: plan 0025 §8 derives completion from the
 * word levels instead. It is still *read*, by
 * `readLegacyAttemptedTaskIds` above, and deliberately not deleted — it
 * rides the `bb.*` backup sweep, so an existing export stays importable.
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
