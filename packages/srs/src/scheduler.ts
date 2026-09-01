/**
 * Spaced repetition by word level (plan 0025).
 *
 * One stored number per word, its level 0–10, answers three questions at
 * once: how hard the next exercise about it may be, how long until it comes
 * back, and how far along the learner is. Difficulty climbs through the
 * first four levels while the word is still met daily; spacing takes over
 * once it can be produced.
 *
 * The level shares its scale with the exercise level table
 * (`EXERCISE_LEVEL`, plan 0025 §2): a word at level 6 is asked exercises up
 * to level 6. Which exercise a session actually draws is the engine's job —
 * this module only moves the number and reads the interval off it.
 *
 * Pure, deterministic, no I/O: callers pass in `gradedAt` and the scheduling
 * config explicitly. The grade-mapping constants are pinned by
 * docs/plans/archive/0001-content-schema-and-kyrgyz-slice.md and must not be
 * altered; classic SM-2's interval arithmetic is gone (plan 0025 §11).
 */

/** Per-scheduling-unit learner state. `due` is an ISO 8601 UTC datetime string. */
export interface SrsState {
  due: string;
  intervalDays: number;
  /**
   * Dead since plan 0025 §11 removed classic SM-2, the only thing that ever
   * read it. Kept on the type so that a backup written before then still
   * imports, and written as a constant so a card round-trips unchanged.
   */
  ease: number;
  /**
   * The **word level**, 0–10 (plan 0025 §1). Named `reps` because it is the
   * same field SM-2's repetition count and plan 0022's rung lived in, and
   * renaming it would strand every stored card and every exported backup.
   */
  reps: number;
  /**
   * The UTC day (`YYYY-MM-DD`) the level last advanced, which is what makes
   * the one-level-per-day guard possible (§5). Absent reads as "never" — for
   * a card that predates this plan, and for one that has never been right.
   */
  levelDay?: string;
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

const DAY_MS = 86_400_000;

/** The top of the scale, shared with the exercise level table (plan 0025
 * §2/§3) — a word at the top is asked the hardest exercise its content can
 * build. `packages/engine` pins the two against each other. */
export const MAX_WORD_LEVEL = 10;

/** The ease every card is written with. Nothing reads it (see `SrsState`);
 * it is held constant so a card's stored shape never drifts. */
const DEAD_EASE = 2.5;

/**
 * The first production level (plan 0025 §2/§5) — pick the foreign word for
 * an English prompt — and so the level at which a word stops being free to
 * climb inside one sitting.
 *
 * Levels 1–3 are `matching`, `recognize` and `listen`: every one of them
 * recognition, with the answer on screen, and recognising a word met a
 * minute ago is a legitimate outcome of having met it. So a new word climbs
 * to level 3 in its first sitting (§4), and two rules read this constant to
 * make that possible and to stop it going further — the day guard below,
 * which refuses a second *arrival* at or above this level on one UTC day,
 * and the practice-only rule in `packages/engine`, which lets a word under
 * this level advance again the same day even though it is not due.
 */
export const PRODUCTION_LEVEL = 4;

/** How far a wrong answer knocks a word back (plan 0025 §5): more than
 * Hard's one step, far less than plan 0022's reset to zero. The interval
 * falls with the level, so a failure at level 8 comes back in 8 days at
 * level 6 rather than in 30 — never at level 0. */
const WRONG_ANSWER_DROP = 2;

/** A `due` timestamp `days` after `from`, day-granular: the start of `from`'s
 * UTC day plus `days` days. The one place that arithmetic lives — the
 * scheduler and the Skip verb (plan 0022 §5) both go through it. */
export function dueAfter(days: number, from: Date): string {
  const dayStart = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  return new Date(dayStart + days * DAY_MS).toISOString();
}

/** The UTC day of `at` as `YYYY-MM-DD` — what `levelDay` stores, and the
 * same day granularity `dueAfter` schedules on. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Days until a word at each level comes back, one row per review pace (plan
 * 0025 §3, widened from plan 0022 §8's seven-rung ladder to the eleven
 * levels). Indexed by level, so `REVIEW_PACES.balanced[8]` is 30 days.
 *
 * Presets, not typed numbers: a named table is correct by construction,
 * where a free-text list needs validating for ascending order, positive
 * integers and a sane ceiling, and every one of those failures needs an
 * error surface.
 *
 * Index 0 is a day, not the "—" the plan's table prints: level 0 means "not
 * answered correctly yet", and a word in that state is due tomorrow like any
 * other fresh card. The first four entries barely move because difficulty,
 * not spacing, is what climbs there — a new word is met on days 1, 2, 3 and
 * 5, roughly three times plan 0022's contact in the first week, which is the
 * point for acquisition and also a materially larger daily queue while a
 * Book is being learned. The top level repeats forever: a word at the top
 * stays at the top.
 */
export const REVIEW_PACES = {
  thorough: [1, 1, 1, 1, 1, 3, 6, 10, 20, 45, 180],
  balanced: [1, 1, 1, 1, 2, 5, 8, 15, 30, 90, 365],
  light: [1, 1, 1, 1, 3, 7, 12, 25, 60, 150, 365],
} as const;

/** Review pace: how far apart the levels are spaced. */
export type ReviewPace = keyof typeof REVIEW_PACES;

/** Scheduling configuration — the learner-facing Learning settings, minus
 * the skip length (which never reaches the scheduler: skip pushes `due`
 * directly and leaves the level and interval untouched). */
export interface SchedulingConfig {
  pace: ReviewPace;
}

/** Balanced — what a learner who never opens Settings gets. */
export const DEFAULT_SCHEDULING: SchedulingConfig = { pace: "balanced" };

/**
 * Migration by interval (plan 0025 §11): the level whose interval is closest
 * to the one a card already carries, so nobody's schedule jumps on upgrade —
 * a card at 30 days becomes level 8, one at 1 day becomes level 1. Works for
 * cards written by either retired scheduler, since both wrote `intervalDays`.
 *
 * The scan starts at 1: level 0 is "never answered correctly", which a card
 * sitting in storage with an interval is not. Ties go to the lowest level,
 * which is what makes a re-derivation stable — the stored interval is always
 * its own level's interval, so a card that lands here twice lands on the
 * same answer both times.
 */
function levelFromInterval(intervalDays: number, pace: ReviewPace): number {
  const row = REVIEW_PACES[pace];
  let best = 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let level = 1; level <= MAX_WORD_LEVEL; level++) {
    const delta = Math.abs((row[level] ?? 1) - intervalDays);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = level;
    }
  }
  return best;
}

/**
 * A card's level, migrating one written before this plan. The one place a
 * stored `reps` is turned into a level — the session engine's exercise draw
 * (§4) and the unit progress bar (§8) read it through here too, so nobody
 * has to know that a card in storage might predate the plan.
 *
 * The marker is `levelDay`, and it works because **every** advance stamps it,
 * including the unguarded climb through levels 1–3: a card cannot reach a
 * level above 0 under this scheduler without one. So an absent `levelDay` on
 * a card whose stored number is above zero means that number is plan 0022's
 * rung or SM-2's repetition count, not a level, and the interval is the
 * thing to read it from.
 */
export function wordLevel(
  previous: SrsState | null,
  pace: ReviewPace = DEFAULT_SCHEDULING.pace,
): number {
  if (previous === null) {
    return 0;
  }
  if (previous.levelDay === undefined && previous.reps > 0) {
    return levelFromInterval(previous.intervalDays, pace);
  }
  return Math.min(Math.max(Math.trunc(previous.reps), 0), MAX_WORD_LEVEL);
}

/**
 * The next state for a scheduling unit, given its previous state (`null` if
 * new), the quality of this grading and the time it was graded.
 *
 * Good (quality >= 4) advances one level, subject to the day guard; Hard
 * (quality 3) steps back one; Again and every wrong auto-graded answer
 * (quality < 3) steps back two, floored at 0. Hard stepping back rather than
 * holding is plan 0022's rule kept: it cannot then be used as a promotion
 * shortcut, since Hard today and Good tomorrow return exactly the level you
 * were already on.
 *
 * Every one of those outcomes reads its interval off the resulting level —
 * there is no branch that pins a card to "tomorrow" independently of where
 * the level left it, which is what makes the level the single source of both
 * difficulty and timing.
 *
 * Pure: does not read the clock. `due` is the start of the UTC day of
 * `gradedAt` plus `intervalDays` days.
 */
export function schedule(
  previous: SrsState | null,
  quality: Quality,
  gradedAt: Date,
  config: SchedulingConfig = DEFAULT_SCHEDULING,
): SrsState {
  const level = wordLevel(previous, config.pace);
  const day = utcDay(gradedAt);

  let next: number;
  if (quality < 3) {
    next = Math.max(level - WRONG_ANSWER_DROP, 0);
  } else if (quality === 3) {
    next = Math.max(level - 1, 0);
  } else {
    const wanted = Math.min(level + 1, MAX_WORD_LEVEL);
    // The guard refuses a second *arrival* at or above the production
    // levels on the same day, however many times the word is answered.
    next =
      wanted >= PRODUCTION_LEVEL && previous?.levelDay === day ? level : wanted;
  }

  const intervalDays = REVIEW_PACES[config.pace][next] ?? 1;
  return {
    due: dueAfter(intervalDays, gradedAt),
    intervalDays,
    ease: DEAD_EASE,
    reps: next,
    levelDay: next > level ? day : previous?.levelDay,
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
