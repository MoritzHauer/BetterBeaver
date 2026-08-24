import type { BookDocument, DomainDocument } from "@betterbeaver/schema";

/**
 * Local migrations for private Books (design.md, plan 0017 decision 5:
 * "schema changes must stay additive for anything a private Book can contain,
 * or ship a local migration"). A private Book lives on one device and there is
 * no admin republish that can reach it, so a breaking rename has to be undone
 * here or the record simply stops validating.
 *
 * So far that is one rename: plan 0023 §4 turned a component's `script` into
 * `text` (schema version 1 → 2). Nothing in the app has ever *written*
 * `components`, so the realistic carrier is a `.bbbook` exported from another
 * device — which import still accepts, since `schemaVersion: 1` is `<=
 * CONTENT_SCHEMA_VERSION`.
 *
 * Applied on **read**, not as a rewrite of the store: it is idempotent, it
 * cannot half-apply, and a failed write can never leave a record in a state
 * neither version understands. That is also why every function here returns
 * its input by identity when there is nothing to change — a record that comes
 * back `===` is one that never looks dirty to a caller that saves what it read.
 */

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** `{script, gloss}` → `{text, gloss}`, and only that: a part that already
 * carries a `text` is version 2 already, and one carrying neither is
 * something this migration has no opinion about. */
function migrateComponent(component: unknown): unknown {
  const part = obj(component);
  if (typeof part.script !== "string" || "text" in part) {
    return component;
  }
  const { script, ...rest } = part;
  return { text: script, ...rest };
}

function migrateEntity(entity: unknown): unknown {
  const e = obj(entity);
  if (e.kind !== "lexeme" && e.kind !== "concept") {
    return entity;
  }
  const payload = obj(e.payload);
  const components = payload.components;
  if (!Array.isArray(components)) {
    return entity;
  }
  const migrated = components.map(migrateComponent);
  if (migrated.every((part, i) => part === components[i])) {
    return entity;
  }
  return { ...e, payload: { ...payload, components: migrated } };
}

function migrateEntities(entities: unknown[]): unknown[] {
  // Declared `unknown[]`, but a document at rest is `JSON.parse` of whatever
  // was stored — `edit/types.ts`'s `firstResourceId` guards the same field
  // for the same reason. A malformed document has to degrade to "nothing to
  // migrate": throwing here lands in `readPrivateBooks`' catch-all, which
  // would drop *every* private Book on the device.
  if (!Array.isArray(entities)) {
    return entities;
  }
  const migrated = entities.map(migrateEntity);
  return migrated.every((entity, i) => entity === entities[i])
    ? entities
    : migrated;
}

/**
 * The pair of documents a private Book is made of, migrated together.
 * Structural rather than typed on `PrivateBookRecord` so the import path,
 * whose file is a `{book, domain, assets, …}` of its own, runs the same code.
 */
export function migratePrivateDocuments<
  T extends { book: BookDocument; domain: DomainDocument },
>(record: T): T {
  // A Book's own `items` can hold `concept`s; the lexicon's `entries` hold
  // every lexeme. Both pools carry `components` since plan 0023 §4.
  const items = migrateEntities(record.book.items);
  const entries = migrateEntities(record.domain.entries);
  if (items === record.book.items && entries === record.domain.entries) {
    return record;
  }
  return {
    ...record,
    book: { ...record.book, items },
    domain: { ...record.domain, entries },
  };
}
