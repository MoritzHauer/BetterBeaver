import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  BookDocument,
  Content,
  DomainDocument,
} from "@betterbeaver/schema";
import { draftContent } from "@betterbeaver/engine";
import { BookScreen } from "./BookScreen";
import { LessonScreen } from "./LessonScreen";
import { EditSessionProvider } from "./edit/EditSessionContext";
import type { EditSessionValue } from "./edit/EditSessionContext";
import type { ProgressStore } from "@betterbeaver/engine";

/**
 * Spec 0021-7. The structural level: a Book's identity and its lesson list,
 * a Lesson's identity and its unit list. Same pattern as slice 6, so what is
 * worth asserting here is what is *different*: the learner-progress cards
 * are hidden, new entities get the parent id validation requires, and every
 * confirm names things by title.
 */
const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book title",
    description: "Book description",
    lessonIds: ["bk-l1", "bk-l2"],
  },
  lessons: [
    { id: "bk-l1", topicId: "bk", title: "First", goal: "g1", unitIds: [] },
    { id: "bk-l2", topicId: "bk", title: "Second", goal: "g2", unitIds: [] },
  ],
  units: [],
  items: [],
  tasks: [],
  resources: [],
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

function makeSession(overrides: Partial<EditSessionValue> = {}) {
  const books: BookDocument[] = [];
  const session: EditSessionValue = {
    mode: "maintain",
    book: BOOK,
    domain: DOMAIN,
    changeBook: (next) => books.push(next),
    changeDomain: () => {},
    content: build(BOOK),
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
  return { session, books };
}

function renderBook(
  session: EditSessionValue | null,
  onSelectLesson: (id: string) => void = () => {},
  content: Content = build(BOOK),
) {
  const tree = (
    <BookScreen
      content={content}
      attemptedTaskIds={new Set()}
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

function renderLesson(session: EditSessionValue | null, book = BOOK) {
  const tree = (
    <LessonScreen
      content={build(book)}
      lessonId="bk-l1"
      attemptedTaskIds={new Set()}
      onSelectUnit={() => {}}
      onPracticeTask={() => {}}
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

describe("BookScreen", () => {
  afterEach(cleanup);

  it("renders unchanged in learner mode", () => {
    renderBook(null);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    for (const name of [
      /Continue learning|Book complete/,
      /Daily Review/,
      /^Practice/,
      /Vocabulary/,
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Book title" })).toBeTruthy();
  });

  it("hides the progress cards and the feedback widget in edit mode", () => {
    renderBook(makeSession().session);
    for (const name of [
      /Continue learning|Book complete/,
      /Daily Review/,
      /^Practice/,
      /Vocabulary/,
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Thumbs up" })).toBeNull();
    // What replaces them: the Book's own fields.
    expect(screen.getByDisplayValue("Book title")).toBeTruthy();
    expect(screen.getByDisplayValue("Book description")).toBeTruthy();
  });

  it("offers cover art to a maintained Book but never to a private one", () => {
    renderBook(makeSession().session);
    expect(screen.getByLabelText("Cover art")).toBeTruthy();

    cleanup();
    renderBook(makeSession({ mode: "private" }).session);
    // Hidden rather than disabled: the watermark lives in the app's public
    // assets, which a private Book can never reach.
    expect(screen.queryByLabelText("Cover art")).toBeNull();
  });

  it("creates a lesson with the right topicId and appends it to lessonIds", () => {
    const { session, books } = makeSession();
    renderBook(session);

    fireEvent.click(screen.getByRole("button", { name: "+ lesson" }));
    const doc = books[0]!;
    expect(doc.lessons).toHaveLength(3);
    const added = doc.lessons[2] as { id: string; topicId: string };
    // A `topicId` that doesn't match its Book is validator class (a).
    expect(added.topicId).toBe("bk");
    expect((doc.topic as { lessonIds: string[] }).lessonIds).toEqual([
      "bk-l1",
      "bk-l2",
      added.id,
    ]);
  });

  it("reorders and deletes lessons through topic.lessonIds", () => {
    const { session, books } = makeSession();
    renderBook(session);

    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]!);
    expect((books[0]!.topic as { lessonIds: string[] }).lessonIds).toEqual([
      "bk-l2",
      "bk-l1",
    ]);

    // Behind a confirm that names the lesson, never its id.
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    expect(screen.getByText(/“First”/)).toBeTruthy();
    fireEvent.click(
      screen
        .getByRole("dialog")
        .querySelector<HTMLButtonElement>("button.primary")!,
    );
    const doc = books[1]!;
    expect(doc.lessons).toHaveLength(1);
    expect((doc.topic as { lessonIds: string[] }).lessonIds).toEqual(["bk-l2"]);
  });

  it("opens a lesson without leaving edit mode", () => {
    const opened: string[] = [];
    renderBook(makeSession().session, (id) => opened.push(id));
    fireEvent.click(screen.getAllByRole("button", { name: /Open/ })[0]!);
    // Navigation is App's job; carrying `editing` is asserted there. What
    // this owns is that the card still opens at all now that it holds inputs.
    expect(opened).toEqual(["bk-l1"]);
  });
});

describe("LessonScreen", () => {
  afterEach(cleanup);

  it("renders unchanged in learner mode", () => {
    renderLesson(null);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.getByRole("button", { name: /Practice/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "First" })).toBeTruthy();
  });

  it("hides Practice and edits the lesson in place", () => {
    const { session, books } = makeSession();
    renderLesson(session);
    expect(screen.queryByRole("button", { name: /Practice/ })).toBeNull();

    fireEvent.change(screen.getByDisplayValue("First"), {
      target: { value: "Renamed" },
    });
    expect((books[0]!.lessons[0] as { title: string }).title).toBe("Renamed");
  });

  it("creates a unit whose lessonId is the owning lesson", () => {
    const { session, books } = makeSession();
    renderLesson(session);

    fireEvent.click(screen.getByRole("button", { name: "+ unit" }));
    const doc = books[0]!;
    const added = doc.units[0] as { id: string; lessonId: string };
    // A mismatch is validator class (a); a unit no lesson lists is class (d).
    expect(added.lessonId).toBe("bk-l1");
    expect((doc.lessons[0] as { unitIds: string[] }).unitIds).toEqual([
      added.id,
    ]);
  });

  it("clears unlocksAfterLessonId by removing the key", () => {
    const gated: BookDocument = {
      ...BOOK,
      lessons: [
        { ...(BOOK.lessons[0] as object), unlocksAfterLessonId: "bk-l2" },
        BOOK.lessons[1],
      ],
    };
    const { session, books } = makeSession({
      book: gated,
      content: build(gated),
    });
    renderLesson(session, gated);

    // Unchecking the selected radio clears the single-select.
    fireEvent.click(screen.getByRole("radio", { checked: true }));
    const lesson = books[0]!.lessons[0] as Record<string, unknown>;
    // `=== undefined` would pass on the bug: the key has to be gone, or it
    // survives in memory and vanishes across the JSON round-trip to storage.
    expect("unlocksAfterLessonId" in lesson).toBe(false);
  });
});
