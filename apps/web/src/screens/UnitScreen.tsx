import { useEffect, useRef, useState } from "react";
import type { Content, Item } from "@betterbeaver/schema";
import { stripClozeMarkup } from "@betterbeaver/schema";
import type { SelfGrade } from "@betterbeaver/srs";
import { countUnitQuestions } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { TappableText } from "../components/TappableText";
import { NoteView } from "../components/NoteView";
import { EntryPopup } from "../components/EntryPopup";
import { getLexiconAssetUrl, getNoteMarkdown } from "../content/bundled";
import { SpeakerButton } from "../tts";

type LexemeItem = Extract<Item, { kind: "lexeme" }>;
type ConceptItem = Extract<Item, { kind: "concept" }>;
type ExampleItem = Extract<Item, { kind: "sentence" | "pair" }>;

// Chunk sizes for the Concepts/Examples sub-pagers (plan 0010 design section
// 4; Vocabulary lost its sub-pager in plan 0011 — scrollable instead).
// ponytail: picked for a typical phone viewport, not measured — tune once
// real content shows one is visibly wrong.
const CONCEPT_CHUNK_SIZE = 6;
const EXAMPLE_CHUNK_SIZE = 4;

/** Swipe gesture threshold, in px (plan 0010: plain touchstart/touchend
 * delta check, no swipe library). */
const SWIPE_THRESHOLD = 40;

type PageKind = "overview" | "theory" | "vocabulary" | "concepts" | "examples";

/** Splits `items` into fixed-size chunks, last chunk possibly shorter.
 * A plain array utility, not a pagination framework (plan 0010 non-goals) —
 * each of the two call sites (Concepts, Examples — Vocabulary lost its
 * chunking in plan 0011) still owns its own page-index `useState`. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** "‹ Note 2 of 5 ›"-style sub-pager, shared shape across Theory/Concepts/
 * Examples sub-pagination (plan 0010 design section 4; Vocabulary lost its
 * sub-pager in plan 0011) — no shared component beyond this presentational
 * control, each caller keeps its own index state. */
function SubPager({
  index,
  count,
  label,
  onPrev,
  onNext,
}: {
  index: number;
  count: number;
  label: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="sub-pager">
      <button
        type="button"
        className="plain"
        disabled={index === 0}
        onClick={onPrev}
      >
        &lsaquo;
      </button>
      <span className="status">
        {label} {index + 1} of {count}
      </span>
      <button
        type="button"
        className="plain"
        disabled={index === count - 1}
        onClick={onNext}
      >
        &rsaquo;
      </button>
    </div>
  );
}

/** An "Examples" card: `sentence` and `pair` items only (kind-partitioned
 * unit restructure) — `lexeme`/`concept` now render as table rows instead.
 * The target-language script is wrapped in `TappableText` (full-string
 * whitespace tokenization is correct here, unlike notes: a sentence/pair's
 * script is pure target-language text, not mixed prose); translation/contrast
 * text stays plain. */
function ExampleCard({
  item,
  lookup,
}: {
  item: ExampleItem;
  lookup: TapLookup;
}) {
  const [showTranslation, setShowTranslation] = useState(false);

  if (item.kind === "sentence") {
    return (
      <li className="card">
        <p>
          <TappableText
            text={stripClozeMarkup(item.payload.text)}
            lookup={lookup}
          />
        </p>
        {showTranslation ? (
          <strong>{item.payload.translation}</strong>
        ) : (
          <button
            type="button"
            className="plain tappable-token"
            onClick={() => setShowTranslation(true)}
          >
            Show translation
          </button>
        )}
      </li>
    );
  }
  return (
    <li className="card">
      <strong>
        <TappableText text={item.payload.a.script} lookup={lookup} /> /{" "}
        <TappableText text={item.payload.b.script} lookup={lookup} />
      </strong>
      <p>{item.payload.contrast}</p>
    </li>
  );
}

/** One Theory note plus its self-grade row (plan 0008 step 7): a note has no
 * separate "study it once" action, so grading is offered right here —
 * reviewing *is* how a note first gets SRS state, same self-grade vocabulary
 * (Again/Hard/Good) as `SessionScreen`'s `NoteReview`. */
function NoteCard({
  markdown,
  lookup,
  onGrade,
}: {
  markdown: string;
  lookup: TapLookup;
  onGrade: (grade: SelfGrade) => void;
}) {
  return (
    <section className="note">
      <NoteView markdown={markdown} lookup={lookup} />
      <p>Review this note:</p>
      <div className="grade-buttons">
        <button onClick={() => onGrade("again")}>Again</button>
        <button onClick={() => onGrade("hard")}>Hard</button>
        <button onClick={() => onGrade("good")}>Good</button>
      </div>
    </section>
  );
}

export function UnitScreen({
  content,
  unitId,
  lookup,
  onPractice,
  onGradeNote,
  onBack,
}: {
  content: Content;
  unitId: string;
  /** Tap-to-lookup dependencies (plan 0006 step 4): note views are a pinned
   * non-graded surface. */
  lookup: TapLookup;
  /** Unit-scoped now (plan 0010): launches one pooled, shuffled session
   * across the whole unit's task set, rather than picking a single task. */
  onPractice: () => void;
  /** Self-grades a note (plan 0008 step 7) — first grading schedules it,
   * entering it into the domain's review queue like any other unit. */
  onGradeNote: (noteId: string, grade: SelfGrade) => void;
  onBack: () => void;
}) {
  // Which shipped lexicon entry's popup is open, if any (kind-partitioned
  // restructure's Vocabulary table): opened by id directly, same
  // "open a known entry" pattern as VocabularyScreen's synonym chips —
  // never re-resolved by token, since the table row already is the entry.
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  // Trail page index, plus each section's own sub-pager index (plan 0010
  // design section 4: no shared pagination abstraction — one useState each).
  const [page, setPage] = useState(0);
  const [noteIndex, setNoteIndex] = useState(0);
  const [conceptPage, setConceptPage] = useState(0);
  const [examplePage, setExamplePage] = useState(0);

  const touchStartX = useRef<number | null>(null);

  const unit = content.units.find((u) => u.id === unitId);

  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const noteById = new Map(content.notes.map((note) => [note.id, note]));

  const domainId = lookup.domainContent.domain.id;
  const readAloudLang = lookup.domainContent.domain.readAloudLang;

  const notes =
    unit === undefined
      ? []
      : unit.noteIds.flatMap((noteId) => {
          const note = noteById.get(noteId);
          if (note === undefined) {
            return [];
          }
          const markdown = getNoteMarkdown(content.topic.id, note.stem);
          return markdown === undefined ? [] : [{ noteId, markdown }];
        });

  const items =
    unit === undefined
      ? []
      : unit.itemIds.flatMap((itemId) => {
          const item = itemById.get(itemId);
          return item !== undefined ? [item] : [];
        });
  const lexemes = items.filter(
    (item): item is LexemeItem => item.kind === "lexeme",
  );
  const concepts = items.filter(
    (item): item is ConceptItem => item.kind === "concept",
  );
  const examples = items.filter(
    (item): item is ExampleItem =>
      item.kind === "sentence" || item.kind === "pair",
  );

  const pages: PageKind[] = [
    "overview",
    ...(notes.length > 0 ? (["theory"] as const) : []),
    ...(lexemes.length > 0 ? (["vocabulary"] as const) : []),
    ...(concepts.length > 0 ? (["concepts"] as const) : []),
    ...(examples.length > 0 ? (["examples"] as const) : []),
  ];
  const currentPage = pages[Math.min(page, pages.length - 1)];

  function goPrev() {
    setPage((p) => Math.max(0, p - 1));
  }
  function goNext() {
    setPage((p) => Math.min(pages.length - 1, p + 1));
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        goPrev();
      } else if (event.key === "ArrowRight") {
        goNext();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pages.length]);

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }
  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null) {
      return;
    }
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    if (delta > SWIPE_THRESHOLD) {
      goPrev();
    } else if (delta < -SWIPE_THRESHOLD) {
      goNext();
    }
  }

  if (unit === undefined) {
    return (
      <main>
        <button onClick={onBack}>&larr; Back</button>
        <p>Unknown unit: {unitId}</p>
      </main>
    );
  }

  const conceptChunks = chunk(concepts, CONCEPT_CHUNK_SIZE);
  const conceptRows =
    conceptChunks[Math.min(conceptPage, conceptChunks.length - 1)] ?? [];

  const exampleChunks = chunk(examples, EXAMPLE_CHUNK_SIZE);
  const exampleCards =
    exampleChunks[Math.min(examplePage, exampleChunks.length - 1)] ?? [];

  const currentNote = notes[Math.min(noteIndex, notes.length - 1)];

  return (
    <main
      className="unit-screen"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <header className="screen-header">
        <button className="plain exit" aria-label="Back" onClick={onBack}>
          &larr;
        </button>
        <div className="trail">
          {pages.map((pageKind, index) => (
            <button
              key={pageKind}
              type="button"
              className={`dot${index === page ? " active" : ""}`}
              aria-label={`Page ${index + 1} of ${pages.length}`}
              onClick={() => setPage(index)}
            />
          ))}
        </div>
      </header>

      {currentPage === "overview" ? (
        <>
          <h1>{unit.title}</h1>
          <p>{unit.goal}</p>
        </>
      ) : null}

      {currentPage === "theory" ? (
        <>
          <p className="eyebrow">
            <span aria-hidden="true">📘</span> Theory
          </p>
          {notes.length > 1 ? (
            <SubPager
              index={noteIndex}
              count={notes.length}
              label="Note"
              onPrev={() => setNoteIndex((i) => Math.max(0, i - 1))}
              onNext={() =>
                setNoteIndex((i) => Math.min(notes.length - 1, i + 1))
              }
            />
          ) : null}
          {currentNote !== undefined ? (
            <NoteCard
              key={currentNote.noteId}
              markdown={currentNote.markdown}
              lookup={lookup}
              onGrade={(grade) => onGradeNote(currentNote.noteId, grade)}
            />
          ) : null}
        </>
      ) : null}

      {currentPage === "vocabulary" ? (
        <>
          <p className="eyebrow">
            <span aria-hidden="true">🔤</span> Vocabulary
          </p>
          <table className="vocab-table">
            <thead>
              <tr>
                <th>Script</th>
                <th>Gloss</th>
                <th>Audio</th>
              </tr>
            </thead>
            <tbody>
              {lexemes.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      type="button"
                      className="plain tappable-token"
                      onClick={() => setOpenEntryId(item.id)}
                    >
                      {item.payload.script}
                    </button>
                  </td>
                  <td>{item.payload.gloss}</td>
                  <td>
                    <SpeakerButton
                      text={item.payload.script}
                      lang={readAloudLang}
                      assetUrl={
                        item.payload.audioRef !== undefined
                          ? getLexiconAssetUrl(
                              domainId,
                              "audio",
                              item.payload.audioRef,
                            )
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {currentPage === "concepts" ? (
        <>
          <p className="eyebrow">
            <span aria-hidden="true">💡</span> Concepts
          </p>
          {conceptChunks.length > 1 ? (
            <SubPager
              index={conceptPage}
              count={conceptChunks.length}
              label="Page"
              onPrev={() => setConceptPage((p) => Math.max(0, p - 1))}
              onNext={() =>
                setConceptPage((p) => Math.min(conceptChunks.length - 1, p + 1))
              }
            />
          ) : null}
          <table className="vocab-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {conceptRows.map((item) => (
                <tr key={item.id}>
                  <td>{item.payload.term}</td>
                  <td>{item.payload.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {currentPage === "examples" ? (
        <>
          <p className="eyebrow">
            <span aria-hidden="true">✍️</span> Examples
          </p>
          {exampleChunks.length > 1 ? (
            <SubPager
              index={examplePage}
              count={exampleChunks.length}
              label="Page"
              onPrev={() => setExamplePage((p) => Math.max(0, p - 1))}
              onNext={() =>
                setExamplePage((p) => Math.min(exampleChunks.length - 1, p + 1))
              }
            />
          ) : null}
          <ul className="card-list">
            {exampleCards.map((item) => (
              <ExampleCard key={item.id} item={item} lookup={lookup} />
            ))}
          </ul>
        </>
      ) : null}

      <div className="action-bar unit-practice-bar">
        <div className="action-bar-inner unit-practice-bar-inner">
          <button className="unit-practice-button" onClick={onPractice}>
            <span>Practice</span>
            <span className="unit-practice-count">
              {countUnitQuestions(unit, content)}
            </span>
          </button>
        </div>
      </div>

      {openEntryId !== null ? (
        <EntryPopup
          token={openEntryId}
          entryId={openEntryId}
          lookup={lookup}
          onClose={() => setOpenEntryId(null)}
        />
      ) : null}
    </main>
  );
}
