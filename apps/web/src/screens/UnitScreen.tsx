import { useEffect, useRef, useState } from "react";
import type { Content, Item } from "@betterbeaver/schema";
import { stripClozeMarkup } from "@betterbeaver/schema";
import { countUnitQuestions } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { TappableText } from "../components/TappableText";
import { NoteView } from "../components/NoteView";
import { EntryPopup } from "../components/EntryPopup";
import { getLexiconAssetUrl } from "../content/bundled";
import { getNoteMarkdown } from "../content/source";
import { SpeakerButton } from "../tts";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { BookWatermark } from "../components/BookWatermark";

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
  bookDocId,
}: {
  item: ExampleItem;
  lookup: TapLookup;
  bookDocId: string;
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
        <FeedbackWidget
          docId={bookDocId}
          contentKind="item"
          contentId={item.id}
        />
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
      <FeedbackWidget
        docId={bookDocId}
        contentKind="item"
        contentId={item.id}
      />
    </li>
  );
}

/** One Theory note plus its pin control: no grade buttons here — pinning
 * schedules the note into the review queue (its first SRS state), where it
 * then behaves as a flashcard via `SessionScreen`'s `NoteReview`. */
function NoteCard({
  markdown,
  lookup,
  pinned,
  onPin,
  bookDocId,
  noteId,
}: {
  markdown: string;
  lookup: TapLookup;
  pinned: boolean;
  onPin: () => void;
  bookDocId: string;
  noteId: string;
}) {
  return (
    <section className="note">
      <NoteView markdown={markdown} lookup={lookup} />
      {/* ponytail: pin is one-way — unpinning means removing SRS state,
          add when someone actually asks for it */}
      <button className="plain" disabled={pinned} onClick={onPin}>
        <img
          className="icon-glyph"
          src={`${import.meta.env.BASE_URL}art/icons/pin.png`}
          alt=""
        />{" "}
        {pinned ? "Pinned for review" : "Pin for review"}
      </button>
      <FeedbackWidget docId={bookDocId} contentKind="note" contentId={noteId} />
    </section>
  );
}

export function UnitScreen({
  content,
  unitId,
  lookup,
  onPractice,
  onRecall,
  onPinNote,
  isNotePinned,
  onEdit,
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
  /** Launches a practice-only recall session over the linked unit's tasks (plan 0016). */
  onRecall: (linkedUnitId: string) => void;
  /** Pins a note for review — schedules it, entering it into the domain's
   * review queue like any other unit (it reviews as a flashcard there). */
  onPinNote: (noteId: string) => void;
  /** Whether a note already has SRS state (= is pinned), read once per unit. */
  isNotePinned: (noteId: string) => Promise<boolean>;
  /** Authors only (plan 0012): opens this unit in the editor — or the
   * currently shown theory note, when the Theory page is open. */
  onEdit?: (target?: { noteStem?: string }) => void;
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
          return markdown === undefined
            ? []
            : [{ noteId, stem: note.stem, markdown }];
        });

  // Which of this unit's notes are already scheduled (= pinned), read once
  // per unit; a tap adds optimistically since recordGrade can't unpin.
  const [pinnedNoteIds, setPinnedNoteIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      notes.map(
        async ({ noteId }) => [noteId, await isNotePinned(noteId)] as const,
      ),
    ).then((pairs) => {
      if (!cancelled) {
        setPinnedNoteIds(new Set(pairs.filter(([, p]) => p).map(([id]) => id)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [unitId]);

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
  const lexemesHaveAudio = lexemes.some(
    (item) => item.payload.audioRef !== undefined,
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
        <button onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          Back
        </button>
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

  return (
    <main
      className="unit-screen"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <BookWatermark bookId={content.topic.id} />
      <header className="screen-header">
        <button className="plain exit" aria-label="Back" onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />
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
        {onEdit !== undefined && (
          <button
            className="plain"
            aria-label="Edit content"
            onClick={() =>
              onEdit(
                currentPage === "theory" && notes.length === 1
                  ? { noteStem: notes[0]?.stem }
                  : undefined,
              )
            }
          >
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/edit.png`}
              alt=""
            />
          </button>
        )}
      </header>

      {currentPage === "overview" ? (
        <>
          <h1>{unit.title}</h1>
          <p>{unit.goal}</p>
          <FeedbackWidget
            docId={`topic:${content.topic.id}`}
            contentKind="unit"
            contentId={unit.id}
          />
          {(unit.recallUnitIds ?? []).flatMap((id) => {
            const linkedUnit = content.units.find((u) => u.id === id);
            if (linkedUnit === undefined) {
              return [];
            }
            return [
              <button
                key={linkedUnit.id}
                type="button"
                className="card recall"
                onClick={() => onRecall(linkedUnit.id)}
              >
                Remember: {linkedUnit.title}
              </button>,
            ];
          })}
        </>
      ) : null}

      {currentPage === "theory" ? (
        <>
          <p className="eyebrow">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/book_front.png`}
              alt=""
            />{" "}
            Theory
          </p>
          {/* All of a unit's notes share one trail dot — stacked here
              rather than paginated into subscreens. */}
          {notes.map((note) => (
            <NoteCard
              key={note.noteId}
              markdown={note.markdown}
              lookup={lookup}
              pinned={pinnedNoteIds.has(note.noteId)}
              onPin={() => {
                onPinNote(note.noteId);
                setPinnedNoteIds(new Set([...pinnedNoteIds, note.noteId]));
              }}
              bookDocId={`topic:${content.topic.id}`}
              noteId={note.noteId}
            />
          ))}
        </>
      ) : null}

      {currentPage === "vocabulary" ? (
        <>
          <p className="eyebrow">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/letters.png`}
              alt=""
            />{" "}
            Vocabulary
          </p>
          <table className="vocab-table">
            <thead>
              <tr>
                <th>Script</th>
                <th>Gloss</th>
                {lexemesHaveAudio ? <th>Audio</th> : null}
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
                  {lexemesHaveAudio ? (
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
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {currentPage === "concepts" ? (
        <>
          <p className="eyebrow">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/lightbulb.png`}
              alt=""
            />{" "}
            Concepts
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
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {conceptRows.map((item) => (
                <tr key={item.id}>
                  <td>{item.payload.term}</td>
                  <td>{item.payload.definition}</td>
                  <td>
                    <FeedbackWidget
                      docId={`domain:${domainId}`}
                      contentKind="item"
                      contentId={item.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {currentPage === "examples" ? (
        <>
          <p className="eyebrow">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/beaver_pencil.png`}
              alt=""
            />{" "}
            Examples
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
              <ExampleCard
                key={item.id}
                item={item}
                lookup={lookup}
                bookDocId={`topic:${content.topic.id}`}
              />
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
