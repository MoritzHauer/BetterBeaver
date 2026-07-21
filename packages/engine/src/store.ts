import type { Content, Item, Task } from "@betterbeaver/schema";
import type { Quality, SrsState } from "@betterbeaver/srs";
import type { ProgressStore } from "./interfaces.js";
import { applyGrade, reviewQueue } from "./progress.js";
import { advanceStreak } from "./streak.js";
import {
  domainSchedulingUnits,
  schedulingUnits,
  taskSchedulingUnitIds,
  type SchedulingUnit,
} from "./units.js";

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
 * The pinned scheduling-unit ids among `tasks` whose id is in
 * `pinnedTaskIds` (plan 0008), via `taskSchedulingUnitIds`. Empty when
 * `pinnedTaskIds` is omitted or empty.
 */
function pinnedSchedulingUnitIds(
  tasks: Task[],
  itemById: ReadonlyMap<string, Item>,
  pinnedTaskIds: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (pinnedTaskIds === undefined || pinnedTaskIds.size === 0) {
    return ids;
  }
  for (const task of tasks) {
    if (pinnedTaskIds.has(task.id)) {
      for (const id of taskSchedulingUnitIds(task, itemById)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * The full "what is due" pipeline: derives `content`'s scheduling units,
 * fetches their SRS states from `store`, and returns the due units sorted by
 * due ascending (`reviewQueue`). The one entry point every screen should use
 * so the due-count badge and the review session can't diverge.
 * `pinnedTaskIds` (plan 0008) surfaces a pinned task's scheduling units
 * first, ordering only.
 */
export async function dueUnits(
  content: Content,
  store: ProgressStore,
  now: Date,
  pinnedTaskIds?: ReadonlySet<string>,
): Promise<SchedulingUnit[]> {
  const units = schedulingUnits(content);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const pinnedUnitIds = pinnedSchedulingUnitIds(
    content.tasks,
    itemById,
    pinnedTaskIds,
  );
  return reviewQueue(units, states, now, pinnedUnitIds);
}

/**
 * The domain-scoped "what is due" pipeline (plan 0006): derives the domain's
 * scheduling units (`domainSchedulingUnits` — union over the domain's books
 * plus unreferenced lexicon entries, deduplicated by unit id), then proceeds
 * exactly like `dueUnits`. `pinnedTaskIds` (plan 0008) is resolved against
 * every book's tasks.
 */
export async function dueDomainUnits(
  bookContents: Content[],
  entries: Item[],
  store: ProgressStore,
  now: Date,
  pinnedTaskIds?: ReadonlySet<string>,
): Promise<SchedulingUnit[]> {
  const units = domainSchedulingUnits(bookContents, entries);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  const itemById = new Map<string, Item>();
  const tasks: Task[] = [];
  for (const content of bookContents) {
    for (const item of content.items) {
      itemById.set(item.id, item);
    }
    tasks.push(...content.tasks);
  }
  for (const entry of entries) {
    itemById.set(entry.id, entry);
  }
  const pinnedUnitIds = pinnedSchedulingUnitIds(tasks, itemById, pinnedTaskIds);
  return reviewQueue(units, states, now, pinnedUnitIds);
}

/**
 * Grades an item against `store`'s current state, persisting the result
 * only when it actually advances scheduling (new or due item). Returns the
 * new state, or `null` if the grading was practice-only (nothing persisted).
 *
 * Every recorded grade — practice-only included — also marks the local day
 * active for `domainId`'s streak (plan 0003; per-domain since plan 0006);
 * the streak is persisted only when it actually changed (same-day repeats
 * are no-ops). Every grade counts as one rep (Stats counter) — bumped
 * unconditionally, since a same-day repeat is still a rep.
 */
export async function recordGrade(
  store: ProgressStore,
  itemId: string,
  quality: Quality,
  gradedAt: Date,
  domainId: string,
): Promise<SrsState | null> {
  await store.incrementReps();
  const previous = await store.getItemState(itemId);
  const next = applyGrade(previous, quality, gradedAt);
  if (next !== null) {
    await store.setItemState(itemId, next);
  }
  const prevStreak = await store.getStreak(domainId);
  const streak = advanceStreak(prevStreak, gradedAt);
  if (streak !== prevStreak) {
    await store.setStreak(domainId, streak);
  }
  return next;
}
