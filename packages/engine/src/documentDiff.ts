import type { BookDocument, DomainDocument } from "@betterbeaver/schema";

/**
 * Structural diff for the proposal review flow (plan 0012 §5): a maintainer
 * compares a proposal's full document against the base version it was
 * proposed against. Deliberately dumb — added/removed by id, changed by
 * canonical (key-sorted) JSON inequality, no word-level text diffing. Pure
 * and framework-free so it lives next to the edit ops in packages/engine.
 */

type Entity = { id: string } & Record<string, unknown>;

/** Recursive key-sorted JSON.stringify: two values compare canonically equal
 * regardless of object key order (array order still matters — reordering an
 * entity's own fields is not the concern; a genuinely reordered *list* is
 * caught by the added/removed/changed classification, not this function). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeysDeep(source[key]);
    }
    return out;
  }
  return value;
}

export interface FieldChange {
  /** Dotted/bracketed path, e.g. "payload.text" or "payload.links[0].entryId". */
  path: string;
  before: string;
  after: string;
}

export interface EntityChange {
  id: string;
  fields: FieldChange[];
}

export interface CollectionDiff {
  /** id (or stem) present in the proposal, absent from the base. */
  added: string[];
  /** id (or stem) present in the base, absent from the proposal. */
  removed: string[];
  /** present in both, canonically unequal — with flattened field paths. */
  changed: EntityChange[];
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Flattens two objects into comparable dotted-path leaves and returns only
 * the paths that differ. Never a fixed per-kind field list — a proposal
 * review has no advance knowledge of which fields an entity uses. */
function flattenFieldChanges(before: unknown, after: unknown): FieldChange[] {
  const changes: FieldChange[] = [];
  walk(before, after, "", changes);
  return changes;
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  out: FieldChange[],
): void {
  const bothObjects =
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after);
  if (bothObjects) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      walk(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        path === "" ? key : `${path}.${key}`,
        out,
      );
    }
    return;
  }
  if (canonicalJson(before) !== canonicalJson(after)) {
    out.push({ path, before: stringify(before), after: stringify(after) });
  }
}

/** Diffs two entity lists keyed by `idOf` (an id for most collections, the
 * note stem for `notes`). */
export function diffCollection<T>(
  base: readonly T[],
  proposed: readonly T[],
  idOf: (entity: T) => string,
): CollectionDiff {
  const baseById = new Map(base.map((e) => [idOf(e), e]));
  const proposedById = new Map(proposed.map((e) => [idOf(e), e]));
  const added = [...proposedById.keys()].filter((id) => !baseById.has(id));
  const removed = [...baseById.keys()].filter((id) => !proposedById.has(id));
  const changed: EntityChange[] = [];
  for (const [id, proposedEntity] of proposedById) {
    const baseEntity = baseById.get(id);
    if (baseEntity === undefined) {
      continue;
    }
    if (canonicalJson(baseEntity) !== canonicalJson(proposedEntity)) {
      changed.push({
        id,
        fields: flattenFieldChanges(baseEntity, proposedEntity),
      });
    }
  }
  return { added, removed, changed };
}

/** Per-collection diff of a whole book document (plan 0012 §5 point 7): the
 * singleton `topic` entity plus every id-keyed collection. Concrete fields
 * rather than a `Record` so callers get checked access, not
 * possibly-undefined indexing. */
export interface BookDocumentDiff {
  topic: CollectionDiff;
  lessons: CollectionDiff;
  units: CollectionDiff;
  items: CollectionDiff;
  tasks: CollectionDiff;
  notes: CollectionDiff;
}

/** Per-collection diff of a whole domain document: the singleton `domain`
 * entity plus entries and families. */
export interface DomainDocumentDiff {
  domain: CollectionDiff;
  entries: CollectionDiff;
  families: CollectionDiff;
}

const idOf = (e: unknown): string => (e as Entity).id;

export function diffBookDocument(
  base: BookDocument,
  proposed: BookDocument,
): BookDocumentDiff {
  return {
    topic: diffCollection([base.topic], [proposed.topic], () => "topic"),
    lessons: diffCollection(base.lessons, proposed.lessons, idOf),
    units: diffCollection(base.units, proposed.units, idOf),
    items: diffCollection(base.items, proposed.items, idOf),
    tasks: diffCollection(base.tasks, proposed.tasks, idOf),
    notes: diffCollection(base.notes, proposed.notes, (n) => n.stem),
  };
}

export function diffDomainDocument(
  base: DomainDocument,
  proposed: DomainDocument,
): DomainDocumentDiff {
  return {
    domain: diffCollection([base.domain], [proposed.domain], () => "domain"),
    entries: diffCollection(base.entries, proposed.entries, idOf),
    families: diffCollection(base.families, proposed.families, idOf),
  };
}
