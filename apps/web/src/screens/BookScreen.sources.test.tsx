import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import type { ProgressStore } from "@betterbeaver/engine";
import { draftContent } from "@betterbeaver/engine";
import { BookScreen } from "./BookScreen";
import { EditSessionProvider } from "./edit/EditSessionContext";
import type { EditSessionValue } from "./edit/EditSessionContext";
import { unitEditOps } from "./edit/inPlace";

/**
 * Spec 0021-8 §2a-b. Sources live on the Book, not the Unit trail:
 * `resources` is a field of `BookDocument`, shared across every unit.
 *
 * The one that would bite silently is the delete: a resource other things
 * point at is **not** cascaded, so the confirm has to say how many will
 * break — and the count spans both documents, since a lexicon entry's
 * `sourceRef` resolves against the *Book's* resources.
 */
const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book",
    description: "",
    lessonIds: [],
  },
  lessons: [],
  units: [
    {
      id: "bk-u1",
      lessonId: "bk-l1",
      title: "Unit",
      goal: "",
      itemIds: ["bk-i1"],
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
  resources: [{ id: "bk-r1", title: "The book", path: "b.md" }],
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
  // Points at the *Book's* resource — the cross-document coupling the count
  // has to include.
  entries: [
    {
      id: "dm-e1",
      kind: "concept",
      sourceRef: "bk-r1",
      payload: { term: "Lodge", definition: "A home" },
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
const build = (book: BookDocument) =>
  draftContent(book, DOMAIN, NO_STEMS).content;

const store = {
  getStreak: async () => null,
  getItemState: async () => null,
} as unknown as ProgressStore;

function makeSession(overrides: Partial<EditSessionValue> = {}) {
  const books: BookDocument[] = [];
  const session: EditSessionValue = {
    mode: "private",
    book: BOOK,
    domain: DOMAIN,
    changeBook: (next) => books.push(next),
    changeDomain: () => {},
    content: build(BOOK),
    domainContent: {} as EditSessionValue["domainContent"],
    noteMarkdown: () => undefined,
    problems: [],
    problemsByEntity: new Map(),
    readOnly: false,
    canEditLexicon: true,
    lexiconLoaded: true,
    assets: [],
    lexiconAssets: [],
    view: "edit",
    setView: () => {},
    canDiff: false,
    diff: null,
    preview: null,
    previewErrors: [],
    save: "saved",
    publish: { s: "idle" },
    ...overrides,
  };
  return { session, books };
}

function renderBook(session: EditSessionValue | null, book = BOOK) {
  const tree = (
    <BookScreen
      content={build(book)}
      unitProgress={new Map()}
      store={store}
      epoch={0}
      onSelectLesson={() => {}}
      onPracticeTask={() => {}}
      onPlay={() => {}}
      onReview={() => {}}
      onVocabulary={() => {}}
      onBack={() => {}}
    />
  );
  return render(
    session === null ? (
      tree
    ) : (
      <EditSessionProvider value={session}>{tree}</EditSessionProvider>
    ),
  );
}

describe("Sources on the Book screen", () => {
  afterEach(cleanup);

  it("is edit-only", () => {
    renderBook(null);
    expect(screen.queryByText("Sources")).toBeNull();
    expect(screen.queryByText("+ source")).toBeNull();
  });

  it("adds a resource with a generated, book-prefixed id and no field for it", () => {
    const { session, books } = makeSession();
    renderBook(session);

    // Spec 0021-14 §3: Sources moved into the header's Book settings sheet.
    fireEvent.click(screen.getByRole("button", { name: "Book settings" }));
    fireEvent.click(screen.getByText("+ source"));
    const resources = books[0]!.resources as { id: string; title: string }[];
    expect(resources).toHaveLength(2);
    expect(resources[1]!.id.startsWith("bk-")).toBe(true);
    // Generated, never typed (spec 0018 §1): the only inputs on a source row
    // are its title and its link.
    expect(screen.queryByText(/bk-r1/)).toBeNull();
    expect(screen.getByDisplayValue("The book")).toBeTruthy();
    expect(screen.getByDisplayValue("b.md")).toBeTruthy();
  });

  it("warns with the reference count and leaves every sourceRef alone", () => {
    const { session, books } = makeSession();
    renderBook(session);

    // Spec 0021-14 §3: Sources moved into the header's Book settings sheet.
    fireEvent.click(screen.getByRole("button", { name: "Book settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // One book item plus one lexicon entry — the entry counts, and missing
    // it is the easy mistake.
    expect(screen.getByText(/2 entries point at “The book”/)).toBeTruthy();

    const confirms = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirms[confirms.length - 1]!);

    expect(books[0]!.resources).toHaveLength(0);
    // Not cascaded: the item still points at the resource that is gone, and
    // says so at publish rather than being silently repointed.
    expect((books[0]!.items[0] as { sourceRef: string }).sourceRef).toBe(
      "bk-r1",
    );
  });

  it("says so plainly when nothing points at the source", () => {
    const bare = { ...BOOK, items: [] } as unknown as BookDocument;
    const { session } = makeSession({
      book: bare,
      domain: { ...DOMAIN, entries: [] } as unknown as DomainDocument,
      content: build(bare),
    });
    renderBook(session, bare);

    // Spec 0021-14 §3: Sources moved into the header's Book settings sheet.
    fireEvent.click(screen.getByRole("button", { name: "Book settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/is not used by anything yet/)).toBeTruthy();
  });
});

describe("a new item's source", () => {
  it("defaults to the Book's first resource", () => {
    const { session, books } = makeSession();
    unitEditOps(session, "bk-u1")!.addItem("sentence");
    const added = books[0]!.items.at(-1) as { sourceRef: string };
    expect(added.sourceRef).toBe("bk-r1");
  });

  it("is empty when the Book has none, which is what the marker is for", () => {
    const bare = { ...BOOK, resources: [] } as unknown as BookDocument;
    const { session, books } = makeSession({
      book: bare,
      content: build(bare),
    });
    unitEditOps(session, "bk-u1")!.addItem("sentence");
    expect((books[0]!.items.at(-1) as { sourceRef: string }).sourceRef).toBe(
      "",
    );
  });
});
