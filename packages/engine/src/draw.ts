/**
 * Which exercise a word is asked as, and which exercises its content can
 * build at all (plan 0025 §4, §9).
 *
 * Pure and content-only: the caller passes the word's level in, so nothing
 * here reads progress. `session.ts` turns the answer into a `Question`.
 */
import type { Content, Exercise, Item } from "@betterbeaver/schema";
import {
  EXERCISE_LEVEL,
  MAX_EXERCISE_LEVEL,
  MIN_EXERCISE_LEVEL,
  TASK_EXERCISES,
} from "@betterbeaver/schema";
import {
  constructibleExercises,
  owningUnit,
  promptIsUnique,
} from "./construct.js";
import { shuffle, type Rng } from "./rng.js";

/**
 * The two slots an appearance fills (plan 0025 §4). A `repetition` draws
 * from levels the word has already passed; a `new` attempt sits one above,
 * and getting it right is the only thing that advances the level.
 */
export type Slot = "repetition" | "new";

/**
 * The exercises `item`'s own unit **authored** a task for, plus the two
 * derived from content that never authored them (plan 0025 §9).
 *
 * Unranked exercises are excluded — `shadowing` checks nothing, so it can
 * neither be drawn to advance a word nor stand in for one that would.
 */
export function authoredExercises(
  item: Item,
  content: Content,
): readonly Exercise[] {
  const unit = owningUnit(item.id, content);
  const found = new Set<Exercise>();

  if (unit !== undefined) {
    const taskById = new Map(content.tasks.map((task) => [task.id, task]));
    for (const taskId of unit.taskIds) {
      const task = taskById.get(taskId);
      if (task === undefined || !task.itemIds.includes(item.id)) {
        continue;
      }
      for (const exercise of TASK_EXERCISES[task.type]) {
        found.add(exercise);
      }
    }
  }

  // `write` is authored by nobody: any lexeme or concept can be typed from
  // its meaning, which is what makes level 9 reachable on published content.
  if (item.kind === "lexeme" || item.kind === "concept") {
    found.add("write");
  }

  if (found.has("recognize-produce") && !promptIsUnique(item, content)) {
    found.delete("recognize-produce");
  }

  return [...found].filter((exercise) => EXERCISE_LEVEL[exercise] !== null);
}

/**
 * Every exercise `item` can actually be asked as — what the draw chooses
 * from.
 *
 * For a Book that has opted into generated exercises (plan 0026 §9), that is
 * the authored set **union** what the constructor can build; for every other
 * Book it is the authored set alone, so nothing about a shipped Book's
 * exercise mix changes on the day this lands.
 *
 * The union is a *lookup* rule, not a session-construction rule (§ slice 2):
 * it widens which exercise can fill a slot, never how many slots there are —
 * length is still word count times the Progression preset (0025 §6). Which
 * of the two answers a given cell is settled per (item, level) in
 * `buildExerciseQuestion`, where an authored task wins over a constructed
 * one at the same level (§3).
 */
export function availableExercises(
  item: Item,
  content: Content,
): readonly Exercise[] {
  const authored = authoredExercises(item, content);
  if (content.topic.generatedExercises !== true) {
    return authored;
  }
  return [...new Set([...authored, ...constructibleExercises(item, content)])];
}

/** The subset of `available` sitting at exactly `level`. */
function atLevel(
  available: readonly Exercise[],
  level: number,
): readonly Exercise[] {
  return available.filter((exercise) => EXERCISE_LEVEL[exercise] === level);
}

/**
 * The exercise to ask `item` as, given the word's `level` and which `slot`
 * this appearance fills (plan 0025 §4). `null` when the content can build
 * nothing usable — a caller with no exercise has no question to show.
 *
 * **New attempt**: exactly `level + 1`, and *a missing level is skipped, not
 * waited for* — a Book with no audio has nothing at level 3, and a word that
 * stalled there could never reach 100%, so the search walks upward to the
 * next level the content can build.
 *
 * **Repetition**: a random draw from `{level - 1, level}`, floored at the
 * first real level. Random within the window is what stops the same word
 * coming back as the same exercise; the window is narrow so it stays a
 * consolidation rather than a trip to the bottom of the ladder. When the
 * content can build nothing in the window (gaps again), it falls back to the
 * highest available level below the window, then to the lowest available
 * exercise overall — a word is never skipped for want of an exact match.
 */
export function drawExercise(
  level: number,
  slot: Slot,
  available: readonly Exercise[],
  rng: Rng,
): Exercise | null {
  if (available.length === 0) {
    return null;
  }
  const pick = (from: readonly Exercise[]): Exercise | null =>
    from.length === 0 ? null : (shuffle([...from], rng)[0] ?? null);

  if (slot === "new") {
    for (let want = level + 1; want <= MAX_EXERCISE_LEVEL; want++) {
      const chosen = pick(atLevel(available, want));
      if (chosen !== null) {
        return chosen;
      }
    }
    // Already at the ceiling, or nothing above: the top available exercise
    // is still the hardest thing this content can ask.
    return pick(
      available.filter(
        (exercise) => (EXERCISE_LEVEL[exercise] ?? 0) === topLevel(available),
      ),
    );
  }

  const high = Math.max(level, MIN_EXERCISE_LEVEL);
  const low = Math.max(level - 1, MIN_EXERCISE_LEVEL);
  const window = available.filter((exercise) => {
    const at = EXERCISE_LEVEL[exercise] ?? 0;
    return at >= low && at <= high;
  });
  if (window.length > 0) {
    return pick(window);
  }
  const below = available.filter(
    (exercise) => (EXERCISE_LEVEL[exercise] ?? 0) < low,
  );
  if (below.length > 0) {
    const nearest = Math.max(
      ...below.map((exercise) => EXERCISE_LEVEL[exercise] ?? 0),
    );
    return pick(atLevel(below, nearest));
  }
  return pick(atLevel(available, bottomLevel(available)));
}

function topLevel(available: readonly Exercise[]): number {
  return Math.max(...available.map((e) => EXERCISE_LEVEL[e] ?? 0));
}

function bottomLevel(available: readonly Exercise[]): number {
  return Math.min(...available.map((e) => EXERCISE_LEVEL[e] ?? 0));
}
