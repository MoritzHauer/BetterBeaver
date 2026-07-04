/**
 * SM-2 spaced-repetition scheduling.
 *
 * Pure, deterministic, no I/O: callers pass in `gradedAt` explicitly.
 * The grade-mapping constants and scheduling semantics below are pinned by
 * docs/plans/0001-content-schema-and-kyrgyz-slice.md and must not be altered.
 */

/** Per-item SM-2 state. `due` is an ISO 8601 UTC datetime string. */
export interface SrsState {
  due: string;
  intervalDays: number;
  ease: number;
  reps: number;
}

/** SM-2 quality rating, 0 (total blackout) to 5 (perfect recall). */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** Maps a recognize-task result to an SM-2 quality: wrong -> 2, correct -> 4. */
export function recognizeQuality(correct: boolean): Quality {
  return correct ? 4 : 2;
}

/** Self-grade used by recall tasks and all review sessions. */
export type SelfGrade = "again" | "hard" | "good";

/** Maps a recall self-grade to an SM-2 quality: again -> 2, hard -> 3, good -> 5. */
export function recallQuality(grade: SelfGrade): Quality {
  switch (grade) {
    case "again":
      return 2;
    case "hard":
      return 3;
    case "good":
      return 5;
  }
}

const MIN_EASE = 1.3;
const DAY_MS = 86_400_000;

/**
 * Computes the next SM-2 state for an item given its previous state (or
 * `null` if new), the quality of this grading, and the time it was graded.
 *
 * Pure: does not read the clock. `due` is the start of the UTC day of
 * `gradedAt` plus `intervalDays` days (day-granular).
 */
export function schedule(
  previous: SrsState | null,
  quality: Quality,
  gradedAt: Date,
): SrsState {
  const reps = previous?.reps ?? 0;
  const ease = previous?.ease ?? 2.5;
  const previousIntervalDays = previous?.intervalDays ?? 0;

  let nextReps: number;
  let nextIntervalDays: number;
  let nextEase: number;

  if (quality < 3) {
    nextReps = 1;
    nextIntervalDays = 1;
    nextEase = ease;
  } else {
    nextReps = reps + 1;
    if (nextReps === 1) {
      nextIntervalDays = 1;
    } else if (nextReps === 2) {
      nextIntervalDays = 6;
    } else {
      nextIntervalDays = Math.round(previousIntervalDays * ease);
    }
    const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    nextEase = Math.max(MIN_EASE, ease + delta);
  }

  const dayStart = Date.UTC(
    gradedAt.getUTCFullYear(),
    gradedAt.getUTCMonth(),
    gradedAt.getUTCDate(),
  );
  const due = new Date(dayStart + nextIntervalDays * DAY_MS).toISOString();

  return {
    due,
    intervalDays: nextIntervalDays,
    ease: nextEase,
    reps: nextReps,
  };
}

/**
 * True when `state` is due at `at`. An unparseable `due` counts as due, so
 * corrupted state resurfaces for review and gets repaired by the next grade
 * instead of being silently unreachable.
 */
export function isDue(state: SrsState, at: Date): boolean {
  const t = new Date(state.due).getTime();
  return Number.isNaN(t) || t <= at.getTime();
}
