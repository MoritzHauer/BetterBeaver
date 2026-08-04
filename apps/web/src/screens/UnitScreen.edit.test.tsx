import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  BookDocument,
  Content,
  DomainDocument,
} from "@betterbeaver/schema";
import { draftContent } from "@betterbeaver/engine";
import { UnitScreen } from "./UnitScreen";
import { EditSessionProvider } from "./edit/EditSessionContext";
import type { EditSessionValue } from "./edit/EditSessionContext";
import type { TapLookup } from "../components/TappableText";

/**
 * Spec 0021-6. The regression guard that matters most is the first test:
 * learner mode has to be exactly what it was, on every page — the whole
 * slice is `session === null ? <text> : <input>`, so an accidental leak
 * shows up as a textbox where a learner should see prose.
 */
const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book",
    description: "",
    lessonIds: ["bk-l1"],
  },
  lessons: [{ id: "bk-l1", title: "Lesson", goal: "", unitIds: ["bk-u1"] }],
  units: [
    {
      id: "bk-u1",
      lessonId: "bk-l1",
      title: "Unit one",
      goal: "Learn it",
      itemIds: ["dm-e1", "bk-i1", "bk-i2"],
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
    {
      id: "bk-i2",
      kind: "sentence",
      sourceRef: "bk-r1",
      payload: { text: "Beavers build.", translation: "They build." },
    },
  ],
  tasks: [],
  resources: [{ id: "bk-r1", kind: "book", title: "Source" }],
  notes: [],
};

const DOMAIN: DomainDocument = {
  domain: {
    id: "dm",
    code: "dm",
    kind: "language",
    title: "Domain",
    glossLanguage: "en",
  },
  entries: [
    {
      id: "dm-e1",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: { script: "суу", transliteration: "suu", gloss: "water" },
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

function build(book: BookDocument, domain: DomainDocument): Content {
  return draftContent(book, domain, NO_STEMS).content;
}

const lookup = {
  domainContent: {
    domain: { id: "dm", code: "dm", readAloudLang: "ky" },
    entries: [],
    families: [],
    linksByEntryId: new Map(),
  },
  listStore: {} as TapLookup["listStore"],
  userEntryStore: {} as TapLookup["userEntryStore"],
  onWordsChanged: () => {},
} as unknown as TapLookup;

function renderUnit(session: EditSessionValue | null, content?: Content) {
  const tree = (
    <UnitScreen
      content={content ?? build(BOOK, DOMAIN)}
      unitId="bk-u1"
      lookup={lookup}
      onPractice={() => {}}
      onRecall={() => {}}
      onPinNote={() => {}}
      isNotePinned={async () => false}
      onBack={() => {}}
      noteMarkdown={() => undefined}
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

function makeSession(overrides: Partial<EditSessionValue> = {}): {
  session: EditSessionValue;
  books: BookDocument[];
  domains: DomainDocument[];
} {
  const books: BookDocument[] = [];
  const domains: DomainDocument[] = [];
  const session: EditSessionValue = {
    mode: "private",
    book: BOOK,
    domain: DOMAIN,
    changeBook: (next) => books.push(next),
    changeDomain: (next) => domains.push(next),
    content: build(BOOK, DOMAIN),
    noteMarkdown: () => undefined,
    problems: [],
    problemsByEntity: new Map(),
    readOnly: false,
    canEditLexicon: true,
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
  return { session, books, domains };
}

/** Walks the trail to the page whose dot is at `index`. Edit mode shows all
 * five (overview, theory, vocabulary, concepts, examples); learner mode
 * shows only the pages this fixture actually has content for. */
function goToPage(index: number) {
  // `fireEvent`, not `.click()`: RTL wraps it in `act`, so the trail's state
  // update is flushed before the next synchronous query runs. A bare
  // `.click()` here silently left every assertion on the Overview page.
  fireEvent.click(
    screen.getAllByRole("button", { name: /^Page \d+ of/ })[index]!,
  );
}
const VOCABULARY = 2;
const CONCEPTS = 3;
const EXAMPLES = 4;

describe("UnitScreen in learner mode", () => {
  afterEach(cleanup);

  it("renders no inputs on any page", () => {
    renderUnit(null);
    expect(screen.getByRole("heading", { name: "Unit one" })).toBeTruthy();
    expect(document.querySelector(".unit-practice-bar")).not.toBeNull();
    // Overview, Vocabulary, Concepts, Examples — this fixture has no notes,
    // and learner mode still hides the pages with nothing on them.
    expect(
      screen.getAllByRole("button", { name: /^Page \d+ of/ }),
    ).toHaveLength(4);
    for (let page = 0; page < 4; page++) {
      goToPage(page);
      expect(screen.queryAllByRole("textbox")).toEqual([]);
      expect(screen.queryAllByRole("checkbox")).toEqual([]);
      expect(screen.queryAllByRole("radio")).toEqual([]);
    }
  });
});

describe("UnitScreen in edit mode", () => {
  afterEach(cleanup);

  it("hides the Practice bar", () => {
    renderUnit(makeSession().session);
    expect(document.querySelector(".unit-practice-bar")).toBeNull();
  });

  it("writes a vocabulary edit to the lexicon and an example to the Book", () => {
    const { session, books, domains } = makeSession();
    renderUnit(session);

    goToPage(VOCABULARY);
    fireEvent.change(screen.getByLabelText("Gloss"), {
      target: { value: "river" },
    });
    expect(domains).toHaveLength(1);
    expect(books).toHaveLength(0);
    expect(
      (domains[0]!.entries[0] as { payload: { gloss: string } }).payload.gloss,
    ).toBe("river");

    goToPage(EXAMPLES);
    fireEvent.change(screen.getByLabelText("Translation"), {
      target: { value: "changed" },
    });
    expect(books).toHaveLength(1);
    expect(domains).toHaveLength(1);
  });

  it("unlinks a lexicon row but deletes a Book item", () => {
    const { session, books, domains } = makeSession();
    renderUnit(session);

    goToPage(VOCABULARY);
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    // The entry itself survives — only the unit's reference to it goes.
    expect(domains).toHaveLength(0);
    expect((books[0]!.units[0] as { itemIds: string[] }).itemIds).not.toContain(
      "dm-e1",
    );

    cleanup();
    const second = makeSession();
    renderUnit(second.session);
    goToPage(CONCEPTS);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(second.books[0]!.items).toHaveLength(1);
  });

  it("creates a word whose id starts with the lexicon's code", () => {
    const { session, domains } = makeSession();
    renderUnit(session);

    goToPage(VOCABULARY);
    fireEvent.click(screen.getByRole("button", { name: "+ word" }));
    const entries = domains[0]!.entries as { id: string }[];
    expect(entries).toHaveLength(2);
    expect(entries[1]!.id.startsWith("dm-")).toBe(true);
  });

  it("renders a field problem on its own field, not on the card", () => {
    const { session } = makeSession({
      problemsByEntity: new Map([
        [
          "dm-e1",
          [{ entityId: "dm-e1", path: "payload.gloss", message: "too short" }],
        ],
      ]),
    });
    renderUnit(session);

    goToPage(VOCABULARY);
    const marker = screen.getByText(/too short/);
    // Beside the Gloss input, inside the same table cell — not floating on
    // the row as a whole.
    expect(marker.closest("td")?.contains(screen.getByLabelText("Gloss"))).toBe(
      true,
    );
    // Never announced as an invalid field: it is unfinished, not wrong.
    expect(
      screen.getByLabelText("Gloss").getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("renders lexicon rows read-only while leaving Book items editable", () => {
    const { session } = makeSession({ canEditLexicon: false });
    renderUnit(session);

    goToPage(VOCABULARY);
    expect(screen.queryByLabelText("Gloss")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ word" })).toBeNull();
    expect(
      screen.getByText(/you can use them, but not change them/),
    ).toBeTruthy();
    // Reorder and Unlink stay: they write `unit.itemIds`, which this Book
    // owns. Only the word itself is somebody else's.
    expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Move up" }).length,
    ).toBeGreaterThan(0);

    goToPage(CONCEPTS);
    expect(screen.getByLabelText("Term")).toBeTruthy();
  });

  it("shows every page so an empty one can still be filled", () => {
    const bare: BookDocument = {
      ...BOOK,
      units: [{ ...(BOOK.units[0] as object), itemIds: [] }],
    };
    const { session } = makeSession({
      book: bare,
      content: build(bare, DOMAIN),
    });
    render(
      <EditSessionProvider value={session}>
        <UnitScreen
          content={build(bare, DOMAIN)}
          unitId="bk-u1"
          lookup={lookup}
          onPractice={() => {}}
          onRecall={() => {}}
          onPinNote={() => {}}
          isNotePinned={async () => false}
          onBack={() => {}}
          noteMarkdown={() => undefined}
        />
      </EditSessionProvider>,
    );
    // The five content pages plus slice 8's edit-only Exercises dot.
    expect(
      screen.getAllByRole("button", { name: /^Page \d+ of/ }),
    ).toHaveLength(6);
  });
});
