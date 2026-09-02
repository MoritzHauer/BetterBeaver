/**
 * The session engine (plan 0025 §6): a queue that is asked for the next
 * question and told how the answer went, replacing the fixed array every
 * builder returned before.
 *
 * Pure and I/O-free like the rest of the engine. It holds no `Question`s —
 * only which scheduling unit is due for which slot — so the caller decides
 * when to build one, and a rebuild never reshuffles the plan.
 *
 * Named for plan 0024's `drill.ts`, which designed this loop for Focus mode
 * and was never built; unit practice and the Focus drill are two
 * configurations of it (§6).
 */
import type { Slot } from "./draw.js";

/** One planned appearance of one scheduling unit. */
export interface PlannedVisit {
  unitId: string;
  slot: Slot;
  /** How far the level has moved *within this session*, for the draw. */
  levelOffset: number;
}

export interface DrillState {
  queue: PlannedVisit[];
  /** Correct answers still owed, the number the learner is shown. */
  remaining: number;
  /** Scheduling units that have met their repetitions. */
  done: string[];
  /** Answers given, against the cap. */
  answers: number;
  cap: number;
  /** Misses per scheduling unit, which is what widens the reinsert gap. */
  misses: Record<string, number>;
}

/** How far ahead a missed unit is reinserted, by how many times it has been
 * missed. Plan 0024's rule: never immediately, because answering a card whose
 * answer is still on screen is recognition of a screen, not recall of a word. */
const REINSERT_GAPS = [2, 5, 10] as const;

/** Answers allowed per scheduling unit before the session gives up (§6). */
const CAP_PER_UNIT = 8;

/**
 * A session over `unitIds`, each owed `repetitions` correct answers.
 *
 * The first repetition of a word is its **new attempt** — the one that can
 * advance the level — and any further ones are repetitions around it, so a
 * one-repetition session (the Fast preset) is pure progression and a
 * three-repetition one (Careful) surrounds each stretch with consolidation.
 * Order is the caller's: it passes `unitIds` already shuffled.
 */
export function startDrill(
  unitIds: readonly string[],
  repetitions: number,
): DrillState {
  const queue: PlannedVisit[] = [];
  for (let n = 0; n < repetitions; n++) {
    for (const unitId of unitIds) {
      queue.push({
        unitId,
        slot: n === 0 ? "new" : "repetition",
        levelOffset: 0,
      });
    }
  }
  return {
    queue,
    remaining: unitIds.length * repetitions,
    done: [],
    answers: 0,
    cap: unitIds.length * CAP_PER_UNIT,
    misses: {},
  };
}

/** The next planned visit, or `null` when the session is over. */
export function nextVisit(state: DrillState): PlannedVisit | null {
  if (state.answers >= state.cap) {
    return null;
  }
  return state.queue[0] ?? null;
}

/**
 * The state after answering the current visit.
 *
 * `credited` is every scheduling unit the answer graded — one for most
 * questions, and **all of them for a matching board**, which grades up to
 * five words at once. Crediting the board's other words is what keeps the
 * remaining count honest: it says what actually happened on screen, and
 * without it a board would grade four words whose answers were then thrown
 * away and asked again.
 *
 * A correct answer decrements the count and drops that unit's next planned
 * visit; a wrong one **reinserts at an expanding gap and one level lower**
 * (§6), leaving the count untouched. So "10 to go" always means ten correct
 * answers to go, and a struggling session stalls rather than growing.
 */
export function advanceDrill(
  state: DrillState,
  credited: readonly { unitId: string; correct: boolean }[],
): DrillState {
  const current = state.queue[0];
  if (current === undefined) {
    return state;
  }
  let queue = state.queue.slice(1);
  let remaining = state.remaining;
  const done = [...state.done];
  const misses = { ...state.misses };

  for (const { unitId, correct } of credited) {
    if (correct) {
      // One credit pays off one owed answer. For the unit whose turn it was
      // that is the visit just consumed; for a board's other words it is
      // their next planned visit, which is dropped so the count and the
      // queue stay the same length.
      const index = queue.findIndex((visit) => visit.unitId === unitId);
      if (index >= 0) {
        queue = [...queue.slice(0, index), ...queue.slice(index + 1)];
        remaining -= 1;
      } else if (unitId === current.unitId) {
        remaining -= 1;
      }
      if (!queue.some((visit) => visit.unitId === unitId)) {
        done.push(unitId);
      }
      continue;
    }

    misses[unitId] = (misses[unitId] ?? 0) + 1;
    // A word that still has a planned visit is *moved* rather than given a
    // second one: the queue stays exactly as long as the count, and the
    // visit it comes back on is the lowered one. Without this a miss would
    // leave the word's next appearance sitting at its old level.
    const existing = queue.findIndex((visit) => visit.unitId === unitId);
    if (existing >= 0) {
      queue = [...queue.slice(0, existing), ...queue.slice(existing + 1)];
    }
    const gap =
      REINSERT_GAPS[
        Math.min((misses[unitId] ?? 1) - 1, REINSERT_GAPS.length - 1)
      ] ?? 10;
    const at = Math.min(gap, queue.length);
    queue = [
      ...queue.slice(0, at),
      {
        unitId,
        slot: "repetition",
        levelOffset: Math.min(current.levelOffset - 1, -1),
      },
      ...queue.slice(at),
    ];
  }

  return {
    ...state,
    queue,
    remaining: Math.max(remaining, 0),
    done,
    answers: state.answers + 1,
    misses,
  };
}

/**
 * The whole planned session, in order, as `startDrill` lays it out (§6).
 *
 * A session with no misses is fully determined before it starts — fixed
 * repetitions, known slots, levels read once — so the plan can be built up
 * front and handed to a caller that expects an array. `advanceDrill` is what
 * adapts it when an answer goes wrong; a caller using this instead gets
 * everything except that adaptation.
 */
export function plannedVisits(state: DrillState): readonly PlannedVisit[] {
  return state.queue;
}

/** Scheduling units that never met their repetitions before the cap (§6). */
export function unfinished(state: DrillState): string[] {
  return [...new Set(state.queue.map((visit) => visit.unitId))];
}

/** The exercise slot and in-session level for the next visit. */
export function visitLevel(visit: PlannedVisit, storedLevel: number): number {
  return Math.max(storedLevel + visit.levelOffset, 0);
}
