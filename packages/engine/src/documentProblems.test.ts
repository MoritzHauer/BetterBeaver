import { describe, it, expect } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { documentProblems } from "./documentProblems.js";
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

/** Fully valid: one book, one lesson, one unit, one sentence item, one
 * "recall" task (no distractor-count requirement, unlike recognize) over
 * it, one resource its sourceRef resolves to. */
function validBook(): BookDocument {
  return {
    topic: {
      id: "b",
      code: "b",
      title: "B",
      description: "",
      lessonIds: ["b-lesson-1"],
      domainId: "d",
    },
    lessons: [
      {
        id: "b-lesson-1",
        topicId: "b",
        title: "L",
        goal: "g",
        unitIds: ["b-unit-1"],
      },
    ],
    units: [
      {
        id: "b-unit-1",
        lessonId: "b-lesson-1",
        title: "U",
        goal: "g",
        itemIds: ["b-item-1"],
        taskIds: ["b-task-1"],
        noteIds: [],
      },
    ],
    items: [
      {
        id: "b-item-1",
        kind: "sentence",
        payload: { text: "hello", translation: "hi" },
        sourceRef: "b-resource-1",
      },
    ],
    tasks: [{ id: "b-task-1", type: "recall", itemIds: ["b-item-1"] }],
    resources: [
      { id: "b-resource-1", title: "R", path: "https://example.com" },
    ],
    notes: [],
  };
}

describe("documentProblems", () => {
  it("reports a field error and a dangling reference from the same document in one call (wave-masking regression, spec 0021-4 §3a)", () => {
    const book = bookWithItems([
      { id: "b-item-1", kind: "sentence", payload: {}, sourceRef: "" },
    ]);

    const { all } = documentProblems(book, emptyDomain(), emptyAssets);

    const fieldProblem = all.find(
      (p) => p.entityId === "b-item-1" && p.path === "payload.text",
    );
    expect(fieldProblem).toBeDefined();

    const referenceProblem = all.find(
      (p) =>
        p.entityId === "b-item-1" &&
        p.path === undefined &&
        p.message.includes("dangling sourceRef"),
    );
    expect(referenceProblem).toBeDefined();
  });

  it("carries the exact field path", () => {
    const book = bookWithItems([
      {
        id: "b-item-1",
        kind: "lexeme",
        // gloss deliberately missing.
        payload: { script: "s", transliteration: "t" },
        sourceRef: "b-resource-1",
      },
    ]);

    const { all } = documentProblems(book, emptyDomain(), emptyAssets);

    const problem = all.find(
      (p) => p.entityId === "b-item-1" && p.path === "payload.gloss",
    );
    expect(problem).toBeDefined();
  });

  it("attaches a topic.lessonIds:-prefixed reference error to topic, not an entity called topic.lessonIds", () => {
    const book: BookDocument = {
      topic: {
        id: "b",
        code: "b",
        title: "B",
        description: "",
        lessonIds: ["b-lesson-missing"],
        domainId: "d",
      },
      lessons: [],
      units: [],
      items: [],
      tasks: [],
      resources: [],
      notes: [],
    };

    const { all, byEntity } = documentProblems(
      book,
      emptyDomain(),
      emptyAssets,
    );

    const problem = all.find(
      (p) =>
        p.message.includes("topic.lessonIds") &&
        p.message.includes("dangling lesson reference"),
    );
    expect(problem).toBeDefined();
    expect(problem?.entityId).toBe("topic");
    expect(byEntity.has("topic.lessonIds")).toBe(false);
    expect(byEntity.get("topic")).toContainEqual(problem);
  });

  it("reports nothing for a valid document", () => {
    const { all, byEntity } = documentProblems(
      validBook(),
      emptyDomain(),
      emptyAssets,
    );

    expect(all).toEqual([]);
    expect(byEntity.size).toBe(0);
  });

  it("keys a reference problem under the same bucket as that entity's own field problems, even when the entity's id isn't a valid slug yet", () => {
    // A mid-edit id (e.g. typed before the editor slugifies it) — checked by
    // slug shape rather than known-id membership, this would misfile the
    // entity's reference problems under "topic" instead of its own bucket.
    const book = bookWithItems([
      { id: "Ky_Item_A", kind: "sentence", payload: {}, sourceRef: "" },
    ]);

    const { byEntity } = documentProblems(book, emptyDomain(), emptyAssets);

    const bucket = byEntity.get("Ky_Item_A") ?? [];
    expect(bucket.some((p) => p.path === "payload.text")).toBe(true);
    expect(bucket.some((p) => p.message.includes("dangling sourceRef"))).toBe(
      true,
    );
    expect(byEntity.has("topic")).toBe(false);
  });

  it("attaches a class (y) book-id-prefixed reference error to topic, not to the book's own id", () => {
    const book: BookDocument = {
      // Valid slug shape, so a shape-based prefix test would mistake it for
      // a real entity id instead of recognizing it as the book singleton.
      topic: {
        id: "user-thing",
        code: "user-thing",
        title: "B",
        description: "",
        lessonIds: [],
        domainId: "d",
      },
      lessons: [],
      units: [],
      items: [],
      tasks: [],
      resources: [],
      notes: [],
    };

    const { all, byEntity } = documentProblems(
      book,
      emptyDomain(),
      emptyAssets,
    );

    const problem = all.find((p) => p.message.includes("reserved for"));
    expect(problem).toBeDefined();
    expect(problem?.entityId).toBe("topic");
    expect(byEntity.has("user-thing")).toBe(false);
    expect(byEntity.get("topic")).toContainEqual(problem);
  });

  it("does not throw on a malformed document, and omits path for a whole-entity problem", () => {
    // Same reachable path as `draftContent`'s equivalent case: a working
    // document restored from localStorage is shape-unchecked, so a missing
    // or wrong-typed list field must degrade rather than throw.
    const truncated = { topic: { id: "b", code: "b" } } as unknown;
    expect(() =>
      documentProblems(
        truncated as BookDocument,
        {} as unknown as DomainDocument,
        emptyAssets,
      ),
    ).not.toThrow();

    const book = {
      topic: { id: "b", code: "b", title: "B", summary: "S" },
      lessons: [],
      units: [],
      // A non-object entity yields `issue.path === []`; `Problem`'s contract
      // is that `path` is then absent, not "".
      items: ["not an object"],
      tasks: [],
      resources: [],
      notes: [],
    } as unknown as BookDocument;

    const { all } = documentProblems(book, emptyDomain(), emptyAssets);

    const wholeEntity = all.find((p) => p.path === undefined);
    expect(wholeEntity).toBeDefined();
    expect(all.some((p) => p.path === "")).toBe(false);
  });
});
