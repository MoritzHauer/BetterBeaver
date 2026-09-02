/**
 * Which exercise a word is asked as, and which exercises its content can
 * build at all (plan 0025 §4, §9).
 *
 * Pure and content-only: the caller passes the word's level in, so nothing
 * here reads progress. `session.ts` turns the answer into a `Question`.
 */
import type { Content, Exercise, Item, Unit } from "@betterbeaver/schema";
import {
  EXERCISE_LEVEL,
  MAX_EXERCISE_LEVEL,
  MIN_EXERCISE_LEVEL,
  TASK_EXERCISES,
  recognizePrompt,
} from "@betterbeaver/schema";
import { shuffle, type Rng } from "./rng.js";

/**
 * The two slots an appearance fills (plan 0025 §4). A `repetition` draws
 * from levels the word has already passed; a `new` attempt sits one above,
 * and getting it right is the only thing that advances the level.
 */
export type Slot = "repetition" | "new";

/** The unit that owns `itemId` — unique for any content the validator passed. */
function owningUnit(itemId: string, content: Content): Unit | undefined {
  return content.units.find((unit) => unit.itemIds.includes(itemId));
}

/**
 * True when `item`'s prompt-side text is unique among its unit's same-kind
 * items — the runtime gate on the produce direction (plan 0025 §9).
 *
 * Class (h) only guarantees distinct *display* texts, so two items sharing a
 * `script` while differing in gloss are valid published content and make a
 * produce-direction MCQ ambiguous: for the prompt "beautiful", both кооз and
 * сулуу are defensible answers. A new validator class would retroactively
 * invalidate live Books, so the exercise is withheld instead — the same way
 * one whose assets are missing is.
 */
function promptIsUnique(item: Item, content: Content): boolean {
  const unit = owningUnit(item.id, content);
  if (unit === undefined) {
    return false;
  }
  const itemById = new Map(content.items.map((i) => [i.id, i]));
  const mine = recognizePrompt(item);
  return !unit.itemIds.some((id) => {
    const other = itemById.get(id);
    return (
      other !== undefined &&
      other.id !== item.id &&
      other.kind === item.kind &&
      other.kind !== "pair" &&
      recognizePrompt(other) === mine
    );
  });
}

/**
 * Every exercise `item` can actually be asked as: the ones its unit's tasks
 * authorize, plus the two this plan derives from content that never authored
 * them (§9).
 *
 * Unranked exercises are excluded — `shadowing` checks nothing, so it can
 * neither be drawn to advance a word nor stand in for one that would.
 */
export function availableExercises(
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
