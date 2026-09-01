import type { Content, Item } from "@betterbeaver/schema";
import type {
  Quality,
  ReviewPace,
  SchedulingConfig,
  SrsState,
} from "@betterbeaver/srs";
import { dueAfter } from "@betterbeaver/srs";
import type { ProgressStore } from "./interfaces.js";
import {
  applyGrade,
  reviewQueue,
  unitProgressByBook,
  type UnitProgress,
} from "./progress.js";
import { advanceStreak } from "./streak.js";
import {
  domainSchedulingUnits,
  schedulingUnits,
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
 * The full "what is due" pipeline: derives `content`'s scheduling units,
 * fetches their SRS states from `store`, and returns the due units sorted by
 * due ascending (`reviewQueue`). The one entry point every screen should use
 * so the due-count badge and the review session can't diverge.
 * `pinnedUnitIds` surfaces the pinned scheduling units first, ordering only.
 */
export async function dueUnits(
  content: Content,
  store: ProgressStore,
  now: Date,
  pinnedUnitIds?: ReadonlySet<string>,
): Promise<SchedulingUnit[]> {
  const units = schedulingUnits(content);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  return reviewQueue(units, states, now, pinnedUnitIds ?? new Set());
}

/**
 * Every unit's progress across `contents` (plan 0025 §8), in one pass over
 * the store: the bar's percentage, the started count, and whether the unit
 * is complete.
 *
 * Takes a list of Books rather than one, because the caller that needs this
 * — the app's navigation spine — needs all of them at once, and a Book's
 * scheduling units are shared with the domain's other Books, so fetching
 * them once is both fewer reads and one consistent snapshot. Unit ids are
 * unique across Books, so the merged map has no collisions.
 */
export async function collectUnitProgress(
  contents: Content[],
  store: ProgressStore,
  pace?: ReviewPace,
): Promise<Map<string, UnitProgress>> {
  const unitIds = new Set<string>();
  for (const content of contents) {
    for (const unit of schedulingUnits(content)) {
      unitIds.add(unit.id);
    }
  }
  const states = await collectItemStates([...unitIds], store);
  const progress = new Map<string, UnitProgress>();
  for (const content of contents) {
    for (const [unitId, unitProgress] of unitProgressByBook(
      content,
      states,
      pace,
    )) {
      progress.set(unitId, unitProgress);
    }
  }
  return progress;
}

/**
 * The domain-scoped "what is due" pipeline (plan 0006): derives the domain's
 * scheduling units (`domainSchedulingUnits` — union over the domain's books
 * plus unreferenced lexicon entries, deduplicated by unit id), then proceeds
 * exactly like `dueUnits`. `pinnedUnitIds` surfaces the pinned scheduling
 * units first, ordering only.
 */
export async function dueDomainUnits(
  bookContents: Content[],
  entries: Item[],
  store: ProgressStore,
  now: Date,
  pinnedUnitIds?: ReadonlySet<string>,
): Promise<SchedulingUnit[]> {
  const units = domainSchedulingUnits(bookContents, entries);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  return reviewQueue(units, states, now, pinnedUnitIds ?? new Set());
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
 *
 * `config` is the learner's Learning settings (plan 0022); the app passes
 * it at every call site, and omitting it takes the shipped default.
 */
export async function recordGrade(
  store: ProgressStore,
  itemId: string,
  quality: Quality,
  gradedAt: Date,
  domainId: string,
  config?: SchedulingConfig,
): Promise<SrsState | null> {
  await store.incrementReps();
  const previous = await store.getItemState(itemId);
  const next = applyGrade(previous, quality, gradedAt, config);
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

/**
 * Pushes an item's `due` out by `days` (plan 0022 §5's Skip verb) and
 * nothing else: rung, ease and interval are untouched, so the card resumes
 * exactly where it was when it comes back. Skipping is not an answer — no
 * rep, no streak, no grade.
 *
 * An item with no state is left alone and `null` returned. Nothing is
 * skippable that isn't already scheduled: a card with no state is not in a
 * queue to be annoyed by.
 */
export async function skipItem(
  store: ProgressStore,
  itemId: string,
  days: number,
  from: Date,
): Promise<SrsState | null> {
  const previous = await store.getItemState(itemId);
  if (previous === null) {
    return null;
  }
  const next = { ...previous, due: dueAfter(days, from) };
  await store.setItemState(itemId, next);
  return next;
}
