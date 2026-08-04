import { describe, it, expect } from "vitest";
import {
  checkReferences,
  type BookDocument,
  type DomainDocument,
} from "@betterbeaver/schema";
import { draftContent } from "./draftContent.js";
import type { AssetStems } from "./documentSource.js";

const emptyAssets: AssetStems = {
  audioByBook: new Map(),
  imageByBook: new Map(),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

function emptyDomain(): DomainDocument {
  return {
    domain: {
      id: "d",
      code: "d",
      kind: "language",
      title: "D",
      glossLanguage: "en",
    },
    entries: [],
    families: [],
  };
}

function bookWithItems(items: unknown[]): BookDocument {
  return {
    topic: {
      id: "b",
      code: "b",
      title: "B",
      description: "",
      lessonIds: [],
      domainId: "d",
    },
    lessons: [],
    units: [],
    items,
    tasks: [],
    resources: [],
    notes: [],
  };
}

describe("draftContent", () => {
  it("turns a verbatim freshly-created item into a renderable row (row survives, spec 0021-4 §2a)", () => {
    const book = bookWithItems([
      { id: "b-item-1", kind: "sentence", payload: {}, sourceRef: "" },
    ]);

    const { content } = draftContent(book, emptyDomain(), emptyAssets);

    expect(content.items).toHaveLength(1);
    const item = content.items[0];
    expect(item?.kind).toBe("sentence");
    if (item?.kind === "sentence") {
      expect(item.payload.text).toBe("");
      expect(item.payload.translation).toBe("");
    }
  });

  it("defaults an unknown kind to sentence instead of dropping the entity", () => {
    const book = bookWithItems([
      {
        id: "b-item-1",
        kind: "mystery-kind",
        payload: { text: "hi", translation: "hi" },
        sourceRef: "b-resource-1",
      },
    ]);

    const { content } = draftContent(book, emptyDomain(), emptyAssets);

    expect(content.items).toHaveLength(1);
    expect(content.items[0]?.kind).toBe("sentence");
  });

  it("omits an absent audioRef instead of coercing it to an empty string", () => {
    const book = bookWithItems([
      {
        id: "b-item-1",
        kind: "sentence",
        payload: { text: "hi", translation: "hi" },
        sourceRef: "b-resource-1",
      },
    ]);

    const { content } = draftContent(book, emptyDomain(), emptyAssets);

    const item = content.items[0];
    expect(item?.kind).toBe("sentence");
    if (item?.kind === "sentence") {
      expect("audioRef" in item.payload).toBe(false);
    }
  });

  it("merges a unit-referenced domain entry into content.items but keeps parsed.items book-owned-only (§1a)", () => {
    const domain: DomainDocument = {
      domain: {
        id: "d",
        code: "d",
        kind: "language",
        title: "D",
        glossLanguage: "en",
      },
      entries: [
        {
          id: "d-entry-1",
          kind: "lexeme",
          payload: { script: "s", transliteration: "t", gloss: "g" },
          sourceRef: "d-resource-1",
        },
      ],
      families: [],
    };
    const book: BookDocument = {
      topic: {
        id: "b",
        code: "b",
        title: "B",
        description: "",
        lessonIds: [],
        domainId: "d",
      },
      lessons: [],
      units: [
        {
          id: "b-unit-1",
          lessonId: "b-lesson-1",
          title: "U",
          goal: "g",
          itemIds: ["d-entry-1"],
          taskIds: [],
          noteIds: [],
        },
      ],
      items: [],
      tasks: [],
      resources: [],
      notes: [],
    };

    const { content, parsed } = draftContent(book, domain, emptyAssets);

    expect(content.items.map((i) => i.id)).toContain("d-entry-1");
    expect(parsed.items.map((i) => i.id)).not.toContain("d-entry-1");
  });

  it("never throws on garbage input (undefined payloads, arrays where objects belong, numbers where strings belong)", () => {
    const book = {
      topic: "not an object",
      lessons: [null, 5, "x", { id: 123 }],
      units: [undefined, [], { itemIds: "not an array", taskIds: 5 }],
      items: [
        { id: "b-item-1", kind: "lexeme", payload: undefined, sourceRef: 5 },
        {
          id: "b-item-2",
          kind: "pair",
          payload: { a: "not an object", b: 5, contrast: 7 },
          sourceRef: null,
        },
        { id: "b-item-3", kind: 42, payload: [1, 2, 3], sourceRef: {} },
      ],
      tasks: [{ id: "b-task-1", type: 5, itemIds: "not an array" }],
      resources: [42, "nope"],
      // `null`, not `"not a note"`: property access on a string yields
      // `undefined` rather than throwing, so a string entry passes even
      // without a guard. `null` is what actually exercises one.
      notes: [{ stem: 5, markdown: null }, null, "not a note"],
    } as unknown as BookDocument;
    const domain = {
      domain: 5,
      entries: [null, "nope"],
      families: ["nope", { id: 1, entryIds: "nope" }],
    } as unknown as DomainDocument;

    expect(() => draftContent(book, domain, emptyAssets)).not.toThrow();
  });

  it("does not throw when a document's list fields are missing or not arrays", () => {
    // The reachable case, not a hypothetical: `MaintainEditScreen` restores
    // its working document with `JSON.parse(localStorage)`, whose try/catch
    // guards the parse but not the shape. A truncated or stale-schema draft
    // is valid JSON with a missing `lessons`, and that document is what the
    // in-place editor hands straight to `draftContent`.
    const truncated = { topic: { id: "b", code: "b" } } as unknown;
    expect(() =>
      draftContent(
        truncated as BookDocument,
        {} as unknown as DomainDocument,
        emptyAssets,
      ),
    ).not.toThrow();

    const wrongTypes = {
      topic: {},
      lessons: "nope",
      units: 5,
      items: null,
      tasks: {},
      resources: undefined,
      notes: 42,
    } as unknown as BookDocument;
    const wrongDomain = {
      domain: {},
      entries: "nope",
      families: 7,
    } as unknown as DomainDocument;
    expect(() =>
      draftContent(wrongTypes, wrongDomain, emptyAssets),
    ).not.toThrow();
  });

  it("produces a parsed set checkReferences can run to completion on, even when the raw document fails phase 1", () => {
    const book = bookWithItems([
      { id: "b-item-1", kind: "sentence", payload: {}, sourceRef: "" },
    ]);

    const { parsed } = draftContent(book, emptyDomain(), emptyAssets);

    let errors: string[] = [];
    expect(() => {
      errors = checkReferences(parsed);
    }).not.toThrow();
    // The empty sourceRef doesn't resolve to any resource — a real, expected
    // reference error (spec 0021-4 §3b), proving the reference phase ran.
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("draftContent: the Book's optional display fields", () => {
  it("carries icon and hasCoverArt through, and leaves them absent otherwise", () => {
    // Edit mode renders *this* Book, so a dropped field reads as a control
    // that does nothing (plan 0021 §1a).
    const withBoth = draftContent(
      {
        topic: {
          id: "b",
          code: "b",
          domainId: "d",
          icon: "\u{1F9AB}",
          hasCoverArt: true,
        },
        lessons: [],
        units: [],
        items: [],
        tasks: [],
        resources: [],
        notes: [],
      },
      { domain: {}, entries: [], families: [] },
      emptyAssets,
    ).content.topic;
    expect(withBoth.icon).toBe("\u{1F9AB}");
    expect(withBoth.hasCoverArt).toBe(true);

    const without = draftContent(
      {
        topic: { id: "b", code: "b", domainId: "d" },
        lessons: [],
        units: [],
        items: [],
        tasks: [],
        resources: [],
        notes: [],
      },
      { domain: {}, entries: [], families: [] },
      emptyAssets,
    ).content.topic;
    expect("icon" in without).toBe(false);
    expect("hasCoverArt" in without).toBe(false);
  });
});
