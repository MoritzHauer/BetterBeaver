import { describe, expect, it } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import type { EditSessionValue } from "./EditSessionContext";
import { unitEditOps, withUnlocksAfter } from "./inPlace";

/**
 * The two mutations that fail *silently* (spec 0021-6 §2d, §2a): writing an
 * edit into the wrong document, and clearing an optional key by setting it
 * to `undefined` instead of deleting it. Neither throws, neither shows up in
 * a render assertion, and both corrupt content — so they get their own test
 * away from the screen.
 */
function makeSession(overrides: Partial<EditSessionValue> = {}) {
  const book: BookDocument = {
    topic: { id: "b", code: "bk", domainId: "d" },
    lessons: [{ id: "bk-l1", title: "L", goal: "", unitIds: ["bk-u1"] }],
    units: [
      {
        id: "bk-u1",
        lessonId: "bk-l1",
        title: "U",
        goal: "",
        // One Book-owned item, one lexicon entry, one dangling reference.
        itemIds: ["bk-i1", "dm-e1", "ghost"],
        taskIds: [],
        noteIds: [],
      },
    ],
    items: [
      {
        id: "bk-i1",
        kind: "sentence",
        sourceRef: "bk-r1",
        payload: { text: "hi", translation: "hi" },
      },
    ],
    tasks: [],
    resources: [{ id: "bk-r1", title: "R", kind: "book" }],
    notes: [],
  };
  const domain: DomainDocument = {
    domain: {
      id: "d",
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
        payload: { script: "a", transliteration: "a", gloss: "a" },
      },
    ],
    families: [],
  };

  const written: { book: BookDocument[]; domain: DomainDocument[] } = {
    book: [],
    domain: [],
  };
  const session: EditSessionValue = {
    mode: "private",
    book,
    domain,
    changeBook: (next: BookDocument) => written.book.push(next),
    changeDomain: (next: DomainDocument) => written.domain.push(next),
    content: {} as EditSessionValue["content"],
    noteMarkdown: () => undefined,
    problems: [],
    problemsByEntity: new Map(),
    readOnly: false,
    canEditLexicon: true,
    assets: [],
    save: "saved",
    publish: { s: "idle" },
    ...overrides,
  };
  return { session, written, book, domain };
}

describe("unitEditOps", () => {
  it("returns null in learner mode", () => {
    expect(unitEditOps(null, "bk-u1")).toBeNull();
  });

  it("routes a Book item's edit to the Book and an entry's to the lexicon", () => {
    const { session, written } = makeSession();
    const ops = unitEditOps(session, "bk-u1")!;

    ops.patchEntity({ id: "bk-i1", kind: "sentence", payload: { text: "x" } });
    expect(written.book).toHaveLength(1);
    expect(written.domain).toHaveLength(0);

    ops.patchEntity({ id: "dm-e1", kind: "lexeme", payload: { script: "x" } });
    expect(written.book).toHaveLength(1);
    expect(written.domain).toHaveLength(1);
    expect(
      (written.domain[0]!.entries[0] as { payload: { script: string } }).payload
        .script,
    ).toBe("x");
  });

  it("writes nothing for an id in neither document", () => {
    const { session, written } = makeSession();
    const ops = unitEditOps(session, "bk-u1")!;

    // A dangling `itemIds` reference is routine mid-edit; guessing a
    // document here would silently create the entity there.
    ops.patchEntity({ id: "ghost", kind: "sentence", payload: { text: "x" } });
    expect(written.book).toHaveLength(0);
    expect(written.domain).toHaveLength(0);
    expect(ops.canEditRow("ghost")).toBe(false);
  });

  it("deletes a Book item but only unlinks a lexicon entry", () => {
    const { session, written } = makeSession();
    const ops = unitEditOps(session, "bk-u1")!;

    expect(ops.removeLabel("bk-i1")).toBe("Delete");
    expect(ops.removeLabel("dm-e1")).toBe("Unlink");

    ops.removeRow("bk-i1");
    expect(written.book[0]!.items).toHaveLength(0);
    expect(
      (written.book[0]!.units[0] as { itemIds: string[] }).itemIds,
    ).not.toContain("bk-i1");

    ops.removeRow("dm-e1");
    // The entry survives: only the unit's reference to it is gone.
    expect(written.domain).toHaveLength(0);
    expect(
      (written.book[1]!.units[0] as { itemIds: string[] }).itemIds,
    ).toEqual(["bk-i1", "ghost"]);
  });

  it("creates a lexicon entry with the domain's code and the unit's reference", () => {
    const { session, written } = makeSession();
    const ops = unitEditOps(session, "bk-u1")!;

    ops.addItem("lexeme");
    const entries = written.domain[0]!.entries as { id: string }[];
    expect(entries).toHaveLength(2);
    expect(entries[1]!.id.startsWith("dm-")).toBe(true);
    expect(
      (written.book[0]!.units[0] as { itemIds: string[] }).itemIds,
    ).toContain(entries[1]!.id);
  });

  it("creates an example as a Book item, in one write", () => {
    const { session, written } = makeSession();
    const ops = unitEditOps(session, "bk-u1")!;

    ops.addItem("sentence");
    // One document, not two — a second `changeBook` would start from the
    // stale capture and drop the item the first just added.
    expect(written.book).toHaveLength(1);
    const items = written.book[0]!.items as { id: string }[];
    expect(items).toHaveLength(2);
    expect(items[1]!.id.startsWith("bk-")).toBe(true);
    expect(
      (written.book[0]!.units[0] as { itemIds: string[] }).itemIds,
    ).toContain(items[1]!.id);
  });

  it("leaves lexicon rows read-only when the lexicon is not this user's", () => {
    const { session } = makeSession({ canEditLexicon: false });
    const ops = unitEditOps(session, "bk-u1")!;

    expect(ops.canEditRow("dm-e1")).toBe(false);
    // A Book item on the same page is unaffected.
    expect(ops.canEditRow("bk-i1")).toBe(true);
    expect(ops.lexicon?.onAddEntry).toBeUndefined();
  });

  it("adds a note with a seeded heading and wires its derived id", () => {
    const { session, written } = makeSession();
    const ops = unitEditOps(session, "bk-u1")!;

    ops.addNote();
    const notes = written.book[0]!.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.markdown).toBe("# New note\n\n");
    expect(
      (written.book[0]!.units[0] as { noteIds: string[] }).noteIds,
    ).toEqual([`bk-note-${notes[0]!.stem}`]);
  });
});

describe("withUnlocksAfter", () => {
  it("deletes the key when cleared, rather than setting undefined", () => {
    const set = withUnlocksAfter({ id: "u" }, "bk-u2");
    expect(set.unlocksAfterUnitId).toBe("bk-u2");

    const cleared = withUnlocksAfter(set, undefined);
    // `=== undefined` would pass on the bug: an `undefined` value survives
    // in memory and vanishes across the JSON round-trip to storage.
    expect("unlocksAfterUnitId" in cleared).toBe(false);
  });
});
