import type { Content, Item } from "@betterbeaver/schema";
import { parseClozeMarkup } from "@betterbeaver/schema";

/**
 * One schedulable unit of SRS progress. For `lexeme`/`concept`/`pair` items,
 * and for a `sentence` item referenced by a non-cloze task, the unit is the
 * whole item (`id` equals the item id). For a `sentence` item referenced by
 * a cloze task, each blank is its own unit (`id` is `<itemId>::c<n>`,
 * `blankNumber` is `n`). A sentence referenced by both a cloze and a
 * non-cloze task contributes both kinds of unit, independently.
 */
export interface SchedulingUnit {
  id: string;
  item: Item;
  blankNumber?: number;
}

/** The scheduling-unit id of one cloze blank — the SRS persistence key, minted here only. */
export function blankUnitId(itemId: string, blankNumber: number): string {
  return `${itemId}::c${blankNumber}`;
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
  return units;
}
