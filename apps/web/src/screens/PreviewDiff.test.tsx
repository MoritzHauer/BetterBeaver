import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import type { ProgressStore } from "@betterbeaver/engine";
import {
  createDocumentContentSource,
  diffContent,
  draftContent,
} from "@betterbeaver/engine";
import { BookScreen } from "./BookScreen";
import { EditSessionProvider } from "./edit/EditSessionContext";
import type { EditSessionValue } from "./edit/EditSessionContext";
import { WhatChanged, changedCount } from "./edit/WhatChanged";
import { bookScopeChanged, unitScopeChanged } from "./edit/diffView";

/**
 * Spec 0021-9 §5. Two things here are required rather than tidy: Preview
 * hides Play and Daily Review (with a full attempted set they would show a
 * trophy and a permanently-disabled button, which reads as broken), and the
 * Diff tab appears only where there is something to see — which is exactly
 * why What-changed lives in the menu instead.
 */

const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book",
    description: "About beavers",
    lessonIds: ["bk-l1", "bk-l2"],
  },
  lessons: [
    {
      id: "bk-l1",
      topicId: "bk",
      title: "First",
      goal: "g1",
      unitIds: ["bk-u1"],
    },
    {
      id: "bk-l2",
      topicId: "bk",
      title: "Second",
      goal: "g2",
      unitIds: ["bk-u2"],
      // Gated behind the first lesson — the lock Preview has to open.
      unlocksAfterLessonId: "bk-l1",
    },
  ],
  units: [
    {
      id: "bk-u1",
      lessonId: "bk-l1",
      title: "Unit one",
      goal: "",
      itemIds: ["bk-i1"],
      taskIds: ["bk-t1"],
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
  tasks: [{ id: "bk-t1", type: "recall", itemIds: ["bk-i1"] }],
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
  getAttemptedTaskIds: async () => [],
} as unknown as ProgressStore;

const clone = (doc: BookDocument): BookDocument =>
  JSON.parse(JSON.stringify(doc)) as BookDocument;

function makeSession(
  overrides: Partial<EditSessionValue> = {},
): EditSessionValue {
  return {
    mode: "maintain",
    book: BOOK,
    domain: DOMAIN,
    changeBook: () => {},
    changeDomain: () => {},
    content: build(BOOK),
    noteMarkdown: () => undefined,
    problems: [],
    problemsByEntity: new Map(),
    readOnly: false,
    canEditLexicon: true,
    assets: [],
    lexiconAssets: [],
    view: "edit",
    setView: () => {},
    canDiff: true,
    diff: null,
    preview: null,
    previewErrors: [],
    save: "saved",
    publish: { s: "idle" },
    ...overrides,
  };
}

function renderBook(
  session: EditSessionValue | null,
  attempted: ReadonlySet<string> = new Set(),
  content = build(BOOK),
  onSelectLesson: (id: string) => void = () => {},
) {
  const tree = (
    <BookScreen
      content={content}
      attemptedTaskIds={attempted}
      store={store}
      epoch={0}
      onSelectLesson={onSelectLesson}
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

describe("Preview", () => {
  afterEach(cleanup);

  it("hides Play and Daily Review and keeps Practice", () => {
    // Required, not tidy (§1b): with a full attempted set `nextUnit` returns
    // null and `dueUnits` nothing, so Play would show the "Book complete"
    // trophy and Daily Review would be permanently disabled.
    renderBook(makeSession({ view: "preview" }), new Set(["bk-t1"]));
    expect(screen.queryByText("Continue learning")).toBeNull();
    expect(screen.queryByText("Book complete")).toBeNull();
    expect(screen.queryByText("Daily Review")).toBeNull();
    expect(screen.getByText("Practice")).toBeTruthy();
  });

  it("reaches a gated lesson in one tap", () => {
    // Preview passes the full task set, so nothing is locked: inspecting
    // unit 12 must not cost eleven skip-ahead confirms.
    const opened: string[] = [];
    renderBook(
      makeSession({ view: "preview" }),
      new Set(["bk-t1"]),
      build(BOOK),
      (id) => opened.push(id),
    );
    fireEvent.click(screen.getByText("Second"));
    expect(opened).toEqual(["bk-l2"]);
    // No confirmation sheet in between.
    expect(screen.queryByText("Skip ahead?")).toBeNull();
  });

  it("resolves an asset that is only in the session's live list", () => {
    // §1a's trap: `registerRemoteAssets` fills the overlay from *cached*
    // documents, so a file uploaded for an unpublished draft is in Storage
    // and in the session's asset list but not in the overlay. Preview must
    // be handed the live stems, or it reports a dangling ref for a file that
    // plainly exists.
    const withImage = clone(BOOK);
    (
      withImage.items[0] as { payload: Record<string, unknown> }
    ).payload.imageRef = "fresh-upload";

    const danglingErrors = (stems: typeof NO_STEMS) =>
      createDocumentContentSource(
        new Map([["bk", withImage]]),
        new Map([["dm", DOMAIN]]),
        stems,
      )
        .broken.flatMap((entry) => entry.errors)
        .filter((error) => error.includes("fresh-upload"));

    expect(danglingErrors(NO_STEMS)).toHaveLength(1);
    expect(
      danglingErrors({
        ...NO_STEMS,
        imageByBook: new Map([["bk", ["fresh-upload"]]]),
      }),
    ).toEqual([]);
  });
});

describe("Diff", () => {
  afterEach(cleanup);

  const renamedBook = () => {
    const draft = clone(BOOK);
    (draft.lessons[0] as { title: string }).title = "First, renamed";
    return draft;
  };

  it("puts the tab only where there is something to see", () => {
    // A lesson's own title is the Lesson screen's business; the Book screen
    // has nothing to show, which is why What-changed cannot live behind the
    // tab.
    const draft = renamedBook();
    const session = makeSession({
      book: draft,
      diff: diffContent(BOOK, draft, DOMAIN, DOMAIN),
    });
    expect(bookScopeChanged(session)).toBe(false);

    const added = clone(BOOK);
    (added.topic as { lessonIds: string[] }).lessonIds = ["bk-l1"];
    const withAdded = makeSession({
      book: added,
      diff: diffContent(BOOK, added, DOMAIN, DOMAIN),
    });
    expect(bookScopeChanged(withAdded)).toBe(true);
  });

  it("puts a changed item on its unit's screen", () => {
    const draft = clone(BOOK);
    (draft.items[0] as { payload: { term: string } }).payload.term = "Lodge";
    const session = makeSession({
      book: draft,
      diff: diffContent(BOOK, draft, DOMAIN, DOMAIN),
    });
    expect(unitScopeChanged(session, "bk-u1")).toBe(true);
    expect(unitScopeChanged(session, "bk-u2")).toBe(false);
  });

  it("renders the old row directly above the new one, tinted", () => {
    const draft = renamedBook();
    const diff = diffContent(BOOK, draft, DOMAIN, DOMAIN);
    renderBook(
      makeSession({ book: draft, view: "diff", diff }),
      new Set(),
      diff.content,
    );

    const oldRow = screen.getByText("First").closest("li");
    const newRow = screen.getByText("First, renamed").closest("li");
    expect(oldRow?.className).toContain("diff-old");
    expect(newRow?.className).toContain("diff-new");
    // Old above new, in that order.
    expect(
      oldRow?.compareDocumentPosition(newRow!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a deleted lesson on screen so it has a row to tint", () => {
    const draft = clone(BOOK);
    draft.lessons = draft.lessons.filter(
      (l) => (l as { id: string }).id !== "bk-l2",
    );
    (draft.topic as { lessonIds: string[] }).lessonIds = ["bk-l1"];
    const diff = diffContent(BOOK, draft, DOMAIN, DOMAIN);
    renderBook(
      makeSession({ book: draft, view: "diff", diff }),
      new Set(),
      diff.content,
    );

    expect(screen.getByText("Second").closest("li")?.className).toContain(
      "diff-old",
    );
  });

  it("renders no inputs at all — Diff is read-only", () => {
    const draft = renamedBook();
    const diff = diffContent(BOOK, draft, DOMAIN, DOMAIN);
    renderBook(
      makeSession({ book: draft, view: "diff", diff }),
      new Set(),
      diff.content,
    );
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryByText("+ lesson")).toBeNull();
    expect(screen.queryByText("Sources")).toBeNull();
  });
});

describe("What changed", () => {
  afterEach(cleanup);

  it("counts exactly the entities that are not unchanged", () => {
    const draft = clone(BOOK);
    (draft.lessons[0] as { title: string }).title = "First, renamed";
    (draft.items[0] as { payload: { term: string } }).payload.term = "Lodge";
    const diff = diffContent(BOOK, draft, DOMAIN, DOMAIN);

    const touched = [...diff.status.values()].filter((s) => s !== "unchanged");
    expect(changedCount(diff)).toBe(touched.length);
    expect(changedCount(diff)).toBe(2);
    expect(changedCount(null)).toBe(0);
  });

  it("names rows by title and deep-links each to the screen that owns it", () => {
    const draft = clone(BOOK);
    (draft.items[0] as { payload: { term: string } }).payload.term = "Lodge";
    const diff = diffContent(BOOK, draft, DOMAIN, DOMAIN);
    const opened: { lessonId?: string; unitId?: string }[] = [];
    render(
      <WhatChanged
        diff={diff}
        noteMarkdown={() => undefined}
        onOpen={(target) => opened.push(target)}
      />,
    );

    // By title, never by id.
    expect(screen.getByText("Lodge")).toBeTruthy();
    expect(screen.queryByText(/bk-i1/)).toBeNull();
    // Grouped under the lesson that owns the unit that owns the item.
    expect(screen.getByRole("heading", { name: "First" })).toBeTruthy();

    fireEvent.click(screen.getByText("Lodge"));
    expect(opened).toEqual([{ lessonId: "bk-l1", unitId: "bk-u1" }]);
  });

  it("says so plainly when nothing has changed", () => {
    render(
      <WhatChanged
        diff={diffContent(BOOK, BOOK, DOMAIN, DOMAIN)}
        noteMarkdown={() => undefined}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/matches what is live/)).toBeTruthy();
  });
});
