/**
 * Learner stats, gathered from on-device state only (no backend, nothing
 * synced — the Stats page is a private local view). The creator card is the
 * one exception and is fetched separately, live, by the Stats screen.
 */
import { combinedStreak, localDay, type Streak } from "@betterbeaver/engine";
import { PRODUCTION_LEVEL, type SrsState } from "@betterbeaver/srs";
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
  /** Items with SM-2 scheduling state (in the review system). */
  itemsInReview: number;
  /** Words in the "Saved words" lists across all domains. */
  wordsSaved: number;
  /**
   * Where the learner's words stand right now, and what is coming. Every
   * lifetime total above answers "how much have I ever done"; none of them
   * can answer "am I getting anywhere", because none carries a time axis —
   * and `LearnerStats` stores no dated data to give one (ui-review
   * 2026-09-13, finding st-vanity). These are derived instead from the SRS
   * state already on the device, so they are populated on day one and need
   * no new write path.
   */
  mastery: MasteryBreakdown;
  /** Reviews falling due on each of the next seven days, today first. */
  dueNext7: number[];
}

/** Word levels are 0-10 (plan 0025 §1). Below PRODUCTION_LEVEL the learner is
 * still being shown the word; at or above it they are being asked to produce
 * it, which is the step that makes "learning" into "known". `mature` is the
 * top of the ladder, where intervals run in months. */
export interface MasteryBreakdown {
  learning: number;
  known: number;
  mature: number;
}

const MATURE_INTERVAL_DAYS = 21;

/** `Object.keys(localStorage)`, but blocked storage (`SecurityError`) degrades
 * to `[]` instead of throwing — same "absent, not a crash" treatment as
 * `readJson`. */
function storageKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
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

  const itemKeys = storageKeys().filter((k) => k.startsWith(ITEM_STATE_PREFIX));

  const mastery: MasteryBreakdown = { learning: 0, known: 0, mature: 0 };
  const dueNext7 = [0, 0, 0, 0, 0, 0, 0];
  const todayMs = new Date(localDay(now)).getTime();
  for (const key of itemKeys) {
    const state = readJson<SrsState>(key);
    if (state === null) {
      continue;
    }
    if (state.intervalDays >= MATURE_INTERVAL_DAYS) {
      mastery.mature += 1;
    } else if (state.reps >= PRODUCTION_LEVEL) {
      mastery.known += 1;
    } else {
      mastery.learning += 1;
    }
    // `due` is a YYYY-MM-DD day, like `localDay` — so this is a whole-day
    // difference, and anything overdue lands in today's bucket.
    const days = Math.round(
      (new Date(state.due).getTime() - todayMs) / 86_400_000,
    );
    const bucket = Math.max(0, days);
    if (bucket < dueNext7.length) {
      dueNext7[bucket] = (dueNext7[bucket] ?? 0) + 1;
    }
  }

  return {
    streak: combinedStreak(streaks, localDay(now)),
    domainStreaks: domainStreaks.sort((a, b) => b.length - a.length),
    reps: readJson<number>(REPS_KEY) ?? 0,
    itemsInReview: itemKeys.length,
    wordsSaved: await gatherWordsSaved(domainIds),
    mastery,
    dueNext7,
  };
}
