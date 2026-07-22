/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { DomainDocument, BookDocument } from "@betterbeaver/schema";
import {
  createDocumentContentSource,
  planUpdate,
  type AssetStems,
  type CatalogRow,
} from "./documentSource.js";

// --- createDocumentContentSource over the real shipped content ------------
// content.test.ts (schema) validates each book in isolation; this is the
// cross-document companion: the whole shipped tree must assemble into one
// valid content set through the same builder the app boots with.

const CONTENT_DIR = fileURLToPath(new URL("../../../content", import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readJsonFilesIn(dir: string): unknown[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(join(dir, name)));
}

function readAssetStems(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).map((name) => name.replace(/\.[^.]+$/, ""));
}

function loadFromFs(): {
  books: Map<string, BookDocument>;
  domains: Map<string, DomainDocument>;
  assets: AssetStems;
} {
  const books = new Map<string, BookDocument>();
  const domains = new Map<string, DomainDocument>();
  const assets: AssetStems = {
    audioByBook: new Map(),
    imageByBook: new Map(),
    audioByDomain: new Map(),
    imageByDomain: new Map(),
  };
  const bookDirNames = readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "lexicon")
    .map((entry) => entry.name);
  for (const name of bookDirNames) {
    const dir = join(CONTENT_DIR, name);
    const notesDir = join(dir, "notes");
    books.set(name, {
      topic: readJson(join(dir, "topic.json")),
      lessons: readJsonFilesIn(join(dir, "lessons")),
      units: readJsonFilesIn(join(dir, "units")),
      items: readJsonFilesIn(join(dir, "items")),
      tasks: readJsonFilesIn(join(dir, "tasks")),
      resources: readJson(join(dir, "resources.json")) as unknown[],
      notes: (existsSync(notesDir) ? readdirSync(notesDir) : [])
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({
          stem: file.slice(0, -".md".length),
          markdown: readFileSync(join(notesDir, file), "utf-8"),
        })),
    });
    assets.audioByBook.set(name, readAssetStems(join(dir, "assets", "audio")));
    assets.imageByBook.set(name, readAssetStems(join(dir, "assets", "img")));
  }
  const lexiconDir = join(CONTENT_DIR, "lexicon");
  for (const name of existsSync(lexiconDir) ? readdirSync(lexiconDir) : []) {
    const dir = join(lexiconDir, name);
    domains.set(name, {
      domain: readJson(join(dir, "domain.json")),
      entries: readJsonFilesIn(join(dir, "entries")),
      families: readJsonFilesIn(join(dir, "families")),
    });
    assets.audioByDomain.set(
      name,
      readAssetStems(join(dir, "assets", "audio")),
    );
    assets.imageByDomain.set(name, readAssetStems(join(dir, "assets", "img")));
  }
  return { books, domains, assets };
}

describe("createDocumentContentSource", () => {
  it("assembles the shipped content tree into a valid set", async () => {
    const { books, domains, assets } = loadFromFs();
    expect(books.size).toBeGreaterThan(0);
    const built = createDocumentContentSource(books, domains, assets);
    expect(built.broken).toEqual([]);
    expect((await built.source.listBooks()).length).toBe(books.size);
    expect((await built.source.listDomains()).length).toBe(domains.size);
  });

  it("serves note markdown from the documents", () => {
    const { books, domains, assets } = loadFromFs();
    const built = createDocumentContentSource(books, domains, assets);
    const [bookId, doc] = [...books].find(
      ([, candidate]) => candidate.notes.length > 0,
    )!;
    const note = doc.notes[0]!;
    expect(built.noteMarkdown(bookId, note.stem)).toBe(note.markdown);
    expect(built.noteMarkdown(bookId, "no-such-stem")).toBeUndefined();
  });
});

// --- createDocumentContentSource: per-Book `broken` (plan 0015 decision 11a) ----

/**
 * A minimal, independently-valid book+domain pair — four book-owned concept
 * items (a recognize task needs >= 4), one unit, no lexicon entries. `code`
 * defaults to `bookId` but can be shared across two books (entity ids are
 * required to start with "<code>-", not "<bookId>-") — the only way two
 * Books can legally define the very same item id, for the collision test.
 */
function makeBook(opts: {
  bookId: string;
  domainId: string;
  domainCode: string;
  itemIds: [string, string, string, string];
  code?: string;
}): { bookDoc: BookDocument; domainDoc: DomainDocument } {
  const { bookId, domainId, domainCode, itemIds, code = bookId } = opts;
  const resource = {
    id: `${code}-resource`,
    title: "Manual",
    path: "https://example.com/manual",
  };
  const items = itemIds.map((id, index) => ({
    id,
    kind: "concept",
    payload: {
      term: `Item ${index}`,
      definition: `${bookId} definition ${index}`,
    },
    sourceRef: resource.id,
  }));
  const task = {
    id: `${code}-task-recognize`,
    type: "recognize",
    itemIds: items.map((item) => item.id),
  };
  const unit = {
    id: `${code}-unit-1`,
    lessonId: `${code}-lesson-1`,
    title: "Unit",
    goal: "learn",
    itemIds: items.map((item) => item.id),
    taskIds: [task.id],
    noteIds: [] as string[],
  };
  const lesson = {
    id: `${code}-lesson-1`,
    topicId: bookId,
    title: "Lesson",
    goal: "learn",
    unitIds: [unit.id],
  };
  const topic = {
    id: bookId,
    code,
    title: bookId,
    description: `${bookId} book`,
    lessonIds: [lesson.id],
    domainId,
  };
  const domain = {
    id: domainId,
    code: domainCode,
    kind: "general",
    title: domainId,
    glossLanguage: "en",
  };
  return {
    bookDoc: {
      topic,
      lessons: [lesson],
      units: [unit],
      items,
      tasks: [task],
      resources: [resource],
      notes: [],
    } as unknown as BookDocument,
    domainDoc: {
      domain,
      entries: [],
      families: [],
    } as unknown as DomainDocument,
  };
}

const emptyAssets: AssetStems = {
  audioByBook: new Map(),
  imageByBook: new Map(),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

describe("createDocumentContentSource: broken", () => {
  it("reports a per-Book validation failure without affecting the other Book", async () => {
    const a = makeBook({
      bookId: "book-a",
      domainId: "domain-a",
      domainCode: "code-a",
      itemIds: [
        "book-a-item-1",
        "book-a-item-2",
        "book-a-item-3",
        "book-a-item-4",
      ],
    });
    const b = makeBook({
      bookId: "book-b",
      domainId: "domain-b",
      domainCode: "code-b",
      itemIds: [
        "book-b-item-1",
        "book-b-item-2",
        "book-b-item-3",
        "book-b-item-4",
      ],
    });
    // Break book-b with a dangling sourceRef (a genuine validateContent error).
    (b.bookDoc.items[0] as { sourceRef: string }).sourceRef =
      "no-such-resource";

    const books = new Map([
      ["book-a", a.bookDoc],
      ["book-b", b.bookDoc],
    ]);
    const domains = new Map([
      ["domain-a", a.domainDoc],
      ["domain-b", b.domainDoc],
    ]);
    const built = createDocumentContentSource(books, domains, emptyAssets);

    expect(built.broken.map((entry) => entry.bookId)).toEqual(["book-b"]);
    expect(built.broken[0]?.errors[0]).toMatch(/dangling sourceRef/);
    expect((await built.source.listBooks()).map((book) => book.id)).toEqual([
      "book-a",
    ]);
  });

  it("excludes the later Book on a cross-Book item id collision, earliest wins", async () => {
    // Item ids must start with "<code>-" (schema rule), so two Books can
    // only legally collide on an item id by sharing a `code` — an unusual
    // but not-otherwise-forbidden setup, and the only way to construct this
    // fixture.
    const a = makeBook({
      bookId: "book-a",
      domainId: "domain-a",
      domainCode: "code-a",
      code: "dup",
      itemIds: ["dup-item-shared", "dup-item-a2", "dup-item-a3", "dup-item-a4"],
    });
    const b = makeBook({
      bookId: "book-b",
      domainId: "domain-b",
      domainCode: "code-b",
      code: "dup",
      itemIds: ["dup-item-shared", "dup-item-b2", "dup-item-b3", "dup-item-b4"],
    });

    const books = new Map([
      ["book-a", a.bookDoc],
      ["book-b", b.bookDoc],
    ]);
    const domains = new Map([
      ["domain-a", a.domainDoc],
      ["domain-b", b.domainDoc],
    ]);
    const built = createDocumentContentSource(books, domains, emptyAssets);

    expect(built.broken.map((entry) => entry.bookId)).toEqual(["book-b"]);
    expect(built.broken[0]?.errors[0]).toMatch(/duplicate item id/);
    expect((await built.source.listBooks()).map((book) => book.id)).toEqual([
      "book-a",
    ]);
    expect((await built.source.listDomains()).map((d) => d.id)).toEqual([
      "domain-a",
    ]);
  });
});

// --- planUpdate -----------------------------------------------------------

function row(id: string, version: number, schemaVersion = 1): CatalogRow {
  return {
    id,
    kind: "topic",
    published_version: version,
    schema_version: schemaVersion,
  };
}

describe("planUpdate", () => {
  it("reports nothing when cache matches catalog", () => {
    const update = planUpdate(new Map([["kyrgyz", 3]]), [row("kyrgyz", 3)]);
    expect(update).toEqual({ changed: [], appOutdated: false });
  });

  it("flags version bumps for member documents only", () => {
    const update = planUpdate(new Map([["kyrgyz", 3]]), [
      row("kyrgyz", 4),
      row("new-topic", 1),
    ]);
    expect(update.changed.map((r) => r.id)).toEqual(["kyrgyz"]);
  });

  it("skips documents needing a newer app and flags appOutdated", () => {
    const update = planUpdate(new Map([["kyrgyz", 1]]), [
      row("kyrgyz", 1, 999),
    ]);
    expect(update.changed).toEqual([]);
    expect(update.appOutdated).toBe(true);
  });

  it("ignores catalog rows absent from cachedVersions and no longer reports removals", () => {
    const update = planUpdate(new Map([["kyrgyz", 3]]), [
      row("kyrgyz", 3),
      row("not-a-member", 5),
    ]);
    expect(update.changed).toEqual([]);
    expect(update).not.toHaveProperty("removedIds");
  });
});
