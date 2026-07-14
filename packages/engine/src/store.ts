import type { Content } from "@betterbeaver/schema";
import type { Quality, SrsState } from "@betterbeaver/srs";
import type { ProgressStore } from "./interfaces.js";
import { applyGrade, reviewQueue } from "./progress.js";
import { advanceStreak } from "./streak.js";
import { schedulingUnits, type SchedulingUnit } from "./units.js";

/**
 * Fetches SRS state for each item id from `store`, in parallel. Items with
 * no stored state (never practiced) are omitted from the result.
 */
export async function collectItemStates(
  itemIds: string[],
  store: ProgressStore,
): Promise<Map<string, SrsState>> {
  const entries = await Promise.all(
    itemIds.map(async (itemId): Promise<[string, SrsState | null]> => [
      itemId,
      await store.getItemState(itemId),
    ]),
  );
  const states = new Map<string, SrsState>();
  for (const [itemId, state] of entries) {
    if (state !== null) {
      states.set(itemId, state);
    }
  }
  return states;
}

/**
 * The full "what is due" pipeline: derives `content`'s scheduling units,
 * fetches their SRS states from `store`, and returns the due units sorted by
 * due ascending (`reviewQueue`). The one entry point every screen should use
 * so the due-count badge and the review session can't diverge.
 */
export async function dueUnits(
  content: Content,
  store: ProgressStore,
  now: Date,
): Promise<SchedulingUnit[]> {
  const units = schedulingUnits(content);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  return reviewQueue(units, states, now);
}

/**
 * Grades an item against `store`'s current state, persisting the result
 * only when it actually advances scheduling (new or due item). Returns the
 * new state, or `null` if the grading was practice-only (nothing persisted).
 *
 * Every recorded grade — practice-only included — also marks the local day
 * active for the streak (plan 0003); the streak is persisted only when it
 * actually changed (same-day repeats are no-ops).
 */
export async function recordGrade(
  store: ProgressStore,
  itemId: string,
  quality: Quality,
  gradedAt: Date,
): Promise<SrsState | null> {
  const previous = await store.getItemState(itemId);
  const next = applyGrade(previous, quality, gradedAt);
  if (next !== null) {
    await store.setItemState(itemId, next);
  }
  const prevStreak = await store.getStreak();
  const streak = advanceStreak(prevStreak, gradedAt);
  if (streak !== prevStreak) {
    await store.setStreak(streak);
  }
  return next;
}
