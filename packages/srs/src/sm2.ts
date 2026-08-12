/**
 * Spaced-repetition scheduling: the interval ladder (plan 0022, default) and
 * classic SM-2 (still selectable).
 *
 * Pure, deterministic, no I/O: callers pass in `gradedAt` and the scheduling
 * config explicitly. The grade-mapping constants and the SM-2 branch's
 * semantics are pinned by
 * docs/plans/archive/0001-content-schema-and-kyrgyz-slice.md and must not be altered.
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

/** A `due` timestamp `days` after `from`, day-granular: the start of `from`'s
 * UTC day plus `days` days. The one place that arithmetic lives — both
 * schedulers and the Skip verb (plan 0022 §5) go through it. */
export function dueAfter(days: number, from: Date): string {
  const dayStart = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  return new Date(dayStart + days * DAY_MS).toISOString();
}

/**
 * Interval ladders, one per review pace (plan 0022 §8). Presets, not typed
 * numbers: a named table is correct by construction, where a free-text list
 * needs validating for ascending order, positive integers and a sane
 * ceiling, and every one of those failures needs an error surface.
 *
 * The last rung repeats forever — a card at the top stays at the top.
 */
export const REVIEW_PACES = {
  thorough: [1, 3, 8, 20, 45, 90, 180],
  balanced: [1, 5, 15, 30, 90, 180, 365],
  light: [1, 7, 21, 60, 150, 300, 365],
} as const;

/** Review pace: which ladder the scheduler climbs. */
export type ReviewPace = keyof typeof REVIEW_PACES;

/** Which scheduler computes the next interval. */
export type SchedulerKind = "ladder" | "sm2";

/** Scheduling configuration — the learner-facing Learning settings, minus
 * the skip length (which never reaches the scheduler: skip pushes `due`
 * directly and leaves rung, ease and interval untouched). */
export interface SchedulingConfig {
  scheduler: SchedulerKind;
  pace: ReviewPace;
}

/** Ladder on Balanced — what a learner who never opens Settings gets. */
export const DEFAULT_SCHEDULING: SchedulingConfig = {
  scheduler: "ladder",
  pace: "balanced",
};

/**
 * The ladder branch (plan 0022 §1). `reps` carries the rung; `ease` is
 * carried through untouched, which is what keeps classic SM-2 losslessly
 * selectable — a card holds both schedulers' state at all times.
 *
 * Good (quality >= 4) advances one rung, Hard (quality 3) steps back one and
 * re-asks tomorrow, Again (quality < 3) resets to rung 0 and re-asks
 * tomorrow. Hard steps back rather than holding, so it cannot be used as a
 * promotion shortcut (Hard today + Good tomorrow returns you to exactly the
 * interval you were already on).
 *
 * An existing SM-2 card's repetition count becomes its rung on the first
 * graded answer after the switch, clamped to the top rung — accepted as-is
 * (plan 0022 §3), not a bug.
 */
function scheduleLadder(
  previous: SrsState | null,
  quality: Quality,
  pace: ReviewPace,
): { reps: number; intervalDays: number } {
  const ladder = REVIEW_PACES[pace];
  const top = ladder.length - 1;
  const rung = Math.min(Math.max(previous?.reps ?? 0, 0), top);

  if (quality < 3) {
    return { reps: 0, intervalDays: 1 };
  }
  if (quality === 3) {
    return { reps: Math.max(rung - 1, 0), intervalDays: 1 };
  }
  const next = Math.min(rung + 1, top);
  // The clamp above puts `next` in range; `?? 1` is `noUncheckedIndexedAccess`
  // paperwork, not a reachable branch.
  return { reps: next, intervalDays: ladder[next] ?? 1 };
}

/**
 * Computes the next state for an item given its previous state (or `null` if
 * new), the quality of this grading, and the time it was graded. `config`
 * selects the scheduler and (under the ladder) the pace; omitting it is the
 * shipped default, ladder on Balanced.
 *
 * Pure: does not read the clock. `due` is the start of the UTC day of
 * `gradedAt` plus `intervalDays` days (day-granular), under both schedulers.
 */
export function schedule(
  previous: SrsState | null,
  quality: Quality,
  gradedAt: Date,
  config: SchedulingConfig = DEFAULT_SCHEDULING,
): SrsState {
  const reps = previous?.reps ?? 0;
  const ease = previous?.ease ?? 2.5;
  const previousIntervalDays = previous?.intervalDays ?? 0;

  let nextReps: number;
  let nextIntervalDays: number;
  let nextEase: number;

  if (config.scheduler === "ladder") {
    const next = scheduleLadder(previous, quality, config.pace);
    nextReps = next.reps;
    nextIntervalDays = next.intervalDays;
    nextEase = ease;
  } else if (quality < 3) {
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

  return {
    due: dueAfter(nextIntervalDays, gradedAt),
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
