import { Fragment, useEffect, useRef, useState } from "react";
import type { Content, Item } from "@betterbeaver/schema";
import { stripClozeMarkup } from "@betterbeaver/schema";
import { countUnitQuestions } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { TappableText } from "../components/TappableText";
import { NoteView } from "../components/NoteView";
import { NoteEditor } from "../components/NoteEditor";
import { EntryPopup } from "../components/EntryPopup";
import { useEditSession } from "./edit/EditSessionContext";
import {
  ProblemMarker,
  type UnitEditOps,
  unitEditOps,
  withPayload,
  withUnlocksAfter,
} from "./edit/inPlace";
import { EntityPicker, RowActions } from "./edit/fields";
import { unitPoolOptionsGroupedByLesson } from "./entityPicker";
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
 * delta check, no swipe library). Exported so `SessionScreen`'s back-swipe
 * out of the unit's practice session feels the same as the trail's. */
export const SWIPE_THRESHOLD = 40;

type PageKind = "overview" | "theory" | "vocabulary" | "concepts" | "examples";

/** Plan 0021 decision 12, worded for someone who has never heard the word
 * "domain": this Book points at a lexicon somebody else maintains. */
const SHARED_LEXICON_NOTE =
  "these words come from somewhere else — you can use them, but not change them";

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
  edit,
}: {
  item: ExampleItem;
  lookup: TapLookup;
  bookDocId: string;
  edit?: UnitEditOps;
}) {
  const [showTranslation, setShowTranslation] = useState(false);

  if (edit !== undefined) {
    const raw = edit.raw(item.id) ?? { id: item.id };
    const set = (path: [string] | [string, string], value: string) =>
      edit.patchEntity(withPayload(raw, path, value));
    const editable = edit.canEditRow(item.id);
    const field = (
      label: string,
      path: [string] | [string, string],
      multiline = false,
    ) => (
      <>
        <label className="field">
          {label}
          {multiline ? (
            <textarea
              rows={2}
              readOnly={!editable}
              value={edit.payloadValue(item.id, ...path)}
              onChange={(e) => set(path, e.target.value)}
            />
          ) : (
            <input
              type="text"
              readOnly={!editable}
              value={edit.payloadValue(item.id, ...path)}
              onChange={(e) => set(path, e.target.value)}
            />
          )}
        </label>
        <ProblemMarker
          problems={edit.fieldProblems(item.id, `payload.${path.join(".")}`)}
        />
      </>
    );
    return (
      <li className="card">
        {item.kind === "sentence" ? (
          <>
            {field("Text", ["text"], true)}
            {field("Translation", ["translation"], true)}
          </>
        ) : (
          <>
            {field("First", ["a", "script"])}
            {field("Second", ["b", "script"])}
            {field("Contrast", ["contrast"], true)}
          </>
        )}
        <ProblemMarker problems={edit.entityProblems(item.id)} />
        <RowActions
          onUp={() => edit.moveRow(item.id, -1)}
          onDown={() => edit.moveRow(item.id, 1)}
          onRemove={() => edit.removeRow(item.id)}
          removeLabel={edit.removeLabel(item.id)}
        />
      </li>
    );
  }

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
  bookId,
  noteId,
  edit,
  stem,
}: {
  markdown: string;
  lookup: TapLookup;
  pinned: boolean;
  onPin: () => void;
  bookDocId: string;
  /** The bare Book id (spec 0021-2 §2c) — `getAssetUrl` takes the book
   * directory, not `bookDocId`'s `topic:`-prefixed document id. */
  bookId: string;
  noteId: string;
  edit?: UnitEditOps;
  stem: string;
}) {
  if (edit !== undefined) {
    return (
      <section className="note">
        <NoteEditor
          markdown={markdown}
          onChange={(next) => edit.setNoteMarkdown(stem, next)}
          assets={edit.imageAssets}
          {...(edit.uploadAsset !== undefined
            ? { onUploadAsset: edit.uploadAsset }
            : {})}
          {...(edit.lexicon !== undefined ? { lexicon: edit.lexicon } : {})}
        />
        {/* No pin control: pinning a draft note into your own review queue
            is meaningless. */}
        <button
          className="plain danger"
          onClick={() => edit.removeNoteByStem(stem)}
        >
          Delete this note
        </button>
      </section>
    );
  }
  return (
    <section className="note">
      <NoteView markdown={markdown} lookup={lookup} bookId={bookId} />
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
  startAtEnd,
  noteMarkdown = (stem) => getNoteMarkdown(content.topic.id, stem),
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
  /** Opens on the last content page instead of the Overview — how the
   * practice session's back-swipe returns you to where you left the trail. */
  startAtEnd?: boolean;
  /** Raw note markdown by stem. Defaults to the module-global
   * `getNoteMarkdown`, which only knows published text — edit mode passes
   * the draft's own instead (spec 0021-5 §2d). */
  noteMarkdown?: (stem: string) => string | undefined;
}) {
  // Which shipped lexicon entry's popup is open, if any (kind-partitioned
  // restructure's Vocabulary table): opened by id directly, same
  // "open a known entry" pattern as VocabularyScreen's synonym chips —
  // never re-resolved by token, since the table row already is the entry.
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  // Edit mode (plan 0021 §3): `null` in learner mode, and every editable
  // surface below is `edit === null ? <text> : <input>`. One implementation,
  // never a parallel edit view — two trees of the same screen is exactly the
  // duplication this plan exists to remove.
  const edit = unitEditOps(useEditSession(), unitId);
  // Which vocabulary row has its secondary fields open (transliteration
  // today; slice 8 §2c adds the source and asset controls to the same row).
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Trail page index, plus each section's own sub-pager index (plan 0010
  // design section 4: no shared pagination abstraction — one useState each).
  // `startAtEnd` seeds an out-of-range sentinel rather than a real index:
  // which pages exist isn't known until `pages` is built further down, and
  // everything below reads the clamped `pageIndex` anyway.
  const [page, setPage] = useState(startAtEnd ? Number.MAX_SAFE_INTEGER : 0);
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
          const markdown = noteMarkdown(note.stem);
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

  // Edit mode shows all five pages whether or not they have content yet:
  // each page owns its own add control, so an empty page hidden is a page
  // you can never put the first word, concept or example on.
  const pages: PageKind[] = [
    "overview",
    ...(notes.length > 0 || edit !== null ? (["theory"] as const) : []),
    ...(lexemes.length > 0 || edit !== null ? (["vocabulary"] as const) : []),
    ...(concepts.length > 0 || edit !== null ? (["concepts"] as const) : []),
    ...(examples.length > 0 || edit !== null ? (["examples"] as const) : []),
  ];
  // Never read `page` directly below: it may still hold `startAtEnd`'s
  // sentinel, which no arithmetic would ever walk back into range.
  const pageIndex = Math.min(page, pages.length - 1);
  const currentPage = pages[pageIndex];
  const atLastPage = pageIndex === pages.length - 1;

  function goPrev() {
    setPage(Math.max(0, pageIndex - 1));
  }
  function goNext() {
    // Practice is the trail's last dot (owner request): advancing past the
    // final page starts the unit's tasks instead of going nowhere.
    if (atLastPage) {
      onPractice();
      return;
    }
    setPage(pageIndex + 1);
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
    // `page`/`onPractice` are read by goNext — without them here the handler
    // keeps the first render's unit and page (App.tsx renders UnitScreen
    // unkeyed, so switching units reuses this instance).
  }, [pages.length, page, onPractice]);

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

  // The Book's other units, by title and grouped by lesson, for the two
  // unit-reference controls on Overview. A unit never references itself
  // (validator class (l)), so it simply isn't offered.
  const unitPool =
    edit === null
      ? []
      : unitPoolOptionsGroupedByLesson(
          content.topic.lessonIds.flatMap((id) => {
            const lesson = content.lessons.find((l) => l.id === id);
            return lesson !== undefined ? [lesson] : [];
          }),
          content.units.filter((u) => u.id !== unitId),
        );

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
              className={`dot${index === pageIndex ? " active" : ""}`}
              aria-label={`Page ${index + 1} of ${pages.length}`}
              onClick={() => setPage(index)}
            />
          ))}
          <button
            type="button"
            className="dot practice"
            aria-label="Practice"
            onClick={onPractice}
          />
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
        edit === null ? (
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
        ) : (
          <>
            <label className="field">
              Title
              <input
                type="text"
                value={unit.title}
                onChange={(e) =>
                  edit.patchUnit({ ...edit.rawUnit, title: e.target.value })
                }
              />
            </label>
            <ProblemMarker problems={edit.fieldProblems(unit.id, "title")} />
            <label className="field">
              Goal
              <textarea
                rows={3}
                value={unit.goal}
                onChange={(e) =>
                  edit.patchUnit({ ...edit.rawUnit, goal: e.target.value })
                }
              />
            </label>
            <ProblemMarker problems={edit.fieldProblems(unit.id, "goal")} />
            {/* Problems naming this unit and nothing narrower — "unit has
                zero tasks" is the common one — belong here, once. */}
            <ProblemMarker problems={edit.entityProblems(unit.id)} />
            {/* Both live on the unit even though their learner surfaces are
                elsewhere: the lock icon on the Lesson screen, and the
                "Remember:" cards above. */}
            <EntityPicker
              label="Unlocks after"
              options={unitPool}
              selected={
                unit.unlocksAfterUnitId !== undefined
                  ? [unit.unlocksAfterUnitId]
                  : []
              }
              onChange={(ids) =>
                edit.patchUnit(withUnlocksAfter(edit.rawUnit, ids[0]))
              }
              multiple={false}
              groupBy
              hideIds
            />
            <EntityPicker
              label="Remember"
              options={unitPool}
              selected={unit.recallUnitIds ?? []}
              onChange={(ids) =>
                edit.patchUnit({ ...edit.rawUnit, recallUnitIds: ids })
              }
              multiple
              groupBy
              hideIds
            />
          </>
        )
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
              bookId={content.topic.id}
              noteId={note.noteId}
              stem={note.stem}
              {...(edit !== null ? { edit } : {})}
            />
          ))}
          {edit !== null && (
            <button type="button" className="editor-add" onClick={edit.addNote}>
              + note
            </button>
          )}
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
          {edit !== null && !edit.canEditLexicon && (
            <p className="status">{SHARED_LEXICON_NOTE}</p>
          )}
          <table className="vocab-table">
            <thead>
              <tr>
                <th>Script</th>
                <th>Gloss</th>
                {lexemesHaveAudio ? <th>Audio</th> : null}
                {edit !== null ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {lexemes.map((item) => {
                const editable = edit !== null && edit.canEditRow(item.id);
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        {editable ? (
                          <>
                            <input
                              type="text"
                              aria-label="Script"
                              value={edit.payloadValue(item.id, "script")}
                              onChange={(e) =>
                                edit.patchEntity(
                                  withPayload(
                                    edit.raw(item.id) ?? { id: item.id },
                                    ["script"],
                                    e.target.value,
                                  ),
                                )
                              }
                            />
                            <ProblemMarker
                              problems={edit.fieldProblems(
                                item.id,
                                "payload.script",
                              )}
                            />
                          </>
                        ) : (
                          <button
                            type="button"
                            className="plain tappable-token"
                            onClick={() => setOpenEntryId(item.id)}
                          >
                            {item.payload.script}
                          </button>
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <>
                            <input
                              type="text"
                              aria-label="Gloss"
                              value={edit.payloadValue(item.id, "gloss")}
                              onChange={(e) =>
                                edit.patchEntity(
                                  withPayload(
                                    edit.raw(item.id) ?? { id: item.id },
                                    ["gloss"],
                                    e.target.value,
                                  ),
                                )
                              }
                            />
                            <ProblemMarker
                              problems={edit.fieldProblems(
                                item.id,
                                "payload.gloss",
                              )}
                            />
                          </>
                        ) : (
                          item.payload.gloss
                        )}
                      </td>
                      {/* The speaker stays a speaker (§2c): setting
                          `audioRef` is slice 8's expanded row, and a row
                          with no audio shows nothing rather than an empty
                          control. */}
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
                      {edit !== null ? (
                        <td>
                          <RowActions
                            onUp={() => edit.moveRow(item.id, -1)}
                            onDown={() => edit.moveRow(item.id, 1)}
                            onRemove={() => edit.removeRow(item.id)}
                            removeLabel={edit.removeLabel(item.id)}
                          />
                          {editable && (
                            <button
                              type="button"
                              className="plain"
                              onClick={() =>
                                setExpandedRow((open) =>
                                  open === item.id ? null : item.id,
                                )
                              }
                            >
                              {expandedRow === item.id ? "Less" : "More"}
                            </button>
                          )}
                          <ProblemMarker
                            problems={edit.entityProblems(item.id)}
                          />
                        </td>
                      ) : null}
                    </tr>
                    {editable && expandedRow === item.id ? (
                      <tr>
                        <td colSpan={lexemesHaveAudio ? 4 : 3}>
                          <label className="field">
                            Transliteration
                            <input
                              type="text"
                              value={edit.payloadValue(
                                item.id,
                                "transliteration",
                              )}
                              onChange={(e) =>
                                edit.patchEntity(
                                  withPayload(
                                    edit.raw(item.id) ?? { id: item.id },
                                    ["transliteration"],
                                    e.target.value,
                                  ),
                                )
                              }
                            />
                          </label>
                          <ProblemMarker
                            problems={edit.fieldProblems(
                              item.id,
                              "payload.transliteration",
                            )}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {edit !== null &&
            edit.entryKind === "lexeme" &&
            edit.canEditLexicon && (
              // Only where a new entry of this domain's kind belongs (§2e): a
              // `general` domain holds concepts, and an entry added here would
              // land on the Concepts page instead of the one that was tapped.
              <button
                type="button"
                className="editor-add"
                onClick={() => edit.addItem("lexeme")}
              >
                + word
              </button>
            )}
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
                {edit !== null ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {/* No per-row FeedbackWidget here (owner request): a third
                  column of thumbs crowded the table off a phone screen. The
                  unit-level widget on Overview still covers reports. */}
              {conceptRows.map((item) => {
                const editable = edit !== null && edit.canEditRow(item.id);
                return (
                  <tr key={item.id}>
                    <td>
                      {editable ? (
                        <>
                          <input
                            type="text"
                            aria-label="Term"
                            value={edit.payloadValue(item.id, "term")}
                            onChange={(e) =>
                              edit.patchEntity(
                                withPayload(
                                  edit.raw(item.id) ?? { id: item.id },
                                  ["term"],
                                  e.target.value,
                                ),
                              )
                            }
                          />
                          <ProblemMarker
                            problems={edit.fieldProblems(
                              item.id,
                              "payload.term",
                            )}
                          />
                        </>
                      ) : (
                        item.payload.term
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <>
                          <input
                            type="text"
                            aria-label="Definition"
                            value={edit.payloadValue(item.id, "definition")}
                            onChange={(e) =>
                              edit.patchEntity(
                                withPayload(
                                  edit.raw(item.id) ?? { id: item.id },
                                  ["definition"],
                                  e.target.value,
                                ),
                              )
                            }
                          />
                          <ProblemMarker
                            problems={edit.fieldProblems(
                              item.id,
                              "payload.definition",
                            )}
                          />
                        </>
                      ) : (
                        item.payload.definition
                      )}
                    </td>
                    {edit !== null ? (
                      <td>
                        <RowActions
                          onUp={() => edit.moveRow(item.id, -1)}
                          onDown={() => edit.moveRow(item.id, 1)}
                          onRemove={() => edit.removeRow(item.id)}
                          removeLabel={edit.removeLabel(item.id)}
                        />
                        <ProblemMarker
                          problems={edit.entityProblems(item.id)}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {edit !== null && (
            <button
              type="button"
              className="editor-add"
              onClick={() => edit.addItem("concept")}
            >
              + concept
            </button>
          )}
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
                {...(edit !== null ? { edit } : {})}
              />
            ))}
          </ul>
          {edit !== null && (
            <>
              <button
                type="button"
                className="editor-add"
                onClick={() => edit.addItem("sentence")}
              >
                + sentence
              </button>
              <button
                type="button"
                className="editor-add"
                onClick={() => edit.addItem("pair")}
              >
                + pair
              </button>
            </>
          )}
        </>
      ) : null}

      {/* One bar, two jobs (owner request): it walks the trail forward until
          the last content page, where it becomes the Practice launcher —
          `goNext` already treats "past the end" as Practice.
          Hidden in edit mode (spec 0021-6 §1): practising a draft is what
          Preview is for (slice 9), and a Practice button that starts a
          session over half-typed content is a trap. */}
      {edit === null && (
        <div className="action-bar unit-practice-bar">
          <div className="action-bar-inner unit-practice-bar-inner">
            <button className="unit-practice-button" onClick={goNext}>
              <span>{atLastPage ? "Practice" : "Next"}</span>
              {atLastPage && (
                <span className="unit-practice-count">
                  {countUnitQuestions(unit, content)}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

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
