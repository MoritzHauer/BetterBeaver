/**
 * Pure, DOM-free helpers behind `EntityPicker` (spec 0018 §2): building a
 * pool's display options, searching/filtering them, and grouping them. Kept
 * separate from the editor modules so this logic is unit-testable without React.
 */
import { noteTitle } from "../content/noteTitle";

/** A loosely-typed entity, matching `edit/types.ts`'s own `Entity` — mid-edit
 * content is untrusted/possibly-invalid on purpose (see that file's header
 * comment), so these helpers never assume a validated shape. */
type Loose = { id: string } & Record<string, unknown>;

export interface PickerOption {
  id: string;
  title: string;
  /** Extra searchable text (spec §2: "filtering on title, subtitle and id"). */
  subtitle?: string;
  /** Group header value (spec §2 `groupBy`) — used only for unit references. */
  group?: string;
  /** Short display tag, e.g. "lexicon entry" — decorative only, never used
   * for filtering (filters carry their own explicit id sets, see below). */
  kind?: string;
}

export interface PickerFilter {
  key: string;
  label: string;
  /** Ids this chip restricts the pool to; `null` means unrestricted ("All"). */
  ids: Set<string> | null;
}

export interface PickerRow extends PickerOption {
  /** True for a `selected` id with no matching option — a dangling
   * reference that must stay visible/removable (spec §2, last bullet). */
  unresolved: boolean;
}

function matches(option: PickerOption, query: string): boolean {
  return (
    option.title.toLowerCase().includes(query) ||
    (option.subtitle?.toLowerCase().includes(query) ?? false) ||
    option.id.toLowerCase().includes(query)
  );
}

/**
 * The picker's visible rows: `options` narrowed by the active filter chip
 * (an id-set restriction, or unrestricted when `activeFilter` is absent or
 * carries `ids: null`) and then by the search box (title/subtitle/id,
 * case-insensitive). A `selected` id absent from `options` is always
 * appended as an unresolved row, regardless of filter or search — a
 * dangling reference must stay visible and removable (spec §2).
 */
export function visiblePickerRows(
  options: PickerOption[],
  selected: string[],
  search: string,
  activeFilter: PickerFilter | undefined,
): PickerRow[] {
  const query = search.trim().toLowerCase();
  const rows: PickerRow[] = [];
  for (const option of options) {
    if (activeFilter?.ids != null && !activeFilter.ids.has(option.id)) {
      continue;
    }
    if (query !== "" && !matches(option, query)) {
      continue;
    }
    rows.push({ ...option, unresolved: false });
  }
  const known = new Set(options.map((o) => o.id));
  for (const id of selected) {
    if (!known.has(id)) {
      rows.push({ id, title: id, unresolved: true });
    }
  }
  return rows;
}

/**
 * Groups rows by `group` (spec §2 `groupBy`), preserving each group's
 * first-seen order and each row's relative order within it. Rows with no
 * `group` collect under `undefined`.
 */
export function groupPickerRows(
  rows: PickerRow[],
): { group: string | undefined; rows: PickerRow[] }[] {
  const order: (string | undefined)[] = [];
  const byGroup = new Map<string | undefined, PickerRow[]>();
  for (const row of rows) {
    let bucket = byGroup.get(row.group);
    if (bucket === undefined) {
      bucket = [];
      byGroup.set(row.group, bucket);
      order.push(row.group);
    }
    bucket.push(row);
  }
  return order.map((group) => ({ group, rows: byGroup.get(group) ?? [] }));
}

/**
 * An entity's display title (spec §3): its own `title`/`name`, else a
 * kind-specific headword (lexeme/item payload), else its id. Defensive by
 * necessity — a mid-edit entity may still be missing fields.
 */
export function titleOf(entity: Loose): string {
  if (typeof entity.title === "string" && entity.title !== "") {
    return entity.title;
  }
  if (typeof entity.name === "string" && entity.name !== "") {
    return entity.name;
  }
  const payload = entity.payload;
  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (typeof p.script === "string" && p.script !== "") {
      return p.script; // lexeme headword
    }
    if (typeof p.term === "string" && p.term !== "") {
      return p.term; // concept
    }
    if (typeof p.text === "string" && p.text !== "") {
      return p.text; // sentence
    }
    if (typeof p.a === "object" && p.a !== null) {
      const aScript = (p.a as Record<string, unknown>).script;
      if (typeof aScript === "string" && aScript !== "") {
        return aScript; // pair, side A
      }
    }
  }
  return entity.id;
}

/** Builds plain (ungrouped) options from a flat entity list, tagged with an
 * optional decorative `kind`. */
export function optionsFrom(entities: Loose[], kind?: string): PickerOption[] {
  return entities.map((entity) => ({
    id: entity.id,
    title: titleOf(entity),
    kind,
  }));
}

/** Note options: `BookDocumentNote` has no `id` field (only `stem`); the id
 * is derived the same way the rest of the editor derives it. */
export function notePoolOptions(
  notes: { stem: string; markdown: string }[],
  bookCode: string,
): PickerOption[] {
  return notes.map((note) => ({
    id: `${bookCode}-note-${note.stem}`,
    // The note's own `# ` heading, not its stem — stems are generated ids
    // (spec 0018), so a stem is a UUID and useless as a label.
    title: noteTitle(note.markdown, note.stem),
    subtitle: note.stem,
  }));
}

/**
 * Unit options grouped by owning lesson (spec §3: `unlocksAfterUnitId`,
 * `recallUnitIds`), in `lessons` order and each lesson's own `unitIds`
 * order. Only units actually listed under some lesson's `unitIds` appear —
 * callers pre-filter `units` (e.g. excluding the unit being edited itself).
 */
export function unitPoolOptionsGroupedByLesson(
  lessons: Loose[],
  units: Loose[],
): PickerOption[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const options: PickerOption[] = [];
  for (const lesson of lessons) {
    const group =
      typeof lesson.title === "string" && lesson.title !== ""
        ? lesson.title
        : lesson.id;
    const unitIds = Array.isArray(lesson.unitIds)
      ? (lesson.unitIds as string[])
      : [];
    for (const unitId of unitIds) {
      const unit = unitById.get(unitId);
      if (unit !== undefined) {
        options.push({ id: unit.id, title: titleOf(unit), group });
      }
    }
  }
  return options;
}
