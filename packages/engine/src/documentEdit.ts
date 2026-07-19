import type { DomainDocument, TopicDocument } from "@betterbeaver/schema";

/**
 * Pure edit operations over raw content documents (plan 0012 §7). The
 * editor works on unvalidated documents (a draft mid-edit may be invalid —
 * zod/validateContent runs at publish), so entities here are loosely typed:
 * anything with a string `id`. Every op returns a new document; inputs are
 * never mutated.
 */

type Entity = { id: string } & Record<string, unknown>;

export type TopicCollection = "lessons" | "units" | "items" | "tasks";

function asEntities(list: unknown[]): Entity[] {
  return list as Entity[];
}

function entityId(value: unknown): string | undefined {
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function upsertById(list: unknown[], entity: Entity): unknown[] {
  const index = asEntities(list).findIndex((e) => e.id === entity.id);
  if (index === -1) {
    return [...list, entity];
  }
  return list.map((existing, i) => (i === index ? entity : existing));
}

/** Removes `id` from a string-array field of an entity, if present. */
function stripIdFrom(entity: Entity, field: string, id: string): Entity {
  const list = entity[field];
  if (!Array.isArray(list) || !list.includes(id)) {
    return entity;
  }
  return { ...entity, [field]: list.filter((x) => x !== id) };
}

/** Adds or replaces an entity (matched by id) in a topic document collection. */
export function upsertEntity(
  doc: TopicDocument,
  collection: TopicCollection,
  entity: { id: string } & Record<string, unknown>,
): TopicDocument {
  return {
    ...doc,
    [collection]: upsertById(doc[collection], entity as Entity),
  };
}

/**
 * Deletes an entity from a topic document and strips every reference to its
 * id: `topic.lessonIds`, `lessons[].unitIds`, `units[].itemIds/taskIds`,
 * and `tasks[].itemIds`. (Notes are separate — see `removeNote`.) A task
 * left with zero items, or a unit with no tasks, surfaces as a validation
 * error at publish; the op itself never cascades deletes.
 */
export function removeEntity(
  doc: TopicDocument,
  collection: TopicCollection,
  id: string,
): TopicDocument {
  return {
    ...doc,
    topic: stripIdFrom(doc.topic as Entity, "lessonIds", id),
    lessons: asEntities(doc.lessons)
      .filter((e) => collection !== "lessons" || e.id !== id)
      .map((e) => stripIdFrom(e, "unitIds", id)),
    units: asEntities(doc.units)
      .filter((e) => collection !== "units" || e.id !== id)
      .map((e) => stripIdFrom(stripIdFrom(e, "itemIds", id), "taskIds", id)),
    items: doc.items.filter(
      (e) => collection !== "items" || entityId(e) !== id,
    ),
    tasks: asEntities(doc.tasks)
      .filter((e) => collection !== "tasks" || e.id !== id)
      .map((e) => stripIdFrom(e, "itemIds", id)),
  };
}

/** Moves `id` one position up (`-1`) or down (`+1`) inside an id array; no-op when at the edge or absent. */
export function moveId(list: string[], id: string, delta: -1 | 1): string[] {
  const from = list.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) {
    return list;
  }
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Adds or replaces a note by stem. */
export function setNote(
  doc: TopicDocument,
  stem: string,
  markdown: string,
): TopicDocument {
  const index = doc.notes.findIndex((note) => note.stem === stem);
  const notes =
    index === -1
      ? [...doc.notes, { stem, markdown }]
      : doc.notes.map((note, i) => (i === index ? { stem, markdown } : note));
  return { ...doc, notes };
}

/**
 * Deletes a note and strips its derived id (`<topic.code>-note-<stem>`,
 * the rule pinned in validate.ts) from every unit's `noteIds`.
 */
export function removeNote(doc: TopicDocument, stem: string): TopicDocument {
  const code = (doc.topic as Entity).code;
  const noteId = `${typeof code === "string" ? code : ""}-note-${stem}`;
  return {
    ...doc,
    notes: doc.notes.filter((note) => note.stem !== stem),
    units: asEntities(doc.units).map((unit) =>
      stripIdFrom(unit, "noteIds", noteId),
    ),
  };
}

/** Adds or replaces a lexicon entry in a domain document. */
export function upsertDomainEntry(
  doc: DomainDocument,
  entry: { id: string } & Record<string, unknown>,
): DomainDocument {
  return { ...doc, entries: upsertById(doc.entries, entry as Entity) };
}

/**
 * Deletes a lexicon entry and strips references to it: family `entryIds`
 * and other entries' `payload.links`. Topic references to the entry
 * (units'/tasks' itemIds in *other documents*) surface at that topic's or
 * this domain's publish-time validation — cross-document refs are exactly
 * what the publish check exists for (plan 0012 §3).
 */
export function removeDomainEntry(
  doc: DomainDocument,
  id: string,
): DomainDocument {
  return {
    ...doc,
    entries: asEntities(doc.entries)
      .filter((entry) => entry.id !== id)
      .map((entry) => {
        const payload = entry.payload as Record<string, unknown> | undefined;
        const links = payload?.links;
        if (!Array.isArray(links)) {
          return entry;
        }
        const kept = links.filter(
          (link) => (link as { entryId?: unknown }).entryId !== id,
        );
        return kept.length === links.length
          ? entry
          : { ...entry, payload: { ...payload, links: kept } };
      }),
    families: asEntities(doc.families).map((family) =>
      stripIdFrom(family, "entryIds", id),
    ),
  };
}

/** Adds or replaces a family in a domain document. */
export function upsertFamily(
  doc: DomainDocument,
  family: { id: string } & Record<string, unknown>,
): DomainDocument {
  return { ...doc, families: upsertById(doc.families, family as Entity) };
}

export function removeFamily(doc: DomainDocument, id: string): DomainDocument {
  return {
    ...doc,
    families: asEntities(doc.families).filter((family) => family.id !== id),
  };
}
