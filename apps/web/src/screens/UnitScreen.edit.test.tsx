import { useState } from "react";
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

function renderUnit(
  session: EditSessionValue | null,
  content?: Content,
  noteMarkdown: (stem: string) => string | undefined = () => undefined,
) {
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
      noteMarkdown={noteMarkdown}
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
const THEORY = 1;
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
    // Reorder moved off the row and into the `⚙` sheet (owner decision
    // 2026-08-06 — the four-icon rail took 55% of the row on a phone), so
    // the sheet is offered on a borrowed word too. Same capability, one tap
    // further in; the word's own fields stay absent from it.
    fireEvent.click(screen.getByRole("button", { name: "Word settings" }));
    expect(screen.getByRole("button", { name: "Move word up" })).toBeTruthy();
    expect(screen.queryByLabelText("Transliteration")).toBeNull();

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

  // Spec 0021-13: rows read as table rows, `⚙` replaces the inline
  // expansion, and the undo toast names unlink vs. delete.
  it("renders a concept as one <tr> inside the page's own table", () => {
    const { session } = makeSession();
    renderUnit(session);

    goToPage(CONCEPTS);
    const table = document.querySelector(".vocab-table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("grows the Definition field instead of clipping it", () => {
    const { session } = makeSession();
    renderUnit(session);

    goToPage(CONCEPTS);
    const field = screen.getByLabelText("Definition");
    expect(field.tagName).toBe("TEXTAREA");
    // jsdom has no layout, so `scrollHeight` can't be asserted as a real
    // pixel value — this asserts the growth effect ran at all, not what it
    // measured.
    expect((field as HTMLTextAreaElement).style.height).not.toBe("");
  });

  it("keeps Term/Definition as static headings, unlike a note table's own header row", () => {
    const { session } = makeSession();
    renderUnit(session);

    goToPage(CONCEPTS);
    const termHeader = screen.getByRole("columnheader", { name: "Term" });
    const definitionHeader = screen.getByRole("columnheader", {
      name: "Definition",
    });
    expect(termHeader.querySelector("input, textarea")).toBeNull();
    expect(definitionHeader.querySelector("input, textarea")).toBeNull();
  });

  it("moves Source and the asset pickers behind ⚙, off the row itself", () => {
    const { session } = makeSession();
    renderUnit(session);

    goToPage(CONCEPTS);
    expect(screen.queryByLabelText("Source")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Concept settings" }));
    expect(screen.getByLabelText("Source")).toBeTruthy();
  });

  it("unlinks a lexicon row behind an 'unlinked' toast, and undo restores it in place", () => {
    const { session, books } = makeSession();
    renderUnit(session);

    goToPage(VOCABULARY);
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(screen.getByText("Word unlinked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const restored = books.at(-1)!;
    expect((restored.units[0] as { itemIds: string[] }).itemIds).toEqual([
      "dm-e1",
      "bk-i1",
      "bk-i2",
    ]);
  });

  it("deletes a Book item behind a 'deleted' toast, and undo restores it", () => {
    const { session, books } = makeSession();
    renderUnit(session);

    goToPage(CONCEPTS);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Concept deleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(books.at(-1)!.items).toHaveLength(2);
  });

  it("deletes a whole note behind a 'deleted' toast, and undo restores it", () => {
    // The last destructive action in edit mode that had no undo (wired
    // 2026-08-06, deferred by slice 13 as Theory-page behaviour). A note goes
    // in one tap and takes all its markdown with it, so this is the delete
    // the toast matters most for.
    // A document note is `{ stem, markdown }`; the id the unit points at
    // derives as `<topic.code>-note-<stem>` inside `validateContent`.
    const markdown = "# Intro\n\nProse.";
    const withNote: BookDocument = {
      ...BOOK,
      units: [{ ...BOOK.units[0]!, noteIds: ["bk-note-intro"] }],
      notes: [{ stem: "intro", markdown }],
    };
    const { session, books } = makeSession({
      book: withNote,
      content: build(withNote, DOMAIN),
    });
    renderUnit(session, build(withNote, DOMAIN), () => markdown);

    goToPage(THEORY);
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    expect(screen.getByText("Note deleted")).toBeTruthy();
    expect(books.at(-1)!.notes).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(books.at(-1)!.notes).toEqual([{ stem: "intro", markdown }]);
  });

  it("deletes an Example behind a 'deleted' toast, and undo restores it", () => {
    const { session, books } = makeSession();
    renderUnit(session);

    goToPage(EXAMPLES);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Example deleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(books.at(-1)!.items).toHaveLength(2);
  });

  it("explains the empty Vocabulary page in propose mode instead of rendering it", () => {
    const bare: BookDocument = {
      ...BOOK,
      // No `dm-e1`: this Book's lexicon is read-only and nothing has been
      // linked into it yet, the exact gap spec 0021-13 §5 names.
      units: [{ ...(BOOK.units[0] as object), itemIds: ["bk-i1", "bk-i2"] }],
    };
    const { session } = makeSession({
      book: bare,
      content: build(bare, DOMAIN),
      canEditLexicon: false,
    });
    renderUnit(session, build(bare, DOMAIN));

    goToPage(VOCABULARY);
    expect(
      screen.getByText(/you can use them, but not change them/),
    ).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
  });
});

/**
 * Spec 0023-A2 §2: `MorphologyFields`, rendered from `RowExtras`, so the same
 * three controls reach the Vocabulary row's `⚙` and `SessionEditSheet` at
 * once. Unlike every test above, these edit *lists*, so a write has to come
 * back as the next render's document before the following interaction can
 * see the row it just added — hence the feedback harness rather than
 * `makeSession`'s record-only `changeDomain`.
 */
const MORPHOLOGY_DOMAIN: DomainDocument = {
  ...DOMAIN,
  entries: [
    ...DOMAIN.entries,
    // Not in the unit's `itemIds`: the part picker's pool is the Book's whole
    // lexicon, not this unit's rows.
    {
      id: "dm-e2",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: { script: "-луу", transliteration: "-luu", gloss: "having" },
    },
  ],
};

function renderWithFeedback(domain: DomainDocument): DomainDocument[] {
  const writes: DomainDocument[] = [];
  function Harness() {
    const [current, setCurrent] = useState(domain);
    const content = build(BOOK, current);
    const { session } = makeSession();
    return (
      <EditSessionProvider
        value={{
          ...session,
          domain: current,
          content,
          changeDomain: (next) => {
            writes.push(next);
            setCurrent(next);
          },
        }}
      >
        <UnitScreen
          content={content}
          unitId="bk-u1"
          lookup={lookup}
          onPractice={() => {}}
          onRecall={() => {}}
          onPinNote={() => {}}
          isNotePinned={async () => false}
          onBack={() => {}}
          noteMarkdown={() => undefined}
        />
      </EditSessionProvider>
    );
  }
  render(<Harness />);
  return writes;
}

/** The edited word's stored payload, off the newest write. */
function lastPayload(writes: DomainDocument[]): Record<string, unknown> {
  const entry = writes.at(-1)!.entries[0] as {
    payload: Record<string, unknown>;
  };
  return entry.payload;
}

function openWordSettings() {
  goToPage(VOCABULARY);
  fireEvent.click(screen.getByRole("button", { name: "Word settings" }));
}

describe("the morphology fields behind a word's ⚙", () => {
  afterEach(cleanup);

  it("writes bound to the lexicon, and deletes the key when it is cleared", () => {
    const writes = renderWithFeedback(MORPHOLOGY_DOMAIN);
    openWordSettings();

    fireEvent.change(screen.getByLabelText("Bound morpheme"), {
      target: { value: "suffix" },
    });
    expect(lastPayload(writes).bound).toBe("suffix");

    // `""` is not one of the enum's members, so "(free-standing word)" has to
    // remove the key, not store an empty string.
    fireEvent.change(screen.getByLabelText("Bound morpheme"), {
      target: { value: "" },
    });
    expect("bound" in lastPayload(writes)).toBe(false);
  });

  it("adds an allomorph, and drops the whole key when the last one goes", () => {
    const writes = renderWithFeedback(MORPHOLOGY_DOMAIN);
    openWordSettings();

    fireEvent.click(screen.getByRole("button", { name: "+ variant" }));
    fireEvent.change(screen.getByLabelText("Allomorph 1"), {
      target: { value: "-лүү" },
    });
    expect(lastPayload(writes).variants).toEqual(["-лүү"]);

    // An empty `variants` would be validator class (ab) — "variants" requires
    // "bound" — on a free word, with no control left to clear it.
    fireEvent.click(screen.getByRole("button", { name: "Remove allomorph 1" }));
    expect("variants" in lastPayload(writes)).toBe(false);
  });

  it("offers allomorphs on a free word too, so class (ab) stays fixable", () => {
    renderWithFeedback(MORPHOLOGY_DOMAIN);
    openWordSettings();
    expect(screen.getByRole("button", { name: "+ variant" })).toBeTruthy();
  });

  it("adds a breakdown part with its text, gloss and linked entry", () => {
    const writes = renderWithFeedback(MORPHOLOGY_DOMAIN);
    openWordSettings();

    fireEvent.click(screen.getByRole("button", { name: "+ part" }));
    fireEvent.change(screen.getByLabelText("Part 1"), {
      target: { value: "луу" },
    });
    fireEvent.change(screen.getByLabelText("Part 1 gloss"), {
      target: { value: "having" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "-луу" }));

    expect(lastPayload(writes).components).toEqual([
      { text: "луу", gloss: "having", entryId: "dm-e2" },
    ]);
  });

  it("gives a concept the breakdown but not the lexeme-only fields", () => {
    renderWithFeedback(MORPHOLOGY_DOMAIN);
    goToPage(CONCEPTS);
    fireEvent.click(screen.getByRole("button", { name: "Concept settings" }));

    expect(screen.getByRole("button", { name: "+ part" })).toBeTruthy();
    // `bound`/`variants` are lexeme-payload fields; offering them would
    // author keys `conceptPayloadSchema` rejects.
    expect(screen.queryByLabelText("Bound morpheme")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ variant" })).toBeNull();
  });
});

/**
 * Spec 0023-B §3: the matcher offered as a button. The edited row is the
 * first entry, so this lexicon gives it a word the suffix below actually
 * splits — `MORPHOLOGY_DOMAIN`'s `-луу` carries no `bound`, so it is not a
 * candidate there at all.
 */
const SPLIT_DOMAIN: DomainDocument = {
  ...DOMAIN,
  entries: [
    {
      id: "dm-e1",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: { script: "суулуу", transliteration: "suuluu", gloss: "watery" },
    },
    {
      id: "dm-e2",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: {
        script: "-луу",
        transliteration: "-luu",
        gloss: "having",
        bound: "suffix",
        variants: ["-луу", "-лүү"],
      },
    },
    {
      id: "dm-e3",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: { script: "суу", transliteration: "suu", gloss: "water" },
    },
  ],
};

/** The same pool plus a `-уу` suffix and a one-letter stem, so "суулуу"
 * decomposes two ways — the case plan 0023 §8a's chooser exists for. */
const AMBIGUOUS_DOMAIN: DomainDocument = {
  ...SPLIT_DOMAIN,
  entries: [
    ...SPLIT_DOMAIN.entries,
    {
      id: "dm-e4",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: {
        script: "-уу",
        transliteration: "-uu",
        gloss: "verbal noun",
        bound: "suffix",
        variants: ["-уу"],
      },
    },
    {
      id: "dm-e5",
      kind: "lexeme",
      sourceRef: "bk-r1",
      payload: { script: "с", transliteration: "s", gloss: "the letter es" },
    },
  ],
};

describe("the Suggest breakdown button", () => {
  afterEach(cleanup);

  it("fills the parts from the proposal, then refuses to overwrite them", () => {
    const writes = renderWithFeedback(SPLIT_DOMAIN);
    openWordSettings();

    fireEvent.click(screen.getByRole("button", { name: "Suggest breakdown" }));
    expect(lastPayload(writes).components).toEqual([
      { text: "суу", gloss: "water", entryId: "dm-e3" },
      { text: "луу", gloss: "having", entryId: "dm-e2" },
    ]);

    // An ordinary edit once it lands, so the rows are the author's to fix.
    expect(screen.getByLabelText("Part 2")).toHaveProperty("value", "луу");
    const again = screen.getByRole("button", { name: "Suggest breakdown" });
    expect(again).toHaveProperty("disabled", true);
    expect(again.getAttribute("title")).toMatch(/Clear the parts/);
  });

  it("says so quietly when nothing splits, and writes nothing", () => {
    // No `bound: "suffix"` entry in this lexicon, so there is no candidate to
    // peel off "суу".
    const writes = renderWithFeedback(MORPHOLOGY_DOMAIN);
    openWordSettings();

    fireEvent.click(screen.getByRole("button", { name: "Suggest breakdown" }));
    expect(screen.getByText("No breakdown found")).toBeTruthy();
    expect(writes).toHaveLength(0);
  });

  it("offers a chooser and writes nothing when the word splits several ways", () => {
    const writes = renderWithFeedback(AMBIGUOUS_DOMAIN);
    openWordSettings();

    fireEvent.click(screen.getByRole("button", { name: "Suggest breakdown" }));

    // Nothing is applied: with more than one candidate the tap that asked for
    // a suggestion is not a tap that chose one (plan 0023 §8a).
    expect(writes).toHaveLength(0);
    const chooser = screen.getByLabelText("Suggested breakdowns");
    expect(
      [...chooser.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["суу · луу", "с · уу · луу"]);
  });

  it("writes the candidate that was tapped, not the first one", () => {
    const writes = renderWithFeedback(AMBIGUOUS_DOMAIN);
    openWordSettings();

    fireEvent.click(screen.getByRole("button", { name: "Suggest breakdown" }));
    fireEvent.click(screen.getByRole("button", { name: "с · уу · луу" }));

    expect(lastPayload(writes).components).toEqual([
      { text: "с", gloss: "the letter es", entryId: "dm-e5" },
      { text: "уу", gloss: "verbal noun", entryId: "dm-e4" },
      { text: "луу", gloss: "having", entryId: "dm-e2" },
    ]);
    // The chooser is spent once it has been used.
    expect(screen.queryByLabelText("Suggested breakdowns")).toBeNull();
  });
});
