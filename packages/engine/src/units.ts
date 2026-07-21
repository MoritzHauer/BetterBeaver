import type { Content, Item, Task } from "@betterbeaver/schema";
import { parseClozeMarkup } from "@betterbeaver/schema";

/**
 * One schedulable unit of SRS progress. For `lexeme`/`concept`/`pair` items,
 * and for a `sentence` item referenced by a non-cloze task, the unit is the
 * whole item (`id` equals the item id). For a `sentence` item referenced by
 * a cloze task, each blank is its own unit (`id` is `<itemId>::c<n>`,
 * `blankNumber` is `n`). A sentence referenced by both a cloze and a
 * non-cloze task contributes both kinds of unit, independently. A note
 * (plan 0008 step 7) contributes its own unit instead, `item` absent and
 * `note` present (`id` is `note:<noteId>`, minted by `noteUnitId`).
 */
export interface SchedulingUnit {
  id: string;
  item?: Item;
  blankNumber?: number;
  note?: { id: string; stem: string };
}

/** The scheduling-unit id of one cloze blank — the SRS persistence key, minted here only. */
export function blankUnitId(itemId: string, blankNumber: number): string {
  return `${itemId}::c${blankNumber}`;
}

/** The scheduling-unit id of a note — the SRS persistence key, minted here only (plan 0008 step 7). */
export function noteUnitId(noteId: string): string {
  return `note:${noteId}`;
}

/**
 * Derives every scheduling unit from `content` (pinned rule, plan 0002): a
 * `sentence` item contributes `<itemId>::c<n>` per cloze blank iff some
 * cloze task references it, and `<itemId>` itself iff some non-cloze task
 * references it; all other kinds always contribute `<itemId>`. Blank ids
 * can't collide with item ids (slugs forbid `:`).
 */
export function schedulingUnits(content: Content): SchedulingUnit[] {
  const clozeItemIds = new Set<string>();
  const nonClozeItemIds = new Set<string>();
  for (const task of content.tasks) {
    const target = task.type === "cloze" ? clozeItemIds : nonClozeItemIds;
    for (const itemId of task.itemIds) {
      target.add(itemId);
    }
  }

  const units: SchedulingUnit[] = [];
  for (const item of content.items) {
    if (item.kind !== "sentence") {
      units.push({ id: item.id, item });
      continue;
    }
    if (clozeItemIds.has(item.id)) {
      // Markup validity is guaranteed by the content validator (class m).
      const parsed = parseClozeMarkup(item.payload.text);
      const blanks = parsed.valid ? parsed.blanks : [];
      for (const blank of blanks) {
        units.push({
          id: blankUnitId(item.id, blank.number),
          item,
          blankNumber: blank.number,
        });
      }
    }
    if (nonClozeItemIds.has(item.id)) {
      units.push({ id: item.id, item });
    }
  }

  // One unit per note referenced by any of the content's units (plan 0008
  // step 7), deduplicated across units that happen to share a note id.
  const noteIds = new Set<string>();
  for (const unit of content.units) {
    for (const noteId of unit.noteIds) {
      noteIds.add(noteId);
    }
  }
  const noteById = new Map(content.notes.map((note) => [note.id, note]));
  for (const noteId of noteIds) {
    const note = noteById.get(noteId);
    if (note !== undefined) {
      units.push({ id: noteUnitId(note.id), note });
    }
  }

  return units;
}

/**
 * Scheduling units for an entire domain (plan 0006, pinned rule): the union
 * of `schedulingUnits(content)` over every book belonging to the domain,
 * plus one unit per lexicon `entry` referenced by none of those books —
 * deduplicated by scheduling-unit id, so an entry shared by several books
 * (or a book's own referenced-entry duplicate) is one review item.
 */
export function domainSchedulingUnits(
  bookContents: Content[],
  entries: Item[],
): SchedulingUnit[] {
  const seen = new Set<string>();
  const units: SchedulingUnit[] = [];
  for (const content of bookContents) {
    for (const unit of schedulingUnits(content)) {
      if (!seen.has(unit.id)) {
        seen.add(unit.id);
        units.push(unit);
      }
    }
  }
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      units.push({ id: entry.id, item: entry });
    }
  }
  return units;
}

/**
 * The scheduling-unit ids a pinned `task` should surface first (plan 0008):
 * a non-cloze task's `itemIds` as-is, or a cloze task's blank unit ids
 * (`blankUnitId`, per `parseClozeMarkup`) across its items. An item missing
 * from `itemById` or not a parseable sentence is skipped defensively.
 */
export function taskSchedulingUnitIds(
  task: Task,
  itemById: ReadonlyMap<string, Item>,
): string[] {
  if (task.type !== "cloze") {
    return [...task.itemIds];
  }
  const ids: string[] = [];
  for (const itemId of task.itemIds) {
    const item = itemById.get(itemId);
    if (item === undefined || item.kind !== "sentence") {
      continue;
    }
    const parsed = parseClozeMarkup(item.payload.text);
    if (!parsed.valid) {
      continue;
    }
    for (const blank of parsed.blanks) {
      ids.push(blankUnitId(itemId, blank.number));
    }
  }
  return ids;
}
