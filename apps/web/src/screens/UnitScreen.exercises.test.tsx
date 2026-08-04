import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  BookDocument,
  Content,
  DomainDocument,
  Item,
} from "@betterbeaver/schema";
import { checkReferences } from "@betterbeaver/schema";
import { draftContent } from "@betterbeaver/engine";
import { UnitScreen } from "./UnitScreen";
import { EditSessionProvider } from "./edit/EditSessionContext";
import type { EditSessionValue } from "./edit/EditSessionContext";
import { unitEditOps } from "./edit/inPlace";
import { exerciseOffers } from "./edit/exerciseOffers";
import type { TapLookup } from "../components/TappableText";

/**
 * Spec 0021-8 §4. The load-bearing test in this file is the last one:
 * **creating any offered exercise must not produce a publish error.** That is
 * the whole contract of `exerciseOffers` — if a fold produces a task
 * `checkReferences` then rejects, the fold is wrong, and no amount of UI
 * polish elsewhere makes up for it.
 */

const RESOURCE = { id: "bk-r1", title: "Source", path: "s.md" };

/** Four of each kind, all refs present — the unit that can build everything. */
function fullBook(): BookDocument {
  const lexemes = [1, 2, 3, 4].map((n) => ({
    id: `bk-w${n}`,
    kind: "lexeme",
    sourceRef: "bk-r1",
    payload: {
      script: `сөз${n}`,
      transliteration: `soz${n}`,
      gloss: `word ${n}`,
      audioRef: "a1",
      imageRef: "i1",
    },
  }));
  const concepts = [1, 2, 3, 4].map((n) => ({
    id: `bk-c${n}`,
    kind: "concept",
    sourceRef: "bk-r1",
    payload: {
      term: `Term ${n}`,
      definition: `Definition ${n}`,
      audioRef: "a1",
      imageRef: "i1",
    },
  }));
  const sentences = [1, 2, 3, 4].map((n) => ({
    id: `bk-s${n}`,
    kind: "sentence",
    sourceRef: "bk-r1",
    payload: {
      text: `Beavers build {{c1::dams}} here ${n}`,
      translation: `They build ${n}`,
      audioRef: "a1",
    },
  }));
  const pair = {
    id: "bk-p1",
    kind: "pair",
    sourceRef: "bk-r1",
    payload: {
      a: { script: "тар", audioRef: "a1" },
      b: { script: "тор", audioRef: "a1" },
      contrast: "vowel",
    },
  };
  return {
    topic: {
      id: "bk",
      code: "bk",
      domainId: "dm",
      title: "Book",
      description: "",
      lessonIds: ["bk-l1"],
    },
    lessons: [
      {
        id: "bk-l1",
        topicId: "bk",
        title: "Lesson",
        goal: "",
        unitIds: ["bk-u1"],
      },
    ],
    units: [
      {
        id: "bk-u1",
        lessonId: "bk-l1",
        title: "Unit",
        goal: "Goal",
        itemIds: [
          ...lexemes.map((i) => i.id),
          ...concepts.map((i) => i.id),
          ...sentences.map((i) => i.id),
          pair.id,
        ],
        taskIds: [],
        noteIds: [],
      },
    ],
    items: [...lexemes, ...concepts, ...sentences, pair],
    tasks: [],
    resources: [RESOURCE],
    notes: [],
  };
}

/** `fullBook` narrowed to the item ids listed — the knob every shape below
 * turns. The document's items are narrowed with it: an item no unit owns is
 * its own validator error, and leaving those in would drown the one signal
 * these tests are reading. */
function unitOf(book: BookDocument, itemIds: string[]): BookDocument {
  return {
    ...book,
    units: [{ ...(book.units[0] as object), itemIds }],
    items: book.items.filter((item) =>
      itemIds.includes((item as { id: string }).id),
    ),
  };
}

const DOMAIN: DomainDocument = {
  domain: {
    id: "dm",
    code: "dm",
    kind: "language",
    title: "Domain",
    glossLanguage: "en",
  },
  entries: [],
  families: [],
};

const STEMS = {
  audioByBook: new Map([["bk", ["a1"]]]),
  imageByBook: new Map([["bk", ["i1"]]]),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

const NO_STEMS = {
  audioByBook: new Map(),
  imageByBook: new Map(),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

function build(book: BookDocument, stems = STEMS): Content {
  return draftContent(book, DOMAIN, stems).content;
}

function errorsOf(book: BookDocument, stems = STEMS): string[] {
  return checkReferences(draftContent(book, DOMAIN, stems).parsed);
}

function makeSession(
  book: BookDocument,
  stems = STEMS,
): { session: EditSessionValue; books: BookDocument[] } {
  const books: BookDocument[] = [];
  return {
    books,
    session: {
      mode: "private",
      book,
      domain: DOMAIN,
      changeBook: (next) => books.push(next),
      changeDomain: () => {},
      content: build(book, stems),
      domainContent: {} as EditSessionValue["domainContent"],
      noteMarkdown: () => undefined,
      problems: [],
      problemsByEntity: new Map(),
      readOnly: false,
      canEditLexicon: true,
      // The Book's pool, matching `STEMS` — an asset picker offers exactly
      // what the validator will accept for a book-owned item.
      assets: [
        { stem: "a1", name: "beaver.wav", kind: "audio", size: 0, url: "" },
        { stem: "i1", name: "beaver.png", kind: "image", size: 0, url: "" },
      ],
      lexiconAssets: [],
      view: "edit",
      setView: () => {},
      canDiff: false,
      diff: null,
      preview: null,
      previewErrors: [],
      save: "saved",
      publish: { s: "idle" },
    },
  };
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

function renderUnit(session: EditSessionValue | null, book: BookDocument) {
  const tree = (
    <UnitScreen
      content={build(book)}
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

/** The offer list, straight off the fold — the same input `UnitScreen` gives
 * it (the unit's own itemIds, resolved through the merged, coerced pool). */
function offersFor(book: BookDocument, stems = STEMS) {
  const content = build(book, stems);
  const unit = content.units[0]!;
  return exerciseOffers(
    unit.itemIds,
    new Map(content.items.map((item: Item) => [item.id, item])),
  );
}

const reasonFor = (book: BookDocument, type: string, stems = STEMS) =>
  offersFor(book, stems).find((offer) => offer.type === type)?.reason;

describe("the exercise offer list", () => {
  it("offers Recognize over four words and greys it at three, with the count", () => {
    const four = unitOf(fullBook(), ["bk-w1", "bk-w2", "bk-w3", "bk-w4"]);
    expect(reasonFor(four, "recognize")).toBeNull();

    const three = unitOf(fullBook(), ["bk-w1", "bk-w2", "bk-w3"]);
    expect(reasonFor(three, "recognize")).toBe(
      "needs 4 words, this unit has 3",
    );
  });

  it("greys Listen with 'needs audio' when the words have none", () => {
    const book = fullBook();
    const silent = {
      ...book,
      items: book.items.map((item) => {
        const i = item as { id: string; payload: Record<string, unknown> };
        if (!i.id.startsWith("bk-w")) {
          return item;
        }
        const payload = { ...i.payload };
        delete payload.audioRef;
        return { ...i, payload };
      }),
    };
    const unit = unitOf(silent, ["bk-w1", "bk-w2", "bk-w3", "bk-w4"]);
    expect(reasonFor(unit, "listen")).toBe("needs audio");
    // The kind is still there, so it is the audio that is named, not the kind.
    expect(reasonFor(unit, "recognize")).toBeNull();
  });

  it("offers Minimal-pair over a pair and nothing else over it", () => {
    const offers = offersFor(unitOf(fullBook(), ["bk-p1"]));
    const buildable = offers.filter((offer) => offer.reason === null);
    expect(buildable.map((offer) => offer.type)).toEqual(["minimal-pair"]);
    expect(buildable[0]!.itemIds).toEqual(["bk-p1"]);
  });

  it("offers Recognize twice when two kinds qualify, each pre-filled with one kind", () => {
    const book = unitOf(fullBook(), [
      "bk-w1",
      "bk-w2",
      "bk-w3",
      "bk-w4",
      "bk-s1",
      "bk-s2",
      "bk-s3",
      "bk-s4",
    ]);
    const rows = offersFor(book).filter((offer) => offer.type === "recognize");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(["lexeme", "sentence"]);
    expect(rows[0]!.itemIds.every((id) => id.startsWith("bk-w"))).toBe(true);
    expect(rows[1]!.itemIds.every((id) => id.startsWith("bk-s"))).toBe(true);
  });

  it("names the missing kind when the unit holds none the type accepts", () => {
    const book = unitOf(fullBook(), ["bk-s1", "bk-s2", "bk-s3", "bk-s4"]);
    expect(reasonFor(book, "minimal-pair")).toBe("no pairs in this unit");
  });
});

describe("the offer list's contract", () => {
  /**
   * Spec §4's most valuable test, and the reason `exerciseOffers` exists:
   * **no exercise created from the offered list can produce a publish
   * error.** Driven through `addTask` itself, not a hand-built task, so the
   * mutation is under test too.
   */
  const shapes: [string, string[], typeof STEMS][] = [
    ["four words, every ref", ["bk-w1", "bk-w2", "bk-w3", "bk-w4"], STEMS],
    ["four concepts", ["bk-c1", "bk-c2", "bk-c3", "bk-c4"], STEMS],
    ["four sentences", ["bk-s1", "bk-s2", "bk-s3", "bk-s4"], STEMS],
    ["one pair", ["bk-p1"], STEMS],
    ["two words only", ["bk-w1", "bk-w2"], STEMS],
    [
      "everything at once",
      [
        "bk-w1",
        "bk-w2",
        "bk-w3",
        "bk-w4",
        "bk-c1",
        "bk-c2",
        "bk-c3",
        "bk-c4",
        "bk-s1",
        "bk-s2",
        "bk-s3",
        "bk-s4",
        "bk-p1",
      ],
      STEMS,
    ],
    // No assets registered at all: every ref in the fixture now dangles, so
    // the offers must fall back to the types that need none.
    ["no assets uploaded", ["bk-w1", "bk-w2", "bk-w3", "bk-w4"], NO_STEMS],
  ];

  for (const [name, itemIds, stems] of shapes) {
    it(`creates only publishable exercises from a unit of ${name}`, () => {
      const book = unitOf(fullBook(), itemIds);
      const before = errorsOf(book, stems);
      const offers = offersFor(book, stems).filter(
        (offer) => offer.reason === null,
      );
      // A unit that can build nothing would pass this test vacuously.
      expect(offers.length).toBeGreaterThan(0);

      for (const offer of offers) {
        const { session, books } = makeSession(book, stems);
        const ops = unitEditOps(session, "bk-u1")!;
        ops.addTask(offer.type, offer.itemIds);
        expect(books).toHaveLength(1);
        const added = errorsOf(books[0]!, stems).filter(
          (error) => !before.includes(error),
        );
        expect(added, `${offer.type} over ${offer.kind}`).toEqual([]);
      }
    });
  }

  it("clears 'unit has zero tasks' rather than trading it for another error", () => {
    const book = unitOf(fullBook(), ["bk-w1", "bk-w2", "bk-w3", "bk-w4"]);
    expect(errorsOf(book).some((e) => e.includes("zero tasks"))).toBe(true);
    const offer = offersFor(book).find((o) => o.reason === null)!;
    const { session, books } = makeSession(book);
    unitEditOps(session, "bk-u1")!.addTask(offer.type, offer.itemIds);
    expect(errorsOf(books[0]!)).toEqual([]);
  });
});

describe("the Exercises page", () => {
  afterEach(cleanup);

  const FOUR_WORDS = ["bk-w1", "bk-w2", "bk-w3", "bk-w4"];
  const VOCABULARY = 2;
  const EXAMPLES = 4;

  const goToPage = (index: number) =>
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Page \d+ of/ })[index]!,
    );

  /** The trail's last dot in edit mode; learner mode does not have one. */
  function goToExercises() {
    const dots = screen.getAllByRole("button", { name: /^Page \d+ of/ });
    fireEvent.click(dots[dots.length - 1]!);
  }

  it("has no dot at all in learner mode", () => {
    const book = unitOf(fullBook(), FOUR_WORDS);
    renderUnit(null, book);
    // Overview, Vocabulary — this unit holds only words — and nothing else.
    for (const dot of screen.getAllByRole("button", { name: /^Page \d+ of/ })) {
      fireEvent.click(dot);
      expect(screen.queryByText("+ add an exercise")).toBeNull();
    }
  });

  it("marks the Exercises dot out from the content pages", () => {
    const book = unitOf(fullBook(), FOUR_WORDS);
    renderUnit(makeSession(book).session, book);
    const dots = screen.getAllByRole("button", { name: /^Page \d+ of/ });
    // Edit-only, so it cannot look like one more page a learner will see.
    expect(dots.at(-1)!.className).toContain("exercises");
    expect(dots[0]!.className).not.toContain("exercises");
  });

  it("creates an exercise from the offered list and lists it", () => {
    const book = unitOf(fullBook(), FOUR_WORDS);
    const { session, books } = makeSession(book);
    renderUnit(session, book);
    goToExercises();

    fireEvent.click(screen.getByText("+ add an exercise"));
    // Greyed rows explain themselves rather than being hidden.
    expect(
      screen.getByText(/Minimal-pair — no pairs in this unit/),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("+ Recognize · 4 words"));
    const written = books[0]!;
    expect(written.tasks).toHaveLength(1);
    const task = written.tasks[0] as { id: string; itemIds: string[] };
    expect(task.itemIds).toEqual(FOUR_WORDS);
    expect((written.units[0] as { taskIds: string[] }).taskIds).toEqual([
      task.id,
    ]);
    // Never by id, anywhere on the page.
    expect(screen.queryByText(new RegExp(task.id))).toBeNull();
  });

  it("offers only the types the exercise's current items support", () => {
    const book = fullBook();
    const withTask = {
      ...unitOf(book, FOUR_WORDS),
      tasks: [{ id: "bk-t1", type: "recognize", itemIds: FOUR_WORDS }],
    } as unknown as BookDocument;
    const bookWithTask = {
      ...withTask,
      units: [{ ...(withTask.units[0] as object), taskIds: ["bk-t1"] }],
    } as unknown as BookDocument;
    const { session } = makeSession(bookWithTask);
    renderUnit(session, bookWithTask);
    goToExercises();

    const types = [...screen.getByLabelText("Type").querySelectorAll("option")]
      .map((option) => option.textContent)
      .sort();
    // Words with audio and an image: everything but the sentence-only types
    // (Cloze, Scramble, Build, Dictation) and pair-only Minimal-pair.
    expect(types).toEqual([
      "Listen",
      "Matching",
      "Picture",
      "Recall",
      "Recognize",
      "Shadowing",
    ]);
  });

  it('clears an asset ref by deleting the key, not by leaving ""', () => {
    // §2c: `slugSchema` rejects `""`, so an emptied ref that stays as `""`
    // is unpublishable — the same trap slice 6 records for
    // `unlocksAfterUnitId`, which is why this asserts with `in`.
    const book = unitOf(fullBook(), FOUR_WORDS);
    const { session, books } = makeSession(book);
    renderUnit(session, book);
    goToPage(VOCABULARY);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]!);

    const audio = screen.getByLabelText("Audio");
    expect(audio.querySelector("option[value='a1']")).not.toBeNull();
    fireEvent.change(audio, { target: { value: "" } });

    const payload = (books.at(-1)!.items[0] as { payload: object }).payload;
    expect("audioRef" in payload).toBe(false);
  });

  it("gives a pair its two required audio slots", () => {
    // The only mandatory slugs in the schema, and the reason `RowExtras`
    // branches on kind at all.
    const book = unitOf(fullBook(), ["bk-p1"]);
    const { session } = makeSession(book);
    renderUnit(session, book);
    goToPage(EXAMPLES);
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    for (const label of ["First audio", "Second audio"]) {
      const slot = screen.getByLabelText(label);
      expect(slot.querySelector("option[value='a1']")).not.toBeNull();
      // Required and already set: offering "(none)" would author an item
      // that cannot be published.
      expect(slot.querySelector("option[value='']")).toBeNull();
    }
    // A pair has no image slot at all.
    expect(screen.queryByLabelText("Image")).toBeNull();
  });

  it("deletes an exercise behind a confirm that names it, stripping taskIds", () => {
    const base = unitOf(fullBook(), FOUR_WORDS);
    const bookWithTask = {
      ...base,
      tasks: [{ id: "bk-t1", type: "recognize", itemIds: FOUR_WORDS }],
      units: [{ ...(base.units[0] as object), taskIds: ["bk-t1"] }],
    } as unknown as BookDocument;
    const { session, books } = makeSession(bookWithTask);
    renderUnit(session, bookWithTask);
    goToExercises();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Named by type and item count in the confirm, never by id.
    expect(
      screen.getByText(/“Recognize · 4 words” will be removed/),
    ).toBeTruthy();
    expect(screen.queryByText(/bk-t1/)).toBeNull();
    // The sheet's own Delete, not the row's, which opened it.
    const confirms = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirms[confirms.length - 1]!);

    expect(books[0]!.tasks).toHaveLength(0);
    expect((books[0]!.units[0] as { taskIds: string[] }).taskIds).toEqual([]);
  });
});
