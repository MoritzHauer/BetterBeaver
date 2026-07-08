import type { Unit } from "@betterbeaver/schema";
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

/**
 * Scheduling units whose SRS state is due (`isDue`), sorted by due
 * ascending, keyed by unit id. Units without state are excluded. An
 * unparseable `due` sorts first (treated as negative infinity), surfacing
 * corrupted state for repair.
 */
export function reviewQueue(
  units: SchedulingUnit[],
  states: ReadonlyMap<string, SrsState>,
  now: Date,
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
  return due.sort((a, b) => a.dueMs - b.dueMs).map((entry) => entry.unit);
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
