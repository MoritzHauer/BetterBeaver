import { describe, expect, it } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { documentProblems, draftContent } from "@betterbeaver/engine";
import { entityTarget } from "./WhatChanged";

/**
 * Spec 0021-10 §3–§4. Ids are hidden everywhere by slice 9, and
 * `EntityPicker` used to show them *because validation errors name them* —
 * so an error nobody can locate makes hiding them a net loss. Every shape in
 * §3's table has to resolve to the screen that owns it.
 */

const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book",
    description: "",
    lessonIds: ["bk-l1"],
  },
  lessons: [
    {
      id: "bk-l1",
      topicId: "bk",
      title: "Lesson",
      goal: "",
      unitIds: ["bk-u1"],
    },
  ],
  units: [
    {
      id: "bk-u1",
      lessonId: "bk-l1",
      title: "Unit",
      goal: "",
      itemIds: ["bk-i1", "bk-i2", "dm-e1"],
      taskIds: ["bk-t1"],
      noteIds: ["bk-note-n1"],
    },
  ],
  items: [
    {
      id: "bk-i1",
      kind: "concept",
      sourceRef: "bk-r1",
      payload: { term: "Dam", definition: "A wall" },
    },
    {
      id: "bk-i2",
      kind: "sentence",
      sourceRef: "bk-r1",
      payload: { text: "Beavers build dams here", translation: "They build" },
    },
  ],
  tasks: [{ id: "bk-t1", type: "recall", itemIds: ["bk-i1"] }],
  resources: [{ id: "bk-r1", title: "Source", path: "s.md" }],
  notes: [{ stem: "n1", markdown: "# A note\n\nBody.\n" }],
};

const DOMAIN: DomainDocument = {
  domain: {
    id: "dm",
    code: "dm",
    kind: "language",
    title: "D",
    glossLanguage: "en",
  },
  entries: [
    {
      id: "dm-e1",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: { script: "суу", transliteration: "suu", gloss: "water" },
    },
  ],
  families: [],
};

const NO_STEMS = {
  audioByBook: new Map(),
  imageByBook: new Map(),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

const content = draftContent(BOOK, DOMAIN, NO_STEMS).content;

describe("resolving an error's id to a screen", () => {
  it("sends each shape in the table to the screen that owns it", () => {
    expect(entityTarget(content, "topic")).toEqual({});
    // A resource has no screen of its own: Sources lives on the Book.
    expect(entityTarget(content, "bk-r1")).toEqual({});
    expect(entityTarget(content, "bk-l1")).toEqual({ lessonId: "bk-l1" });
    expect(entityTarget(content, "bk-u1")).toEqual({
      lessonId: "bk-l1",
      unitId: "bk-u1",
    });
    // A book item lands on the page its kind renders on…
    expect(entityTarget(content, "bk-i1")).toEqual({
      lessonId: "bk-l1",
      unitId: "bk-u1",
      page: "concepts",
    });
    expect(entityTarget(content, "bk-i2")).toEqual({
      lessonId: "bk-l1",
      unitId: "bk-u1",
      page: "examples",
    });
    // …and a lexicon entry on Vocabulary, since `Content.items` is merged.
    expect(entityTarget(content, "dm-e1")).toEqual({
      lessonId: "bk-l1",
      unitId: "bk-u1",
      page: "vocabulary",
    });
    expect(entityTarget(content, "bk-t1")).toEqual({
      lessonId: "bk-l1",
      unitId: "bk-u1",
      page: "exercises",
    });
    // Notes are keyed by stem, never by the derived `<code>-note-<stem>` id.
    expect(entityTarget(content, "n1")).toEqual({
      lessonId: "bk-l1",
      unitId: "bk-u1",
      page: "theory",
    });
  });

  it("returns null for an id nothing owns", () => {
    // A dangling reference to something already deleted. The error line then
    // renders as plain text with the id showing — the one place an id may
    // still appear, because there is nothing else to name it by.
    expect(entityTarget(content, "bk-gone")).toBeNull();
    expect(entityTarget(content, "unit")).toBeNull();
  });
});

describe("a new Book's first item", () => {
  it("is valid on creation, because the Book seeds a resource", () => {
    // §1d, and the whole reason `freeTextWhenEmpty` existed: without a
    // resource to point at, the very first word an author adds is invalid.
    const { all } = documentProblems(BOOK, DOMAIN, NO_STEMS);
    const sourceProblems = all.filter((problem) =>
      problem.message.includes("sourceRef"),
    );
    expect(sourceProblems).toEqual([]);
  });

  it("would not be, with no resource seeded", () => {
    // The negative half — otherwise the test above passes for the wrong
    // reason if `sourceRef` checking ever stops running.
    const bare = { ...BOOK, resources: [] };
    const { all } = documentProblems(bare, DOMAIN, NO_STEMS);
    expect(all.some((problem) => problem.message.includes("sourceRef"))).toBe(
      true,
    );
  });
});
