import type { Content, Lesson, Unit } from "@betterbeaver/schema";
import type {
  Quality,
  ReviewPace,
  SchedulingConfig,
  SrsState,
} from "@betterbeaver/srs";
import {
  DEFAULT_SCHEDULING,
  isDue,
  PRODUCTION_LEVEL,
  schedule,
  wordLevel,
} from "@betterbeaver/srs";
import type { SchedulingUnit } from "./units.js";
import { itemIdFromUnitId, schedulingUnits } from "./units.js";

/**
 * How far a learner has taken one unit (plan 0025 §8) — three facts the
 * old attempted-task set blurred into one.
 */
export interface UnitProgress {
  /** The bar: the mean word level times ten, 0-100, rounded. It moves from
   * the first session and keeps moving for weeks, and because §4 makes every
   * level reachable on any content, 100% is always attainable. */
  percent: number;
  /** Words answered correctly at least once — level 1 or above. */
  started: number;
  /** Words in the unit. A word here is a scheduling unit that carries a
   * level: an item, or one cloze blank. Never a note (§13). */
  total: number;
  /** "You have been through this unit": every word at level >= 1. Stricter
   * than the rule it replaces, which counted a *wrong* answer as an attempt
   * and marked a whole five-item task attempted after a single question. */
  complete: boolean;
}

const EMPTY_PROGRESS: UnitProgress = {
  percent: 0,
  started: 0,
  total: 0,
  complete: false,
};

/**
 * Every unit's progress, in one sweep over the Book (plan 0025 §8).
 *
 * One function rather than a per-unit call, because the Lesson and Book
 * screens render a bar per row and `schedulingUnits` walks the whole content
 * each time it is asked.
 *
 * A unit with no words at all reads **complete**: `schedulingUnits` only
 * emits a unit for an item some task references, so "no words" means "no
 * exercises", and the alternative is a unit nothing can ever finish sitting
 * across the navigation spine. That is the same vacuous truth the
 * every-task-attempted rule had.
 *
 * `legacyAttemptedTaskIds` grandfathers completions earned under the rule
 * this one replaced (plan 0026 §4). The level rule is stricter twice over —
 * it wants every word, and it wants them *right* — so units that read
 * complete before it landed could flip back, re-locking gates and
 * regressing bars for a learner who did nothing wrong. Complete is
 * therefore the new rule **or** the old one, in the repo's existing
 * presence-based, self-erasing shape (plan 0006): the old key is read,
 * never written again, and ages out as content is re-studied. Only
 * `complete` is grandfathered — `percent` and `started` stay honest, since
 * they describe the levels rather than gate anything.
 */
export function unitProgressByBook(
  content: Content,
  states: ReadonlyMap<string, SrsState>,
  pace?: ReviewPace,
  legacyAttemptedTaskIds?: ReadonlySet<string>,
): Map<string, UnitProgress> {
  const wordsByItemId = new Map<string, SchedulingUnit[]>();
  for (const schedulingUnit of schedulingUnits(content)) {
    if (schedulingUnit.note !== undefined) {
      continue;
    }
    const itemId = itemIdFromUnitId(schedulingUnit.id);
    const words = wordsByItemId.get(itemId);
    if (words === undefined) {
      wordsByItemId.set(itemId, [schedulingUnit]);
    } else {
      words.push(schedulingUnit);
    }
  }

  const progress = new Map<string, UnitProgress>();
  for (const unit of content.units) {
    let total = 0;
    let started = 0;
    let levelSum = 0;
    for (const itemId of unit.itemIds) {
      for (const word of wordsByItemId.get(itemId) ?? []) {
        const level = wordLevel(states.get(word.id) ?? null, pace);
        total += 1;
        levelSum += level;
        if (level >= 1) {
          started += 1;
        }
      }
    }
    const legacy =
      legacyAttemptedTaskIds !== undefined &&
      legacyAttemptedTaskIds.size > 0 &&
      unit.taskIds.length > 0 &&
      unit.taskIds.every((taskId) => legacyAttemptedTaskIds.has(taskId));
    progress.set(unit.id, {
      percent: total === 0 ? 0 : Math.round((levelSum / total) * 10),
      started,
      total,
      complete: started === total || legacy,
    });
  }
  return progress;
}

/**
 * The level the exercise draw sees for each of `unit`'s items (plan 0025 §4).
 *
 * Not simply `wordLevel(states.get(itemId))`, because an item is not always
 * one scheduling unit: a sentence with an authored cloze task carries a
 * level per **blank** (`<itemId>::c1`, …) and none at all under its own id,
 * so reading the item id alone pins such a sentence at level 0 for ever —
 * every session would open it at the bottom of the ladder no matter how well
 * the learner knew it. Found 2026-09-10, with the credit mismatch beside it
 * (plan 0026's implementation notes).
 *
 * A word split across several scheduling units is at the level of its
 * **weakest** one. The number decides how hard the next exercise may be, and
 * a sentence whose third blank is still new is not a sentence to ask at
 * level 10 because its first two are.
 */
export function itemLevels(
  unit: Unit,
  content: Content,
  states: ReadonlyMap<string, SrsState>,
  pace?: ReviewPace,
): Map<string, number> {
  const owned = new Set(unit.itemIds);
  const byItemId = new Map<string, number[]>();
  for (const schedulingUnit of schedulingUnits(content)) {
    if (schedulingUnit.note !== undefined) {
      continue;
    }
    const itemId = itemIdFromUnitId(schedulingUnit.id);
    if (!owned.has(itemId)) {
      continue;
    }
    const levels = byItemId.get(itemId) ?? [];
    levels.push(wordLevel(states.get(schedulingUnit.id) ?? null, pace));
    byItemId.set(itemId, levels);
  }
  return new Map(
    unit.itemIds.map((itemId) => {
      const levels = byItemId.get(itemId) ?? [];
      // No scheduling unit at all means nothing has been asked: level 0,
      // which is where a new word starts anyway.
      return [itemId, levels.length === 0 ? 0 : Math.min(...levels)] as const;
    }),
  );
}

/** Every scheduling unit id `itemLevels` needs read from the store, for the
 * caller that fetches them. `unit.itemIds` is not enough — see above. */
export function itemLevelUnitIds(unit: Unit, content: Content): string[] {
  const owned = new Set(unit.itemIds);
  return schedulingUnits(content)
    .filter(
      (schedulingUnit) =>
        schedulingUnit.note === undefined &&
        owned.has(itemIdFromUnitId(schedulingUnit.id)),
    )
    .map((schedulingUnit) => schedulingUnit.id);
}

/** True when every word of `unit` has been answered correctly at least once
 * (plan 0025 §8). Reads the sweep above rather than recomputing. */
export function isUnitComplete(
  unit: Unit,
  progress: ReadonlyMap<string, UnitProgress>,
): boolean {
  return (progress.get(unit.id) ?? EMPTY_PROGRESS).complete;
}

/**
 * True when `unit` is unlocked: units without `unlocksAfterUnitId` are
 * always unlocked; otherwise the referenced unit must be complete. A
 * missing referenced unit (which valid content never has) is treated as
 * unlocked, defensively.
 */
export function isUnitUnlocked(
  unit: Unit,
  units: Unit[],
  progress: ReadonlyMap<string, UnitProgress>,
): boolean {
  if (unit.unlocksAfterUnitId === undefined) {
    return true;
  }
  const gate = units.find((u) => u.id === unit.unlocksAfterUnitId);
  if (gate === undefined) {
    return true;
  }
  return isUnitComplete(gate, progress);
}

/** True when every unit of `lesson` is complete (plan 0008: a lesson rolls up its units). A dangling unit id (which valid content never has) counts as complete, defensively. */
export function isLessonComplete(
  lesson: Lesson,
  units: Unit[],
  progress: ReadonlyMap<string, UnitProgress>,
): boolean {
  return lesson.unitIds.every((id) => {
    const unit = units.find((u) => u.id === id);
    return unit === undefined || isUnitComplete(unit, progress);
  });
}

/**
 * True when `lesson` is unlocked — `isUnitUnlocked`'s gating logic one level
 * up (plan 0008): lessons without `unlocksAfterLessonId` are always
 * unlocked; otherwise the referenced lesson must be complete. A missing
 * referenced lesson is treated as unlocked, defensively.
 */
export function isLessonUnlocked(
  lesson: Lesson,
  lessons: Lesson[],
  units: Unit[],
  progress: ReadonlyMap<string, UnitProgress>,
): boolean {
  if (lesson.unlocksAfterLessonId === undefined) {
    return true;
  }
  const gate = lessons.find((l) => l.id === lesson.unlocksAfterLessonId);
  if (gate === undefined) {
    return true;
  }
  return isLessonComplete(gate, units, progress);
}

/** The unit the learner should continue with: the first unit, in reading
 * order, that isn't complete. Reading order is `topic.lessonIds`, then each
 * lesson's `unitIds` — the same order BookScreen and LessonScreen render, so
 * "next" always means what the learner sees next. Dangling ids are skipped
 * (valid content has none; a stale cache during an update window must not
 * crash). `null` when every unit of the Book is complete.
 *
 * Locks are deliberately not consulted: the caller navigates straight to
 * UnitScreen, which has no lock gate of its own — the skip-ahead confirm
 * lives on the Lesson/Book *cards*. For all authored content the first
 * incomplete unit is unlocked anyway, since every earlier unit is complete. */
export function nextUnit(
  content: Content,
  progress: ReadonlyMap<string, UnitProgress>,
): { lessonId: string; unitId: string } | null {
  for (const lessonId of content.topic.lessonIds) {
    const lesson = content.lessons.find((l) => l.id === lessonId);
    if (lesson === undefined) {
      continue;
    }
    for (const unitId of lesson.unitIds) {
      const unit = content.units.find((u) => u.id === unitId);
      if (unit === undefined) {
        continue;
      }
      if (!isUnitComplete(unit, progress)) {
        return { lessonId, unitId };
      }
    }
  }
  return null;
}

/**
 * Scheduling units whose SRS state is due (`isDue`), sorted by due
 * ascending, keyed by unit id. Units without state are excluded. An
 * unparseable `due` sorts first (treated as negative infinity), surfacing
 * corrupted state for repair. `pinnedUnitIds` (plan 0008) sorts its members
 * ahead of the rest, ordering only — due-ascending still applies within each
 * group.
 *
 * **A note enters only when it is pinned** (plan 0025 §13). Every note in a
 * unit is a scheduling unit (plan 0008 §7), so a unit's theory used to come
 * back here as a self-graded flashcard forever — and theory is reference
 * material, read when it is needed, not a card to be drilled. For notes,
 * `pinnedUnitIds` therefore widens from "show me this first" to "include
 * this at all", which is the mechanism already: pinning a note grades it
 * `again` so that it becomes due immediately. Nothing migrates — existing
 * note state stays where it is and is simply no longer read for queueing,
 * and a learner who wants a note back pins it.
 */
export function reviewQueue(
  units: SchedulingUnit[],
  states: ReadonlyMap<string, SrsState>,
  now: Date,
  pinnedUnitIds: ReadonlySet<string> = new Set(),
): SchedulingUnit[] {
  const due: { unit: SchedulingUnit; dueMs: number }[] = [];
  for (const unit of units) {
    if (unit.note !== undefined && !pinnedUnitIds.has(unit.id)) {
      continue;
    }
    const state = states.get(unit.id);
    if (state === undefined || !isDue(state, now)) {
      continue;
    }
    const dueMs = new Date(state.due).getTime();
    due.push({
      unit,
      dueMs: Number.isNaN(dueMs) ? Number.NEGATIVE_INFINITY : dueMs,
    });
  }
  return due
    .sort((a, b) => {
      const pinned =
        Number(!pinnedUnitIds.has(a.unit.id)) -
        Number(!pinnedUnitIds.has(b.unit.id));
      return pinned !== 0 ? pinned : a.dueMs - b.dueMs;
    })
    .map((entry) => entry.unit);
}

/**
 * Buckets a due list by the content unit each due card belongs to (plan
 * 0022 §7's `· 8 due` badges) — a grouping over the sweep the caller already
 * ran, not a second query. Units with nothing due are absent from the map.
 *
 * A due scheduling unit resolves to a content unit through `itemIdFromUnitId`
 * (so every blank of a cloze counts individually, which is what the review
 * queue serves) or through `unit.noteIds` for a note card. An item or note
 * referenced by several units counts once per unit — it really is due on each
 * of them.
 */
export function dueCountsByUnit(
  due: SchedulingUnit[],
  units: Unit[],
): Map<string, number> {
  const dueItemIds = new Map<string, number>();
  const dueNoteIds = new Set<string>();
  for (const unit of due) {
    if (unit.note !== undefined) {
      dueNoteIds.add(unit.note.id);
      continue;
    }
    const itemId = itemIdFromUnitId(unit.id);
    dueItemIds.set(itemId, (dueItemIds.get(itemId) ?? 0) + 1);
  }

  const counts = new Map<string, number>();
  for (const unit of units) {
    const items = unit.itemIds.reduce(
      (sum, itemId) => sum + (dueItemIds.get(itemId) ?? 0),
      0,
    );
    const notes = unit.noteIds.filter((noteId) =>
      dueNoteIds.has(noteId),
    ).length;
    if (items + notes > 0) {
      counts.set(unit.id, items + notes);
    }
  }
  return counts;
}

/** The same counts rolled up to lessons, over `lesson.unitIds` (plan 0022
 * §7): the Book screen shows lesson cards, the Lesson screen unit cards, and
 * both read one sweep. */
export function dueCountsByLesson(
  unitCounts: ReadonlyMap<string, number>,
  lessons: Lesson[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const lesson of lessons) {
    const total = lesson.unitIds.reduce(
      (sum, unitId) => sum + (unitCounts.get(unitId) ?? 0),
      0,
    );
    if (total > 0) {
      counts.set(lesson.id, total);
    }
  }
  return counts;
}

/**
 * Advances SRS state for a grading result. An item enters scheduling on
 * its first result (`previous === null`). A result advances state only if
 * the item has no state yet, is due, or is still below the production level;
 * otherwise it is practice-only and `null` is returned so the caller
 * persists nothing.
 *
 * The third case is plan 0025 §5's exemption, and without it the exemption
 * could never fire: a word answered right once is due tomorrow, so the
 * practice-only rule alone would refuse its second and third answers of the
 * session and no new word could reach level 3 in its first sitting. Below
 * the production level a word is due daily anyway, so "not due" there only
 * ever means "already answered today" — which is exactly the case §4 wants
 * to keep counting. At and above it the rule stands unchanged, and the day
 * guard in `packages/srs` takes over.
 *
 * `config` picks the review pace; omitting it takes the shipped default,
 * Balanced.
 */
export function applyGrade(
  previous: SrsState | null,
  quality: Quality,
  gradedAt: Date,
  config: SchedulingConfig = DEFAULT_SCHEDULING,
): SrsState | null {
  if (
    previous === null ||
    isDue(previous, gradedAt) ||
    wordLevel(previous, config.pace) < PRODUCTION_LEVEL
  ) {
    return schedule(previous, quality, gradedAt, config);
  }
  return null;
}
