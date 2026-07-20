/**
 * Learner stats, gathered from on-device state only (no backend, nothing
 * synced — the Stats page is a private local view). The creator card is the
 * one exception and is fetched separately, live, by the Stats screen.
 */
import { combinedStreak, localDay, type Streak } from "@betterbeaver/engine";
import { bundledDomainIds } from "./content/bundled";
import {
  createLocalStorageVocabListStore,
  SAVED_LIST_ID,
} from "./progress/vocab-lists";
import {
  ITEM_STATE_PREFIX,
  REPS_KEY,
  readJson,
} from "./progress/local-storage";

const STREAK_PREFIX = "bb.streak.";

export interface DomainStreak {
  domainId: string;
  length: number;
}

export interface LearnerStats {
  /** Unified daily streak across all domains (interval-union of per-domain runs). */
  streak: number;
  /** Per-domain streaks that are non-zero, for the breakdown. */
  domainStreaks: DomainStreak[];
  /** Lifetime graded answers (climbs on every answer, repeats included). */
  reps: number;
  /** Distinct tasks ever attempted. */
  tasks: number;
  /** Items with SM-2 scheduling state (in the review system). */
  itemsInReview: number;
  /** Words in the "Saved words" lists across all domains. */
  wordsSaved: number;
}

async function gatherWordsSaved(domainIds: string[]): Promise<number> {
  const store = createLocalStorageVocabListStore();
  let total = 0;
  for (const domainId of domainIds) {
    const lists = await store.getLists(domainId);
    const saved = lists.find((l) => l.id === SAVED_LIST_ID);
    total += saved?.itemIds.length ?? 0;
  }
  return total;
}

export async function gatherStats(now: Date): Promise<LearnerStats> {
  const domainIds = bundledDomainIds();

  const domainStreaks: DomainStreak[] = [];
  const streaks: Streak[] = [];
  for (const domainId of domainIds) {
    const streak = readJson<Streak>(`${STREAK_PREFIX}${domainId}`);
    if (streak !== null) {
      streaks.push(streak);
      domainStreaks.push({ domainId, length: streak.length });
    }
  }

  const itemsInReview = Object.keys(localStorage).filter((k) =>
    k.startsWith(ITEM_STATE_PREFIX),
  ).length;

  return {
    streak: combinedStreak(streaks, localDay(now)),
    domainStreaks: domainStreaks.sort((a, b) => b.length - a.length),
    reps: readJson<number>(REPS_KEY) ?? 0,
    tasks: (readJson<string[]>("bb.attempted") ?? []).length,
    itemsInReview,
    wordsSaved: await gatherWordsSaved(domainIds),
  };
}
