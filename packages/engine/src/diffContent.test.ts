import { describe, expect, it } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { diffContent, diffNoteBlocks } from "./diffContent.js";

/**
 * Spec 0021-9 §5. The union is the load-bearing part: without it a deleted
 * entity is absent from the draft and therefore has nowhere to be tinted
 * red, which is the one thing a diff has to be able to show.
 */

const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book",
    description: "",
    lessonIds: ["bk-l1", "bk-l2"],
  },
  lessons: [
    { id: "bk-l1", topicId: "bk", title: "One", goal: "", unitIds: ["bk-u1"] },
    { id: "bk-l2", topicId: "bk", title: "Two", goal: "", unitIds: ["bk-u2"] },
  ],
  units: [
    {
      id: "bk-u1",
      lessonId: "bk-l1",
      title: "Unit one",
      goal: "",
      itemIds: ["bk-i1"],
      taskIds: [],
      noteIds: [],
    },
    {
      id: "bk-u2",
      lessonId: "bk-l2",
      title: "Unit two",
      goal: "",
      itemIds: [],
      taskIds: [],
      noteIds: [],
    },
  ],
  items: [
    {
      id: "bk-i1",
      kind: "concept",
      sourceRef: "bk-r1",
      payload: { term: "Dam", definition: "A wall" },
    },
  ],
  tasks: [],
  resources: [{ id: "bk-r1", title: "Source", path: "s.md" }],
  notes: [],
};

const DOMAIN: DomainDocument = {
  domain: {
    id: "dm",
    code: "dm",
    kind: "general",
    title: "D",
    glossLanguage: "en",
  },
  entries: [],
  families: [],
};

/** Mirrors `emptyDocFor("topic")` (`apps/web/.../ProposalReview.tsx:18`) —
 * the base spec §3b names for a never-published document. Copied rather than
 * imported: engine cannot depend on the web app. */
const EMPTY: BookDocument = {
  topic: {},
  lessons: [],
  units: [],
  items: [],
  tasks: [],
  resources: [],
  notes: [],
};

const edit = (fn: (doc: BookDocument) => BookDocument): BookDocument =>
  fn(JSON.parse(JSON.stringify(BOOK)) as BookDocument);

describe("diffContent", () => {
  it("keeps a removed unit in the union so it has a row to tint", () => {
    const draft = edit((doc) => {
      doc.units = doc.units.filter((u) => (u as { id: string }).id !== "bk-u2");
      return doc;
    });
    const { content, status, before } = diffContent(
      BOOK,
      draft,
      DOMAIN,
      DOMAIN,
    );

    expect(content.units.map((u) => u.id)).toEqual(["bk-u1", "bk-u2"]);
    expect(status.get("bk-u2")).toBe("removed");
    expect((before.get("bk-u2") as { title: string }).title).toBe("Unit two");
  });

  it("keeps a removed id in the reference array the screens actually walk", () => {
    // The one that matters: no screen iterates `content.lessons` — they walk
    // `topic.lessonIds`, `lesson.unitIds`, `unit.itemIds`. An entity in the
    // union collection but missing from its reference array renders nowhere,
    // which is precisely the deletion the union exists to show.
    const draft = edit((doc) => {
      doc.lessons = doc.lessons.filter(
        (l) => (l as { id: string }).id !== "bk-l2",
      );
      (doc.topic as { lessonIds: string[] }).lessonIds = ["bk-l1"];
      (doc.units[0] as { itemIds: string[] }).itemIds = [];
      return doc;
    });
    const { content } = diffContent(BOOK, draft, DOMAIN, DOMAIN);

    expect(content.topic.lessonIds).toEqual(["bk-l1", "bk-l2"]);
    const unit = content.units.find((u) => u.id === "bk-u1")!;
    expect(unit.itemIds).toEqual(["bk-i1"]);
  });

  it("holds the base values for a changed item", () => {
    const draft = edit((doc) => {
      (doc.items[0] as { payload: { term: string } }).payload.term = "Lodge";
      return doc;
    });
    const { status, before } = diffContent(BOOK, draft, DOMAIN, DOMAIN);

    expect(status.get("bk-i1")).toBe("changed");
    expect(
      (before.get("bk-i1") as { payload: { term: string } }).payload.term,
    ).toBe("Dam");
  });

  it("marks the Book changed when only lessonIds are reordered", () => {
    const draft = edit((doc) => {
      (doc.topic as { lessonIds: string[] }).lessonIds = ["bk-l2", "bk-l1"];
      return doc;
    });
    const { status } = diffContent(BOOK, draft, DOMAIN, DOMAIN);

    // The order lives on the Book, so the Book changed and the lessons did
    // not — tinting two untouched lessons would be a lie.
    expect(status.get("topic")).toBe("changed");
    expect(status.get("bk-l1")).toBe("unchanged");
    expect(status.get("bk-l2")).toBe("unchanged");
  });

  it("marks everything added against a never-published base", () => {
    const { status } = diffContent(EMPTY, BOOK, DOMAIN, DOMAIN);

    expect(status.get("topic")).toBe("changed");
    for (const id of ["bk-l1", "bk-l2", "bk-u1", "bk-u2", "bk-i1", "bk-r1"]) {
      expect(status.get(id), id).toBe("added");
    }
  });

  it("reports no change when nothing moved", () => {
    const { status } = diffContent(BOOK, BOOK, DOMAIN, DOMAIN);
    expect([...status.values()].every((s) => s === "unchanged")).toBe(true);
  });
});

describe("diffNoteBlocks", () => {
  const FIVE = [
    "# Title",
    "",
    "First paragraph.",
    "",
    "Second paragraph.",
    "",
    "## Heading",
    "",
    "Third paragraph.",
  ].join("\n");

  it("changes one block of five when one paragraph is edited", () => {
    const edited = FIVE.replace("Second paragraph.", "Second paragraph, now.");
    const blocks = diffNoteBlocks(FIVE, edited);

    // No move detection (§2a), so an edit reads as the old block removed and
    // the new one added — the point being that the other four are untouched.
    expect(blocks.filter((b) => b.status === "unchanged")).toHaveLength(4);
    expect(blocks.filter((b) => b.status === "removed")).toHaveLength(1);
    expect(blocks.filter((b) => b.status === "added")).toHaveLength(1);
  });

  it("reports nothing for a trailing-whitespace-only difference", () => {
    // Slice 1 §1b-bis: `raw` keeps the verbatim source, so comparing `raw`
    // would surface normalisation as an edit. Content is what counts.
    const blocks = diffNoteBlocks(FIVE, `${FIVE}   \n`);
    expect(blocks.every((b) => b.status === "unchanged")).toBe(true);
  });

  it("opening a note and changing nothing produces no diff", () => {
    expect(
      diffNoteBlocks(FIVE, FIVE).every((b) => b.status === "unchanged"),
    ).toBe(true);
  });

  it("counts duplicates, so deleting one of two identical blocks shows one removal", () => {
    const twice = "# T\n\nSame.\n\nSame.\n";
    const once = "# T\n\nSame.\n";
    const blocks = diffNoteBlocks(twice, once);
    expect(blocks.filter((b) => b.status === "removed")).toHaveLength(1);
    expect(blocks.filter((b) => b.status === "unchanged")).toHaveLength(2);
  });
});
