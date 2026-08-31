import { describe, expect, it } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { migratePrivateDocuments } from "./private-migrations";

/**
 * Plan 0017 decision 5 (via design.md): a private Book has no admin
 * republish, so the `script` → `text` rename plan 0023 §4 made has to be
 * undone on read. The identity assertions are as load-bearing as the rewrite
 * ones — every caller saves what it read, so a record this touches
 * needlessly is a record that looks dirty forever.
 */
function record(
  entries: unknown[],
  items: unknown[] = [],
): { book: BookDocument; domain: DomainDocument } {
  return {
    book: {
      topic: { id: "bk" },
      lessons: [],
      units: [],
      items,
      tasks: [],
      resources: [],
      notes: [],
    },
    domain: { domain: { id: "dm" }, entries, families: [] },
  };
}

const lexeme = (components: unknown[]) => ({
  id: "dm-e1",
  kind: "lexeme",
  payload: { script: "окумуштуу", gloss: "scholar", components },
});

describe("migratePrivateDocuments", () => {
  it("rewrites a version-1 component's script as text, dropping the old key", () => {
    const migrated = migratePrivateDocuments(
      record([lexeme([{ script: "оку", gloss: "study" }])]),
    );
    const entry = migrated.domain.entries[0] as {
      payload: { components: unknown[] };
    };
    expect(entry.payload.components).toEqual([{ text: "оку", gloss: "study" }]);
  });

  it("carries entryId across untouched", () => {
    const migrated = migratePrivateDocuments(
      record([lexeme([{ script: "оку", gloss: "study", entryId: "dm-e2" }])]),
    );
    const entry = migrated.domain.entries[0] as {
      payload: { components: unknown[] };
    };
    expect(entry.payload.components).toEqual([
      { text: "оку", gloss: "study", entryId: "dm-e2" },
    ]);
  });

  it("returns a version-2 record by identity", () => {
    const before = record([lexeme([{ text: "оку", gloss: "study" }])]);
    expect(migratePrivateDocuments(before)).toBe(before);
  });

  it("returns a record with no components at all by identity", () => {
    const before = record([
      {
        id: "dm-e1",
        kind: "lexeme",
        payload: { script: "суу", gloss: "water" },
      },
    ]);
    expect(migratePrivateDocuments(before)).toBe(before);
  });

  it("migrates a concept in the Book's own items, not just the lexicon", () => {
    const migrated = migratePrivateDocuments(
      record(
        [],
        [
          {
            id: "bk-i1",
            kind: "concept",
            payload: {
              term: "cardiomyopathy",
              components: [{ script: "cardio", gloss: "heart" }],
            },
          },
        ],
      ),
    );
    const item = migrated.book.items[0] as {
      payload: { components: unknown[] };
    };
    expect(item.payload.components).toEqual([
      { text: "cardio", gloss: "heart" },
    ]);
  });

  it("leaves an entity of another kind alone", () => {
    // Only the two lexicon payloads carry a breakdown; a `script` key
    // anywhere else means something else entirely.
    const before = record(
      [],
      [
        {
          id: "bk-i2",
          kind: "sentence",
          payload: { components: [{ script: "оку", gloss: "study" }] },
        },
      ],
    );
    expect(migratePrivateDocuments(before)).toBe(before);
  });

  it("leaves a part that already has text alone, even alongside a stray script", () => {
    const before = record([
      lexeme([{ text: "оку", script: "old", gloss: "study" }]),
    ]);
    expect(migratePrivateDocuments(before)).toBe(before);
  });
});
