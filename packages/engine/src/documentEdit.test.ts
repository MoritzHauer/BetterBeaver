import { describe, it, expect } from "vitest";
import type { TopicDocument, DomainDocument } from "@betterbeaver/schema";
import {
  moveId,
  removeDomainEntry,
  removeEntity,
  removeNote,
  setNote,
  upsertEntity,
} from "./documentEdit.js";

function topicDoc(): TopicDocument {
  return {
    topic: { id: "t", code: "t", lessonIds: ["l1", "l2"] },
    lessons: [
      { id: "l1", unitIds: ["u1"] },
      { id: "l2", unitIds: [] },
    ],
    units: [
      {
        id: "u1",
        itemIds: ["i1", "i2"],
        taskIds: ["k1"],
        noteIds: ["t-note-intro"],
      },
    ],
    items: [
      { id: "i1", kind: "sentence" },
      { id: "i2", kind: "sentence" },
    ],
    tasks: [{ id: "k1", itemIds: ["i1", "i2"] }],
    resources: [],
    notes: [{ stem: "intro", markdown: "# Intro" }],
  };
}

describe("topic document edit ops", () => {
  it("upsert replaces by id and appends new entities", () => {
    const doc = topicDoc();
    const replaced = upsertEntity(doc, "lessons", { id: "l1", title: "x" });
    expect(replaced.lessons).toHaveLength(2);
    expect((replaced.lessons[0] as { title?: string }).title).toBe("x");
    const appended = upsertEntity(doc, "lessons", { id: "l3" });
    expect(appended.lessons).toHaveLength(3);
    expect(doc.lessons).toHaveLength(2); // input untouched
  });

  it("removeEntity strips every reference to the id", () => {
    const doc = removeEntity(topicDoc(), "items", "i1");
    expect(doc.items.map((i) => (i as { id: string }).id)).toEqual(["i2"]);
    expect((doc.units[0] as { itemIds: string[] }).itemIds).toEqual(["i2"]);
    expect((doc.tasks[0] as { itemIds: string[] }).itemIds).toEqual(["i2"]);
  });

  it("removing a lesson strips it from the topic's lessonIds", () => {
    const doc = removeEntity(topicDoc(), "lessons", "l2");
    expect(doc.lessons).toHaveLength(1);
    expect((doc.topic as { lessonIds: string[] }).lessonIds).toEqual(["l1"]);
  });

  it("note ops use the derived note id for unit references", () => {
    const doc = removeNote(topicDoc(), "intro");
    expect(doc.notes).toEqual([]);
    expect((doc.units[0] as { noteIds: string[] }).noteIds).toEqual([]);
    const withNote = setNote(topicDoc(), "intro", "changed");
    expect(withNote.notes).toEqual([{ stem: "intro", markdown: "changed" }]);
  });
});

describe("moveId", () => {
  it("reorders within bounds and no-ops at edges", () => {
    expect(moveId(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveId(["a", "b"], "missing", 1)).toEqual(["a", "b"]);
  });
});

describe("removeDomainEntry", () => {
  it("strips family membership and reverse links", () => {
    const domain: DomainDocument = {
      domain: { id: "d", code: "d" },
      entries: [
        { id: "e1", payload: { links: [{ type: "synonym", entryId: "e2" }] } },
        { id: "e2", payload: { gloss: "x" } },
      ],
      families: [{ id: "f", entryIds: ["e1", "e2"] }],
    };
    const doc = removeDomainEntry(domain, "e2");
    expect(doc.entries).toHaveLength(1);
    expect(
      (doc.entries[0] as { payload: { links: unknown[] } }).payload.links,
    ).toEqual([]);
    expect((doc.families[0] as { entryIds: string[] }).entryIds).toEqual([
      "e1",
    ]);
  });
});
