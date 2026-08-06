import { describe, it, expect } from "vitest";
import {
  documentId,
  type BookDocument,
  type DomainDocument,
} from "@betterbeaver/schema";
import type { AssetStems } from "@betterbeaver/engine";
import { buildMembers, withoutDocStems } from "./source";
import type { CachedDocument } from "./cache";
import type { PrivateBookRecord } from "./private-store";

// A minimal, independently-valid book+domain pair with one item whose
// `audioRef` points at a stem the base inventory doesn't have — the shape
// `documentSource.test.ts`'s `makeBook` uses, trimmed to just what an
// `audioRef` dangling-reference check needs.
function makeBook(): { book: BookDocument; domain: DomainDocument } {
  const resource = {
    id: "book-a-resource",
    title: "Manual",
    path: "https://example.com/manual",
  };
  const items = [
    {
      id: "book-a-item-1",
      kind: "concept",
      payload: {
        term: "Item",
        definition: "definition",
        audioRef: "book-a-clip",
      },
      sourceRef: resource.id,
    },
    {
      id: "book-a-item-2",
      kind: "concept",
      payload: { term: "b", definition: "definition b" },
      sourceRef: resource.id,
    },
    {
      id: "book-a-item-3",
      kind: "concept",
      payload: { term: "c", definition: "definition c" },
      sourceRef: resource.id,
    },
    {
      id: "book-a-item-4",
      kind: "concept",
      payload: { term: "d", definition: "definition d" },
      sourceRef: resource.id,
    },
  ];
  const task = {
    id: "book-a-task-recognize",
    type: "recognize",
    itemIds: items.map((item) => item.id),
  };
  const unit = {
    id: "book-a-unit-1",
    lessonId: "book-a-lesson-1",
    title: "Unit",
    goal: "learn",
    itemIds: items.map((item) => item.id),
    taskIds: [task.id],
    noteIds: [],
  };
  const lesson = {
    id: "book-a-lesson-1",
    topicId: "book-a",
    title: "Lesson",
    goal: "learn",
    unitIds: [unit.id],
  };
  const topic = {
    id: "book-a",
    code: "book-a",
    title: "book-a",
    description: "book-a book",
    lessonIds: [lesson.id],
    domainId: "domain-a",
  };
  const domain = {
    id: "domain-a",
    code: "code-a",
    kind: "general",
    title: "domain-a",
    glossLanguage: "en",
  };
  return {
    book: {
      topic,
      lessons: [lesson],
      units: [unit],
      items,
      tasks: [task],
      resources: [resource],
      notes: [],
    },
    domain: { domain, entries: [], families: [] },
  };
}

function cachedDocs(
  book: BookDocument,
  domain: DomainDocument,
): CachedDocument[] {
  return [
    {
      id: documentId("topic", "book-a"),
      kind: "topic",
      version: 1,
      schemaVersion: 1,
      doc: book,
    },
    {
      id: documentId("domain", "domain-a"),
      kind: "domain",
      version: 1,
      schemaVersion: 1,
      doc: domain,
    },
  ];
}

const noPrivate = new Map<string, PrivateBookRecord>();

describe("buildMembers extraStems (spec 0012-B §4b)", () => {
  it("rejects a document whose audioRef isn't in the (bundled/private/registered) inventory", () => {
    const { book, domain } = makeBook();
    const cachedById = new Map(
      cachedDocs(book, domain).map((doc) => [doc.id, doc]),
    );
    const { built } = buildMembers(cachedById, ["book-a"], noPrivate);
    expect(built.broken.map((b) => b.bookId)).toEqual(["book-a"]);
    expect(built.broken[0]?.errors[0]).toMatch(/dangling audioRef/);
  });

  it("accepts it once extraStems supplies the stem, with nothing else changed", () => {
    const { book, domain } = makeBook();
    const cachedById = new Map(
      cachedDocs(book, domain).map((doc) => [doc.id, doc]),
    );
    const extraStems: AssetStems = {
      audioByBook: new Map([["book-a", ["book-a-clip"]]]),
      imageByBook: new Map(),
      audioByDomain: new Map(),
      imageByDomain: new Map(),
    };
    const { built } = buildMembers(
      cachedById,
      ["book-a"],
      noPrivate,
      extraStems,
    );
    expect(built.broken).toEqual([]);
  });
});

/**
 * The accept dry run's inventory rule (see `withoutDocStems`): a document
 * this accept just listed fresh has its registered stems **replaced**, every
 * other document keeps them.
 *
 * Both halves are load-bearing and they fail in opposite directions. Keeping
 * an unchanged document's stems is what stops a Book from being rejected for
 * a `dangling audioRef` the moment you publish a change to only one of its
 * two documents — the common case, since most edits touch the Book or the
 * words, not both. Dropping a changed document's stems is what stops a
 * *deleted* asset surviving from the last boot's overlay and an update
 * committing with references that already point at nothing.
 */
describe("withoutDocStems", () => {
  const registered: AssetStems = {
    audioByBook: new Map([["book-a", ["a-old"]]]),
    imageByBook: new Map([["book-a", ["a-img"]]]),
    audioByDomain: new Map([["dom-a", ["d-old"]]]),
    imageByDomain: new Map([["dom-a", ["d-img"]]]),
  };

  it("drops both pools of a listed topic document, leaving the domain's", () => {
    const out = withoutDocStems(registered, [documentId("topic", "book-a")]);
    expect(out.audioByBook.has("book-a")).toBe(false);
    expect(out.imageByBook.has("book-a")).toBe(false);
    expect(out.audioByDomain.get("dom-a")).toEqual(["d-old"]);
    expect(out.imageByDomain.get("dom-a")).toEqual(["d-img"]);
  });

  it("drops both pools of a listed domain document, leaving the Book's", () => {
    const out = withoutDocStems(registered, [documentId("domain", "dom-a")]);
    expect(out.audioByDomain.has("dom-a")).toBe(false);
    expect(out.imageByDomain.has("dom-a")).toBe(false);
    expect(out.audioByBook.get("book-a")).toEqual(["a-old"]);
    expect(out.imageByBook.get("book-a")).toEqual(["a-img"]);
  });

  it("keeps everything when nothing was listed", () => {
    const out = withoutDocStems(registered, []);
    expect(out.audioByBook.get("book-a")).toEqual(["a-old"]);
    expect(out.audioByDomain.get("dom-a")).toEqual(["d-old"]);
  });

  it("never lets a topic id drop a same-named domain's stems", () => {
    const shared: AssetStems = {
      audioByBook: new Map([["same", ["book-clip"]]]),
      imageByBook: new Map(),
      audioByDomain: new Map([["same", ["lexicon-clip"]]]),
      imageByDomain: new Map(),
    };
    const out = withoutDocStems(shared, [documentId("topic", "same")]);
    expect(out.audioByBook.has("same")).toBe(false);
    expect(out.audioByDomain.get("same")).toEqual(["lexicon-clip"]);
  });
});
