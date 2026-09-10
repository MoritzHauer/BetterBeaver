/**
 * Constructing an exercise for one item at one level, from content that
 * never authored a task for it (plan 0026 §1).
 *
 * Pure and content-only, like `draw.ts`: no learner state, no `Rng`. The
 * question this answers is *which* exercise a cell can hold, not what its
 * shuffled choices are — that stays in session building, so the same
 * function serves both the draw and the author's coverage grid (§8).
 *
 * Every per-type floor the validator enforces on an authored task
 * (classes (g)/(r), (n), (o), (p), (q), (m)) reappears here as a
 * **precondition**: a unit with three same-kind items simply has no MCQ at
 * that level, rather than an invalid one (§7). That is the same shape
 * `drawExercise`'s "a missing level is skipped, not waited for" already
 * consumes.
 */
import type { Content, Exercise, Item, Unit } from "@betterbeaver/schema";
import {
  EXERCISE_LEVEL,
  MAX_EXERCISE_LEVEL,
  MIN_EXERCISE_LEVEL,
  RECOGNIZE_DISTRACTOR_COUNT,
  parseClozeMarkup,
  recognizePrompt,
  sentenceTokens,
} from "@betterbeaver/schema";

/** The ranked ladder, lowest level first — the order every list here uses. */
const RANKED_EXERCISES: readonly Exercise[] = Object.entries(EXERCISE_LEVEL)
  .flatMap(([exercise, level]) =>
    level === null ? [] : [[exercise as Exercise, level] as const],
  )
  .sort(([, a], [, b]) => a - b)
  .map(([exercise]) => exercise);

/** The unit that owns `itemId` — unique for any content the validator passed. */
export function owningUnit(itemId: string, content: Content): Unit | undefined {
  return content.units.find((unit) => unit.itemIds.includes(itemId));
}

/** `item`'s unit siblings of the same kind, `item` itself excluded. */
function sameKindSiblings(item: Item, content: Content): Item[] {
  const unit = owningUnit(item.id, content);
  if (unit === undefined) {
    return [];
  }
  const itemById = new Map(content.items.map((i) => [i.id, i]));
  return unit.itemIds.flatMap((id) => {
    const other = itemById.get(id);
    return other !== undefined &&
      other.id !== item.id &&
      other.kind === item.kind
      ? [other]
      : [];
  });
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
export function promptIsUnique(item: Item, content: Content): boolean {
  if (owningUnit(item.id, content) === undefined) {
    return false;
  }
  if (item.kind === "pair") {
    return false;
  }
  const mine = recognizePrompt(item);
  return !sameKindSiblings(item, content).some(
    (other) => other.kind !== "pair" && recognizePrompt(other) === mine,
  );
}

/**
 * Enough same-kind items in the unit to fill an MCQ board — class (g)/(r)'s
 * floor, counted the way the validator counts it (the item plus
 * `RECOGNIZE_DISTRACTOR_COUNT` distractors).
 */
function hasMcqFloor(item: Item, content: Content): boolean {
  return sameKindSiblings(item, content).length >= RECOGNIZE_DISTRACTOR_COUNT;
}

/** A sentence's blanks, or `[]` when the markup is malformed (class (m)). */
function clozeBlankCount(item: Item): number {
  if (item.kind !== "sentence") {
    return 0;
  }
  const parsed = parseClozeMarkup(item.payload.text);
  return parsed.valid ? parsed.blanks.length : 0;
}

/** The item's own audio stem, for the three exercises that need one (class (n)). */
function hasAudio(item: Item): boolean {
  return item.kind !== "pair" && item.payload.audioRef !== undefined;
}

/**
 * Whether the content can build `exercise` for `item` with no authored task.
 *
 * `shadowing` is absent by construction: it is unranked (`EXERCISE_LEVEL` is
 * `null`), so it can neither be drawn to advance a word nor stand in for one
 * that would, and constructing one would only ever cost an appearance.
 */
function canConstruct(
  exercise: Exercise,
  item: Item,
  content: Content,
): boolean {
  const isWord = item.kind === "lexeme" || item.kind === "concept";
  const isSentence = item.kind === "sentence";
  // Positive kind guards throughout, mirroring `TASK_ALLOWED_ITEM_KINDS`:
  // every presentation helper (`recognizePrompt`, `itemDisplayText`,
  // `recallPrompt`) is exhaustive over today's four kinds and throws outside
  // them, so a kind added later must come here and say what it can be asked
  // as rather than inheriting a rung it cannot render.
  const isAskable = isWord || isSentence;

  switch (exercise) {
    case "matching":
      // A board needs a second card, and class (p) forbids two items sharing
      // a prompt text — so a sibling that reads the same is no sibling here.
      return (
        isAskable &&
        sameKindSiblings(item, content).some(
          (other) => recognizePrompt(other) !== recognizePrompt(item),
        )
      );
    case "recognize":
      return isAskable && hasMcqFloor(item, content);
    case "recognize-produce":
      return (
        isAskable && hasMcqFloor(item, content) && promptIsUnique(item, content)
      );
    case "listen":
      return isAskable && hasAudio(item) && hasMcqFloor(item, content);
    case "minimal-pair":
      // A pair item *is* the exercise, and its schema requires both stems.
      return item.kind === "pair";
    case "picture":
      return (
        isWord &&
        item.payload.imageRef !== undefined &&
        hasMcqFloor(item, content)
      );
    case "scramble":
    case "build":
      return isSentence && sentenceTokens(item.payload.text).length >= 3;
    case "cloze":
      return clozeBlankCount(item) >= 1;
    case "recall":
      return isAskable;
    case "write":
      return isWord;
    case "dictation":
      return isSentence && hasAudio(item);
    case "shadowing":
      return false;
  }
}

/**
 * How far up the ladder this unit means `item` to be taken (plan 0026 §5),
 * or `MAX_EXERCISE_LEVEL` where nobody said — which is the default, so most
 * items never set it.
 */
export function targetLevel(item: Item, content: Content): number {
  return (
    owningUnit(item.id, content)?.itemTargets?.[item.id] ?? MAX_EXERCISE_LEVEL
  );
}

/**
 * Caps `exercises` at `item`'s target level (§5).
 *
 * A target is intent — "this word is passive, recognise it and stop" — so it
 * governs whatever the draw would otherwise choose from, an authored task
 * included: an author who caps a word at 2 and leaves an old dictation task
 * pointing at it has contradicted themselves, and the cap is the more
 * specific statement.
 *
 * With one floor. If the cap would leave a word with nothing at all, the
 * lowest available exercise survives it: an unaskable word is not a passive
 * word, it is a hole in the session, and `drawExercise`'s own rule is
 * already that a word is never skipped for want of an exact match. The
 * coverage grid (§8) is where an author sees they asked for the impossible.
 */
export function capAtTarget(
  exercises: readonly Exercise[],
  item: Item,
  content: Content,
): readonly Exercise[] {
  const target = targetLevel(item, content);
  const capped = exercises.filter(
    (exercise) => (EXERCISE_LEVEL[exercise] ?? 0) <= target,
  );
  if (capped.length > 0 || exercises.length === 0) {
    return capped;
  }
  const lowest = Math.min(
    ...exercises.map((exercise) => EXERCISE_LEVEL[exercise] ?? 0),
  );
  return exercises.filter((exercise) => EXERCISE_LEVEL[exercise] === lowest);
}

/**
 * Every exercise the content can construct for `item`, authored or not —
 * §1's objective read one item at a time.
 *
 * Ordered by level, lowest first, so a caller that wants "the easiest thing
 * this word can be asked as" can take the head, and capped at the unit's
 * item target where it set one (§5).
 */
export function constructibleExercises(
  item: Item,
  content: Content,
): readonly Exercise[] {
  return capAtTarget(buildable(item, content), item, content);
}

/** `constructibleExercises` before the target caps it — the raw question of
 * what the content can build, which `itemCoverage` needs so it can cap the
 * union rather than each half (see `availableExercises`). */
function buildable(item: Item, content: Content): readonly Exercise[] {
  return RANKED_EXERCISES.filter((exercise) =>
    canConstruct(exercise, item, content),
  );
}

/**
 * The exercise the constructor would build for `item` at exactly `level`, or
 * `null` when the content cannot build that level for that item — plan
 * 0026's `exerciseAtLevel`.
 *
 * **Deviation from §1's signature, recorded deliberately.** The plan writes
 * the return type as `Question | null` while also pinning "no `Rng`;
 * shuffling stays where it is, in session building" — and a `Question` is
 * exactly the shuffled thing. Returning the *exercise* satisfies both
 * halves: `session.ts`'s `buildExerciseQuestion` turns it into a question
 * with the rng it already holds, and the coverage grid (§8) gets an answer
 * without minting boards it will not show.
 *
 * Ties are real (`listen` and `minimal-pair` both sit at 3), and the two can
 * never apply to the same item kind, so the first match is the only match in
 * practice. Where a genuine tie ever appears, the caller shuffles.
 */
export function exerciseAtLevel(
  item: Item,
  level: number,
  content: Content,
): Exercise | null {
  return (
    constructibleExercises(item, content).find(
      (exercise) => EXERCISE_LEVEL[exercise] === level,
    ) ?? null
  );
}

/** Where the exercises reaching one (item, level) cell came from (§3). */
export interface LevelCoverage {
  level: number;
  /** Exercises an authored task of this unit already covers for this item. */
  authored: readonly Exercise[];
  /** Exercises the constructor fills the cell with where nothing authored it. */
  constructed: readonly Exercise[];
  /** Above the unit's item target (§5): deliberately out of reach, not a
   * gap in the content. The grid says which of the two an empty cell is. */
  beyondTarget: boolean;
}

/**
 * The coverage grid's row for one item: one entry per rung of the ladder,
 * `MIN_EXERCISE_LEVEL`..`MAX_EXERCISE_LEVEL` (§8).
 *
 * This is §1's function run over every cell, which is the whole point of
 * building it per (item, level): the author's grid and the session's draw
 * read the same answer.
 */
export function itemCoverage(
  item: Item,
  content: Content,
  authoredExercises: readonly Exercise[],
): readonly LevelCoverage[] {
  // Capped over the union, exactly as `availableExercises` caps the draw —
  // cap each half and the never-silence-a-word floor fires on the authored
  // side alone, and the grid would show a level-9 `write` on a word the
  // session actually asks at level 1.
  //
  // The floor itself is deliberately *not* mirrored here. Where a target is
  // set that nothing can reach, the draw still asks the easiest exercise it
  // has while this grid shows the word unreached — the more useful
  // half-truth, since the author is looking at the one surface that exists
  // to tell them they asked for the impossible.
  const constructible = buildable(item, content);
  const kept = new Set(
    capAtTarget(
      [...new Set([...authoredExercises, ...constructible])],
      item,
      content,
    ),
  );
  const target = targetLevel(item, content);
  const at = (exercises: readonly Exercise[], level: number) =>
    exercises.filter(
      (exercise) => EXERCISE_LEVEL[exercise] === level && kept.has(exercise),
    );
  const rows: LevelCoverage[] = [];
  for (let level = MIN_EXERCISE_LEVEL; level <= MAX_EXERCISE_LEVEL; level++) {
    const authored = at(authoredExercises, level);
    rows.push({
      level,
      authored,
      // An authored task owns its cells; construction fills only the gaps.
      constructed: authored.length > 0 ? [] : at(constructible, level),
      beyondTarget: level > target,
    });
  }
  return rows;
}
