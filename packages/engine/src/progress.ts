import type { Lesson, Unit } from "@betterbeaver/schema";
import type { Quality, SrsState } from "@betterbeaver/srs";
import { isDue, schedule } from "@betterbeaver/srs";
import type { SchedulingUnit } from "./units.js";

/** True when every task id of `unit` has been attempted at least once. */
export function isUnitComplete(
  unit: Unit,
  attemptedTaskIds: ReadonlySet<string>,
): boolean {
  return unit.taskIds.every((id) => attemptedTaskIds.has(id));
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
  attemptedTaskIds: ReadonlySet<string>,
): boolean {
  if (unit.unlocksAfterUnitId === undefined) {
    return true;
  }
  const gate = units.find((u) => u.id === unit.unlocksAfterUnitId);
  if (gate === undefined) {
    return true;
  }
  return isUnitComplete(gate, attemptedTaskIds);
}

/** True when every unit of `lesson` is complete (plan 0008: a lesson rolls up its units). A dangling unit id (which valid content never has) counts as complete, defensively. */
export function isLessonComplete(
  lesson: Lesson,
  units: Unit[],
  attemptedTaskIds: ReadonlySet<string>,
): boolean {
  return lesson.unitIds.every((id) => {
    const unit = units.find((u) => u.id === id);
    return unit === undefined || isUnitComplete(unit, attemptedTaskIds);
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
  attemptedTaskIds: ReadonlySet<string>,
): boolean {
  if (lesson.unlocksAfterLessonId === undefined) {
    return true;
  }
  const gate = lessons.find((l) => l.id === lesson.unlocksAfterLessonId);
  if (gate === undefined) {
    return true;
  }
  return isLessonComplete(gate, units, attemptedTaskIds);
}

/**
 * Scheduling units whose SRS state is due (`isDue`), sorted by due
 * ascending, keyed by unit id. Units without state are excluded. An
 * unparseable `due` sorts first (treated as negative infinity), surfacing
 * corrupted state for repair. `pinnedUnitIds` (plan 0008) sorts its members
 * ahead of the rest, ordering only — due-ascending still applies within each
 * group.
 */
export function reviewQueue(
  units: SchedulingUnit[],
  states: ReadonlyMap<string, SrsState>,
  now: Date,
  pinnedUnitIds: ReadonlySet<string> = new Set(),
): SchedulingUnit[] {
  const due: { unit: SchedulingUnit; dueMs: number }[] = [];
  for (const unit of units) {
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
 * Advances SM-2 state for a grading result. An item enters scheduling on
 * its first result (`previous === null`). A result advances state only if
 * the item has no state yet or is due; otherwise it is practice-only and
 * `null` is returned so the caller persists nothing.
 */
export function applyGrade(
  previous: SrsState | null,
  quality: Quality,
  gradedAt: Date,
): SrsState | null {
  if (previous === null || isDue(previous, gradedAt)) {
    return schedule(previous, quality, gradedAt);
  }
  return null;
}
