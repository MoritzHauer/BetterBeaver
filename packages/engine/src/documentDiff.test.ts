import { describe, it, expect } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import {
  canonicalJson,
  diffBookDocument,
  diffCollection,
  diffDomainDocument,
} from "./documentDiff.js";

function bookDoc(): BookDocument {
  return {
    topic: { id: "t", code: "t", title: "Title" },
    lessons: [{ id: "l1", title: "Lesson one" }],
    units: [],
    items: [
      { id: "i1", kind: "sentence", payload: { text: "hello" } },
      { id: "i2", kind: "sentence", payload: { text: "keep" } },
    ],
    tasks: [],
    resources: [],
    notes: [{ stem: "intro", markdown: "# Intro" }],
  };
}

describe("canonicalJson", () => {
  it("is insensitive to object key order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("distinguishes actually different values", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it("recurses into nested objects and arrays", () => {
    const x = { a: [{ z: 1, y: 2 }] };
    const y = { a: [{ y: 2, z: 1 }] };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
  });
});

describe("diffCollection", () => {
  it("classifies added, removed, and changed entities", () => {
    const base = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    const proposed = [
      { id: "a", value: 1 }, // unchanged
      { id: "b", value: 99 }, // changed
      { id: "c", value: 3 }, // added
    ];
    const diff = diffCollection(base, proposed, (e) => e.id);
    expect(diff.added).toEqual(["c"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([
      { id: "b", fields: [{ path: "value", before: "2", after: "99" }] },
    ]);
  });

  it("reports a removed entity absent from the proposal", () => {
    const base = [{ id: "a", value: 1 }];
    const diff = diffCollection(base, [], (e) => e.id);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.changed).toEqual([]);
  });

  it("treats key-reordered objects as unchanged", () => {
    const base = [{ id: "a", x: 1, y: 2 }];
    const proposed = [{ id: "a", y: 2, x: 1 }];
    const diff = diffCollection(base, proposed, (e) => e.id);
    expect(diff.changed).toEqual([]);
  });

  it("keys notes by stem, not id", () => {
    const base = [{ stem: "s1", markdown: "old" }];
    const proposed = [{ stem: "s1", markdown: "new" }];
    const diff = diffCollection(base, proposed, (n) => n.stem);
    expect(diff.changed).toEqual([
      { id: "s1", fields: [{ path: "markdown", before: "old", after: "new" }] },
    ]);
  });
});

describe("diffBookDocument", () => {
  it("diffs every collection plus the singleton topic entity", () => {
    const base = bookDoc();
    const proposed: BookDocument = {
      ...base,
      topic: { ...(base.topic as Record<string, unknown>), title: "New title" },
      items: [
        base.items[0], // unchanged
        { id: "i2", kind: "sentence", payload: { text: "changed" } },
        { id: "i3", kind: "sentence", payload: { text: "new" } },
      ],
    };
    const diff = diffBookDocument(base, proposed);
    expect(diff.topic.changed).toEqual([
      {
        id: "topic",
        fields: [{ path: "title", before: "Title", after: "New title" }],
      },
    ]);
    expect(diff.items.added).toEqual(["i3"]);
    expect(diff.items.changed.map((c) => c.id)).toEqual(["i2"]);
    expect(diff.lessons.added).toEqual([]);
    expect(diff.lessons.removed).toEqual([]);
    expect(diff.lessons.changed).toEqual([]);
  });

  it("reports a removed note by stem", () => {
    const base = bookDoc();
    const proposed: BookDocument = { ...base, notes: [] };
    const diff = diffBookDocument(base, proposed);
    expect(diff.notes.removed).toEqual(["intro"]);
  });
});

describe("diffDomainDocument", () => {
  it("diffs entries and families plus the singleton domain entity", () => {
    const base: DomainDocument = {
      domain: { id: "d", code: "d", title: "Domain" },
      entries: [{ id: "e1", payload: { gloss: "old" } }],
      families: [{ id: "f1", entryIds: ["e1"] }],
    };
    const proposed: DomainDocument = {
      domain: { id: "d", code: "d", title: "Domain" },
      entries: [
        { id: "e1", payload: { gloss: "new" } },
        { id: "e2", payload: { gloss: "added" } },
      ],
      families: [{ id: "f1", entryIds: ["e1", "e2"] }],
    };
    const diff = diffDomainDocument(base, proposed);
    expect(diff.domain.changed).toEqual([]);
    expect(diff.entries.added).toEqual(["e2"]);
    expect(diff.entries.changed.map((c) => c.id)).toEqual(["e1"]);
    expect(diff.families.changed.map((c) => c.id)).toEqual(["f1"]);
  });
});
