import { Fragment, useEffect, useRef, useState } from "react";
import type { Content, Item } from "@betterbeaver/schema";
import {
  TASK_ALLOWED_ITEM_KINDS,
  TASK_TYPES,
  stripClozeMarkup,
} from "@betterbeaver/schema";
import { ConfirmSheet } from "../components/Sheet";
import { SettingsSheet } from "../components/SettingsSheet";
import { UndoToast, useUndoSnapshot } from "../components/UndoToast";
import { countUnitQuestions, diffNoteBlocks } from "@betterbeaver/engine";
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
  withOptionalKey,
} from "./edit/inPlace";
import { AssetRefPicker, EntityPicker, RowActions } from "./edit/fields";
import {
  type ExerciseOffer,
  exerciseLabel,
  exerciseOffers,
  exerciseTypeLabel,
  itemLabel,
  validTypesFor,
} from "./edit/exerciseOffers";
import { type DiffView, diffView } from "./edit/diffView";
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

/** A loosely-typed value as display text. The diff renders base-side
 * entities, which arrive as `unknown` off a stored document. */
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

type PageKind =
  | "overview"
  | "theory"
  | "vocabulary"
  | "concepts"
  | "examples"
  // Edit-only (spec 0021-8 §3): a task has no learner surface — it only
  // exists inside a running session — so this dot appears after the content
  // pages, and only while a session is open.
  | "exercises";

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

/** The `⚙` sheet's title is the row's own text, never the id (spec 0021-13
 * §2) — obvious which row you opened. A freshly added row has no text yet,
 * so this falls back to a generic label instead of an empty heading. */
function rowSheetTitle(text: string, fallback: string): string {
  return text.trim() === "" ? fallback : text;
}

/** A field whose learner rendering wraps — `definition` here, `text`/
 * `translation`/`contrast` on the Examples page, and the same fields in
 * `SessionEditSheet`'s sheet, which shares this control (spec 0021-13
 * Context) — auto-grows instead of clipping (spec 0021-13 §1). Same
 * `scrollHeight` measurement `NoteEditor`'s prose textarea uses (spec
 * 0021-12 §2), minus its auto-focus: this one sits in a list of rows the
 * author may not be touching, and stealing focus on every render would yank
 * it away from whichever field they actually are typing in.
 *
 * `[value]`, unlike `NoteEditor`'s version: that one measures a single
 * mounted textarea, this one is mounted once per row on a page of rows, all
 * re-rendering together on every keystroke in any of them (they all read
 * off the same `session.book`) — an effect with no dep array would re-measure
 * every one of them on every keystroke in any of them. */
export function GrowingTextarea({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
    />
  );
}

/**
 * What every item row hides behind its `⚙` (spec 0021-8 §2b, §2c; moved from
 * an inline expansion into `SettingsSheet` by spec 0021-13 §2, contents
 * unchanged): the source it came from, and its asset refs. **This is the
 * only surface that can set `audioRef`/`imageRef` at all** once slice 11
 * deletes the form editor — without it Listen, Dictation, Shadowing and
 * Picture become permanently unreachable, since §1a greys them for exactly
 * these refs.
 */
export function RowExtras({ item, edit }: { item: Item; edit: UnitEditOps }) {
  const raw = edit.raw(item.id) ?? { id: item.id };
  /** The one optional prose field per kind that `EntryPopup` renders and no
   * other in-place surface sets (spec 0021-11 §1) — `DomainEditor`'s and
   * `BookEditor`'s entry forms were the only way in. */
  const prose = (label: string, path: [string] | [string, string]) => (
    <>
      <label className="field">
        {label}
        <textarea
          rows={2}
          value={edit.payloadValue(item.id, ...path)}
          onChange={(e) =>
            edit.patchEntity(withPayload(raw, path, e.target.value))
          }
        />
      </label>
      <ProblemMarker
        problems={edit.fieldProblems(item.id, `payload.${path.join(".")}`)}
      />
    </>
  );
  const ref = (
    label: string,
    kind: "audio" | "image",
    path: [string] | [string, string],
    required = false,
  ) => (
    <AssetRefPicker
      label={label}
      assets={edit.assetsFor(item.id, kind)}
      selected={edit.payloadValue(item.id, ...path)}
      // Through `withPayload`, so clearing **deletes the key**: `slugSchema`
      // rejects `""`, and an emptied ref left as `""` is unpublishable.
      onChange={(stem) => edit.patchEntity(withPayload(raw, path, stem))}
      {...(() => {
        const upload = edit.uploadAssetFor(item.id);
        return upload !== undefined ? { onUpload: upload } : {};
      })()}
      required={required}
    />
  );
  return (
    <>
      {/* No `freeTextWhenEmpty` (§2b): slice 10 seeds a resource at Book
          creation, so an escape hatch that lets an author type a stem would
          outlive the problem it exists for. */}
      {edit.resources.length === 0 ? (
        <p className="status">add a source first — Sources, on the Book</p>
      ) : (
        <label className="field">
          Source
          <select
            value={typeof raw.sourceRef === "string" ? raw.sourceRef : ""}
            onChange={(e) =>
              edit.patchEntity({ ...raw, sourceRef: e.target.value })
            }
          >
            <option value="">(none)</option>
            {edit.resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {typeof resource.title === "string" && resource.title !== ""
                  ? resource.title
                  : resource.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <ProblemMarker problems={edit.fieldProblems(item.id, "sourceRef")} />
      {/* A lexeme's example is a text/translation pair, a concept's is one
          string — both surface in `EntryPopup` under the word's gloss. */}
      {item.kind === "lexeme" && (
        <>
          {prose("Example", ["example", "text"])}
          {prose("Example translation", ["example", "translation"])}
        </>
      )}
      {item.kind === "concept" && prose("Example", ["example"])}
      {item.kind === "pair" ? (
        <>
          {/* The only mandatory slugs in the schema (§2c). */}
          {ref("First audio", "audio", ["a", "audioRef"], true)}
          {ref("Second audio", "audio", ["b", "audioRef"], true)}
        </>
      ) : (
        <>
          {ref("Audio", "audio", ["audioRef"])}
          {/* A sentence has no `imageRef`: the validator exempts it from the
              image check (`validate.ts:635`) because the field isn't there. */}
          {item.kind !== "sentence" && ref("Image", "image", ["imageRef"])}
        </>
      )}
    </>
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
  onRemove,
  onSettings,
  diff,
}: {
  item: ExampleItem;
  lookup: TapLookup;
  bookDocId: string;
  edit?: UnitEditOps;
  /** Routes through the page's undo toast (spec 0021-13 §4) — never
   * `edit.removeRow` directly, so a delete here is undoable like every
   * other `−` on this trail. */
  onRemove?: () => void;
  /** Opens the row's `⚙` sheet (spec 0021-13 §2), rendered by the page body
   * alongside Vocabulary's and Concepts' own: this card is module-local
   * with one call site, so hoisting the sheet up costs nothing
   * `openLexeme`/`openConcept` don't already pay. */
  onSettings?: () => void;
  diff?: DiffView;
}) {
  const [showTranslation, setShowTranslation] = useState(false);

  if (diff !== undefined) {
    // Read-only, tinted, with the base card directly above a changed one.
    // The card renders the payload only, so a change confined to `sourceRef`
    // is not a pair (§3: the field is the granularity).
    const shown = { payload: item.payload };
    const was = diff.changedFrom<{ payload?: Record<string, unknown> }>(
      item.id,
      shown,
    );
    const body = (payload: Record<string, unknown> | undefined) =>
      item.kind === "sentence" ? (
        <>
          <p>{stripClozeMarkup(text(payload?.text))}</p>
          <strong>{text(payload?.translation)}</strong>
        </>
      ) : (
        <>
          <strong>
            {text((payload?.a as { script?: unknown } | undefined)?.script)} /{" "}
            {text((payload?.b as { script?: unknown } | undefined)?.script)}
          </strong>
          <p>{text(payload?.contrast)}</p>
        </>
      );
    return (
      <>
        {was !== undefined && (
          <li className="card diff-old">{body(was.payload)}</li>
        )}
        <li className={`card ${diff.className(item.id, shown) ?? ""}`}>
          {body(item.payload)}
        </li>
      </>
    );
  }

  if (edit !== undefined) {
    const raw = edit.raw(item.id) ?? { id: item.id };
    const set = (path: [string] | [string, string], value: string) =>
      edit.patchEntity(withPayload(raw, path, value));
    const editable = edit.canEditRow(item.id);
    // A field whose learner rendering wraps — `text`, `translation`,
    // `contrast` — auto-grows instead of clipping (spec 0021-13 §1), the
    // same `GrowingTextarea` the Concepts page's Definition uses. `First`/
    // `Second` stay single-line inputs: a pair's script is a short token,
    // the same call Vocabulary's Script/Gloss already make.
    const field = (
      label: string,
      path: [string] | [string, string],
      multiline = false,
    ) => (
      <>
        <label className="field">
          {label}
          {multiline ? (
            editable ? (
              <GrowingTextarea
                ariaLabel={label}
                value={edit.payloadValue(item.id, ...path)}
                onChange={(e) => set(path, e.target.value)}
              />
            ) : (
              edit.payloadValue(item.id, ...path)
            )
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
      <li className="card unit-row-card">
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
          onRemove={onRemove}
          removeLabel={edit.removeLabel(item.id)}
          {...(editable && onSettings !== undefined
            ? { onSettings, settingsLabel: "Example settings" }
            : {})}
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
/**
 * One note, diffed **by block** (spec 0021-9 §2a). `documentDiff` compares
 * whole fields, so a note's entire markdown is one field and a one-word edit
 * would read as "the whole note changed".
 *
 * Each block renders through the same `NoteView` the learner sees, from its
 * verbatim `raw` — so a tinted block looks like the note it came from.
 */
function NoteDiff({
  before,
  after,
  lookup,
  bookId,
}: {
  before: string;
  after: string;
  lookup: TapLookup;
  bookId: string;
}) {
  return (
    <section className="note">
      {diffNoteBlocks(before, after).map((entry, index) => (
        <div
          key={index}
          className={
            entry.status === "added"
              ? "diff-new"
              : entry.status === "removed"
                ? "diff-old"
                : undefined
          }
        >
          <NoteView
            markdown={entry.block.raw}
            lookup={lookup}
            bookId={bookId}
          />
        </div>
      ))}
    </section>
  );
}

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
  inSession,
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
  /** True in Preview: the learner tree renders, but nothing writes. */
  inSession?: boolean;
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
            is meaningless. Not `danger` (spec 0021-12 done-criteria: "no red
            word"): a whole-note delete still has no undo (ponytail: this
            component now sits beside a hoisted `useUndoSnapshot` (spec
            0021-13 §4, used by Vocabulary/Concepts/Examples below), but
            routing `removeNoteByStem` through it is Theory-page behaviour,
            and spec 0021-13 says "Not in this slice" — upgrade path is
            wiring it up when that page's own slice touches this button), so
            it still reads as plain text rather than the icon vocabulary's
            un-confirmed `−`. */}
        <button className="plain" onClick={() => edit.removeNoteByStem(stem)}>
          Delete this note
        </button>
      </section>
    );
  }
  return (
    <section className="note">
      <NoteView markdown={markdown} lookup={lookup} bookId={bookId} />
      {/* Preview plays the draft but **records nothing** (spec 0021-9 §1):
          pinning a draft note into your own review queue is a write, and
          reporting a problem in content you are drafting is a loop. */}
      {inSession ? null : (
        <>
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
          <FeedbackWidget
            docId={bookDocId}
            contentKind="note"
            contentId={noteId}
          />
        </>
      )}
    </section>
  );
}

/**
 * One existing exercise (spec 0021-8 §1b). Every control here is a picker
 * over what the unit already holds — there is no free-text id field, and the
 * type `<select>` lists only types this exercise's current items support.
 *
 * The type and its instructions move behind the card's own `⚙` (spec
 * 0021-13 §3), with the sheet's open state kept **local to this component**
 * rather than hoisted to `UnitScreen`'s body the way Vocabulary/Concepts/
 * Examples keep theirs: `SessionEditSheet` renders this same component from
 * outside `UnitScreen` entirely, over a different `expandedRow` (it has
 * none), so a page-level `openX` lookup would have nothing to read there.
 */
export function ExerciseCard({
  taskId,
  edit,
  itemById,
  unitItems,
  onDelete,
}: {
  taskId: string;
  edit: UnitEditOps;
  itemById: Map<string, Item>;
  unitItems: Item[];
  /** Absent in the session sheet (spec 0021-11 §3): deleting the exercise
   * you are practising would leave the session running over nothing. */
  onDelete?: (label: string) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const raw = edit.rawTask(taskId);
  if (raw === undefined) {
    // A `taskIds` entry pointing at no task — routine mid-edit, and
    // `checkReferences` already names it on the unit.
    return <li className="card status">an exercise that no longer exists</li>;
  }
  const itemIds = Array.isArray(raw.itemIds) ? (raw.itemIds as string[]) : [];
  const items = itemIds.flatMap((id) => {
    const item = itemById.get(id);
    return item !== undefined ? [item] : [];
  });
  const type = TASK_TYPES.find((t) => t === raw.type) ?? TASK_TYPES[0];
  // The current type is always offered, even when the items no longer
  // support it: dropping it would leave the `<select>` showing blank and
  // silently rewrite the exercise on the next change. The marker below says
  // what is wrong with it.
  const typeOptions = [...new Set([type, ...validTypesFor(items, unitItems)])];
  const allowed = TASK_ALLOWED_ITEM_KINDS[type];
  const label = exerciseLabel(type, items);
  return (
    <li className="card">
      <strong>{label}</strong>
      <EntityPicker
        label="Items"
        options={unitItems
          .filter((item) => allowed.includes(item.kind))
          .map((item) => ({ id: item.id, title: itemLabel(item) }))}
        selected={itemIds}
        onChange={(ids) => edit.patchTask({ ...raw, itemIds: ids })}
        multiple
        ordered
        // Taking a word out of an exercise leaves the word alone — the
        // picker's default "Delete" would say otherwise.
        removeLabel={() => "Remove"}
      />
      <ProblemMarker problems={edit.problemsFor(taskId)} />
      <RowActions
        onSettings={() => setSettingsOpen(true)}
        settingsLabel="Exercise settings"
        {...(onDelete !== undefined ? { onRemove: () => onDelete(label) } : {})}
      />
      {settingsOpen && (
        <SettingsSheet
          title={rowSheetTitle(label, "New exercise")}
          onDismiss={() => setSettingsOpen(false)}
        >
          <label className="field">
            Type
            <select
              value={type}
              onChange={(e) => edit.patchTask({ ...raw, type: e.target.value })}
            >
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {exerciseTypeLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Instructions
            <textarea
              rows={2}
              value={
                typeof raw.instructions === "string" ? raw.instructions : ""
              }
              onChange={(e) =>
                // Optional, so an emptied box **deletes** the key rather
                // than leaving `""` behind (same rule as every other
                // optional field).
                edit.patchTask(
                  withOptionalKey(raw, "instructions", e.target.value),
                )
              }
            />
          </label>
        </SettingsSheet>
      )}
    </li>
  );
}

/** One row of the `+ add an exercise` list (§1a): a tap that builds a valid
 * exercise, or a greyed line saying why it cannot. */
function OfferRow({
  offer,
  itemById,
  onAdd,
}: {
  offer: ExerciseOffer;
  itemById: Map<string, Item>;
  onAdd: () => void;
}) {
  if (offer.reason !== null) {
    return (
      <li className="status">
        {exerciseTypeLabel(offer.type)} — {offer.reason}
      </li>
    );
  }
  const items = offer.itemIds.flatMap((id) => {
    const item = itemById.get(id);
    return item !== undefined ? [item] : [];
  });
  return (
    <li>
      <button type="button" className="editor-add" onClick={onAdd}>
        + {exerciseLabel(offer.type, items)}
      </button>
    </li>
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
  startAtPage,
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
  /** Opens on a named page: how a publish error lands on the row that caused
   * it rather than on the unit's Overview (spec 0021-10 §3). Ignored when the
   * page isn't in this trail. */
  startAtPage?: string;
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
  const session = useEditSession();
  const edit = unitEditOps(session, unitId);
  // Diff renders the union read-only with per-element tints (spec 0021-9
  // §3); Preview plays the draft for real, so it keeps the Practice bar.
  const diff = diffView(session);
  // Which row's `⚙` sheet is open (spec 0021-13 §2 — transliteration and
  // `RowExtras` both live there now, not in an inline expansion), across
  // Vocabulary, Concepts and Examples alike. One id serves every page: only
  // one row's controls can be open at a time regardless of which page it's
  // on. Deliberately not reset when `unitId` changes — `App.tsx` reuses this
  // instance across units (see the keyboard effect below), and an id from
  // the previous unit simply matches no row here, so the only effect is that
  // coming back re-opens the row you left open.
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  // Undo toast (spec 0021-13 §4): one snapshot for every `−` on Vocabulary,
  // Concepts and Examples — Exercises keeps its own confirm-then-delete
  // sheet instead (see `removeWithUndo`'s doc comment) — never a stack, same
  // as slice 12's note-table undo.
  const { message: undoMessage, capture, undo } = useUndoSnapshot();
  /** `bookNoun` names the Book-owned case ("Concept" here, "Example" on the
   * Examples page) — the lexicon case is always "Word" and always unlinks,
   * regardless of page or item kind, which is the distinction slice 6 §2d
   * exists to protect: do not merge the two.
   *
   * Exercises does **not** route through this: `UnitScreen.exercises.test.
   * tsx` pins a confirm-then-delete flow for a task ("deletes an exercise
   * behind a confirm that names it") that predates this slice and is a
   * behavioural assertion, not a stale locator — spec 0021-13 §6 says stop
   * rather than change one of those. It is also the wrong shape for this
   * helper regardless: `isBookItem` only knows `items`, so a `taskId` would
   * always take the `else` branch and read "Word deleted" for an exercise. */
  function removeWithUndo(ops: UnitEditOps, id: string, bookNoun: string) {
    const bookBefore = session?.book;
    if (bookBefore === undefined) {
      return;
    }
    if (ops.isBookItem(id)) {
      capture(bookNoun, () => session?.changeBook(bookBefore), "deleted");
    } else {
      capture("Word", () => session?.changeBook(bookBefore), "unlinked");
    }
    ops.removeRow(id);
  }
  // Exercises page (spec 0021-8 §1): whether the offer list is open, and
  // which exercise is awaiting a delete confirmation.
  const [showOffers, setShowOffers] = useState(false);
  const [pendingTask, setPendingTask] = useState<{
    id: string;
    label: string;
  } | null>(null);

  // Trail page index, plus each section's own sub-pager index (plan 0010
  // design section 4: no shared pagination abstraction — one useState each).
  // `startAtEnd` seeds an out-of-range sentinel rather than a real index:
  // which pages exist isn't known until `pages` is built further down, and
  // everything below reads the clamped `pageIndex` anyway.
  const [page, setPage] = useState(startAtEnd ? Number.MAX_SAFE_INTEGER : 0);
  // Seeded once from `startAtPage`, then owned by the trail: `pages` isn't
  // built yet here, so the index is resolved in an effect below rather than
  // guessed.
  const startedAtPageRef = useRef(startAtPage);
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
  // The row whose `⚙` opened a sheet (spec 0021-13 §2), or `undefined` on
  // every other render — including every render of every other page, which
  // is why this is looked up rather than stored as its own boolean.
  const openLexeme = lexemes.find((item) => item.id === expandedRow);
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
    // `diff !== null` too: a unit whose only change is a deleted note has
    // no draft notes at all, and without the dot the deletion is unreachable.
    ...(notes.length > 0 || edit !== null || diff !== null
      ? (["theory"] as const)
      : []),
    ...(lexemes.length > 0 || edit !== null ? (["vocabulary"] as const) : []),
    ...(concepts.length > 0 || edit !== null ? (["concepts"] as const) : []),
    ...(examples.length > 0 || edit !== null ? (["examples"] as const) : []),
    ...(edit !== null || diff !== null ? (["exercises"] as const) : []),
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
    const target = startedAtPageRef.current;
    startedAtPageRef.current = undefined;
    if (target === undefined) {
      return;
    }
    const index = pages.indexOf(target as PageKind);
    if (index !== -1) {
      setPage(index);
    }
    // Once, on the render that mounted with a target — a later navigation
    // inside the trail must not be yanked back.
  }, [pages.length]);

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
  // Same lookup as `openLexeme`, scoped to the current page's chunk: a row
  // on a chunk the author has paginated away from was never shown expanded
  // before this slice either.
  const openConcept = conceptRows.find((item) => item.id === expandedRow);

  const exampleChunks = chunk(examples, EXAMPLE_CHUNK_SIZE);
  const exampleCards =
    exampleChunks[Math.min(examplePage, exampleChunks.length - 1)] ?? [];
  // Same lookup as `openConcept`, scoped to the current page's chunk.
  const openExample = exampleCards.find((item) => item.id === expandedRow);

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
              // Exercises is marked out from the content pages (spec 0021-8
              // §3): it is edit-only, and a dot identical to its neighbours
              // would read as one more thing the learner will see.
              className={`dot${pageKind === "exercises" ? " exercises" : ""}${
                index === pageIndex ? " active" : ""
              }`}
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
            {/* Old above new only when *these two* changed — a unit whose
                `itemIds` changed shows its title and goal once (§3). */}
            {(() => {
              const shown = { title: unit.title, goal: unit.goal };
              const was = diff?.changedFrom<typeof shown>(unit.id, shown);
              return (
                <>
                  {was !== undefined && (
                    <div className="diff-old">
                      <h1>{was.title ?? ""}</h1>
                      <p>{was.goal ?? ""}</p>
                    </div>
                  )}
                  <div className={diff?.className(unit.id, shown)}>
                    <h1>{unit.title}</h1>
                    <p>{unit.goal}</p>
                  </div>
                </>
              );
            })()}
            {/* Reporting a problem in your own draft is a loop. */}
            {session === null && (
              <FeedbackWidget
                docId={`topic:${content.topic.id}`}
                contentKind="unit"
                contentId={unit.id}
              />
            )}
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
                edit.patchUnit(
                  withOptionalKey(edit.rawUnit, "unlocksAfterUnitId", ids[0]),
                )
              }
              multiple={false}
              groupBy
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
          {diff !== null &&
            notes.map((note) => (
              <div
                key={note.noteId}
                className={
                  // A *changed* note is diffed by block inside `NoteDiff`
                  // (§2a), so tinting the wrapper too would paint the whole
                  // note the colour of its one edited paragraph. An added or
                  // removed note has no blocks to distinguish and keeps it.
                  diff.status(note.stem) === "changed"
                    ? undefined
                    : (diff.className(note.stem) ?? undefined)
                }
              >
                <NoteDiff
                  before={text(
                    (
                      diff.changedFrom<{ markdown?: unknown }>(note.stem) ??
                      // A note the draft removed is in the union as its base
                      // copy, so its "before" is the text on screen.
                      (diff.status(note.stem) === "removed"
                        ? { markdown: note.markdown }
                        : {})
                    ).markdown,
                  )}
                  after={note.markdown}
                  lookup={lookup}
                  bookId={content.topic.id}
                />
              </div>
            ))}
          {diff === null &&
            notes.map((note) => (
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
                inSession={session !== null}
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
          {edit !== null &&
            !edit.canEditLexicon &&
            (lexemes.length === 0 ||
              lexemes.some((item) => edit.isLexiconEntry(item.id))) && (
              <p className="status">{SHARED_LEXICON_NOTE}</p>
            )}
          {/* Propose mode's gap, stated rather than a silent empty table
              (spec 0021-13 §5): a book-owned lexeme item is schema-legal
              (validate.ts class (x)), just unreachable from this UI today —
              so this keys off `lexemes` itself, not the domain's shared
              `entryKind`, the same row-based test the note above and the
              Concepts page both use. Zero rows plus a read-only lexicon
              means there is nothing this mode can show, not nothing there
              is to show. */}
          {edit !== null &&
          !edit.canEditLexicon &&
          lexemes.length === 0 ? null : (
            <table className="vocab-table unit-row-table">
              <thead>
                <tr>
                  <th>Script</th>
                  <th>Gloss</th>
                  {lexemesHaveAudio ? <th>Audio</th> : null}
                  {edit !== null ? <th className="unit-row-actions" /> : null}
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
                          <td className="unit-row-actions">
                            {/* Shown even on a row whose fields are read-only:
                              all three write `unit.itemIds`, which the Book
                              owns, never the lexicon. Reordering and
                              unlinking a borrowed word are the author's to
                              do; changing the word itself is not. */}
                            <RowActions
                              onUp={() => edit.moveRow(item.id, -1)}
                              onDown={() => edit.moveRow(item.id, 1)}
                              onRemove={() =>
                                removeWithUndo(edit, item.id, "Word")
                              }
                              removeLabel={edit.removeLabel(item.id)}
                              {...(editable
                                ? {
                                    onSettings: () => setExpandedRow(item.id),
                                    settingsLabel: "Word settings",
                                  }
                                : {})}
                            />
                            <ProblemMarker
                              problems={edit.entityProblems(item.id)}
                            />
                          </td>
                        ) : null}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {edit !== null &&
            edit.entryKind === "lexeme" &&
            edit.canEditLexicon && (
              <button
                type="button"
                className="editor-add"
                onClick={edit.addEntry}
              >
                + word
              </button>
            )}
          {edit !== null && openLexeme !== undefined && (
            <SettingsSheet
              title={rowSheetTitle(openLexeme.payload.script, "New word")}
              onDismiss={() => setExpandedRow(null)}
            >
              <label className="field">
                Transliteration
                <input
                  type="text"
                  value={edit.payloadValue(openLexeme.id, "transliteration")}
                  onChange={(e) =>
                    edit.patchEntity(
                      withPayload(
                        edit.raw(openLexeme.id) ?? { id: openLexeme.id },
                        ["transliteration"],
                        e.target.value,
                      ),
                    )
                  }
                />
              </label>
              <ProblemMarker
                problems={edit.fieldProblems(
                  openLexeme.id,
                  "payload.transliteration",
                )}
              />
              <RowExtras item={openLexeme} edit={edit} />
            </SettingsSheet>
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
          {edit !== null &&
            !edit.canEditLexicon &&
            conceptRows.some((item) => edit.isLexiconEntry(item.id)) && (
              <p className="status">{SHARED_LEXICON_NOTE}</p>
            )}
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
          <table className="vocab-table unit-row-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Definition</th>
                {edit !== null ? <th className="unit-row-actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {/* No per-row FeedbackWidget here (owner request): a third
                  column of thumbs crowded the table off a phone screen. The
                  unit-level widget on Overview still covers reports. */}
              {conceptRows.map((item) => {
                const editable = edit !== null && edit.canEditRow(item.id);
                // These two columns only: a concept whose `sourceRef` or an
                // unrendered payload field changed is not a pair (§3).
                const shownConcept = {
                  payload: {
                    term: (item.payload as { term?: string }).term,
                    definition: (item.payload as { definition?: string })
                      .definition,
                  },
                };
                const was = diff?.changedFrom<{
                  payload?: { term?: string; definition?: string };
                }>(item.id, shownConcept);
                return (
                  <Fragment key={item.id}>
                    {was !== undefined && (
                      <tr className="diff-old">
                        <td>{was.payload?.term}</td>
                        <td>{was.payload?.definition}</td>
                      </tr>
                    )}
                    <tr className={diff?.className(item.id, shownConcept)}>
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
                            <GrowingTextarea
                              ariaLabel="Definition"
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
                        <td className="unit-row-actions">
                          <RowActions
                            onUp={() => edit.moveRow(item.id, -1)}
                            onDown={() => edit.moveRow(item.id, 1)}
                            onRemove={() =>
                              removeWithUndo(edit, item.id, "Concept")
                            }
                            removeLabel={edit.removeLabel(item.id)}
                            {...(editable
                              ? {
                                  onSettings: () => setExpandedRow(item.id),
                                  settingsLabel: "Concept settings",
                                }
                              : {})}
                          />
                          <ProblemMarker
                            problems={edit.entityProblems(item.id)}
                          />
                        </td>
                      ) : null}
                    </tr>
                  </Fragment>
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
          {/* `+ word` lives on whichever page this Book's lexicon actually
              shows up on — a `general` lexicon holds concepts, so its words
              are these rows, not the Vocabulary table's (§2e). Offering it
              on Vocabulary regardless would add a row that vanishes from the
              page you tapped. */}
          {edit !== null &&
            edit.entryKind === "concept" &&
            edit.canEditLexicon && (
              <button
                type="button"
                className="editor-add"
                onClick={edit.addEntry}
              >
                + word
              </button>
            )}
          {edit !== null && openConcept !== undefined && (
            <SettingsSheet
              title={rowSheetTitle(openConcept.payload.term, "New concept")}
              onDismiss={() => setExpandedRow(null)}
            >
              <RowExtras item={openConcept} edit={edit} />
            </SettingsSheet>
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
                {...(edit !== null
                  ? {
                      edit,
                      onRemove: () => removeWithUndo(edit, item.id, "Example"),
                      onSettings: () => setExpandedRow(item.id),
                    }
                  : {})}
                {...(diff !== null ? { diff } : {})}
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
          {edit !== null && openExample !== undefined && (
            <SettingsSheet
              title={rowSheetTitle(
                itemLabel(openExample),
                openExample.kind === "sentence" ? "New sentence" : "New pair",
              )}
              onDismiss={() => setExpandedRow(null)}
            >
              <RowExtras item={openExample} edit={edit} />
            </SettingsSheet>
          )}
        </>
      ) : null}

      {currentPage === "exercises" && diff !== null ? (
        <>
          <p className="eyebrow">Exercises</p>
          {/* Read-only and tinted. An exercise has no screen of its own, so
              this is where What-changed lands a changed one (spec 0021-9
              §4). */}
          <ul className="card-list">
            {unit.taskIds.map((taskId) => {
              const task = content.tasks.find((t) => t.id === taskId);
              const items = (task?.itemIds ?? []).flatMap((id) => {
                const item = itemById.get(id);
                return item !== undefined ? [item] : [];
              });
              return (
                <li
                  key={taskId}
                  className={`card ${diff.className(taskId) ?? ""}`}
                >
                  <strong>
                    {task === undefined
                      ? "an exercise that no longer exists"
                      : exerciseLabel(task.type, items)}
                  </strong>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {currentPage === "exercises" && edit !== null ? (
        <>
          <p className="eyebrow">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/beaver_pencil.png`}
              alt=""
            />{" "}
            Exercises
          </p>
          <ul className="card-list">
            {edit.taskIds.map((taskId) => (
              <ExerciseCard
                key={taskId}
                taskId={taskId}
                edit={edit}
                itemById={itemById}
                unitItems={items}
                onDelete={(label) => setPendingTask({ id: taskId, label })}
              />
            ))}
          </ul>
          {/* Unit-level problems land on Overview, but "unit has zero tasks"
              is only actionable here, so it is repeated beside the list it
              is about. */}
          <ProblemMarker problems={edit.entityProblems(unit.id)} />
          <button
            type="button"
            className="editor-add"
            onClick={() => setShowOffers((open) => !open)}
          >
            + add an exercise
          </button>
          {showOffers && (
            <ul className="editor-list exercise-offers">
              {/* Nothing here can produce a publish error (§1a): each row is
                  pre-filled with the items its type accepts, and a type this
                  unit cannot support is greyed with the reason rather than
                  hidden — hiding it would leave the author guessing why
                  Listen never appears. */}
              {exerciseOffers(unit.itemIds, itemById).map((offer, index) => (
                <OfferRow
                  key={`${offer.type}-${offer.kind ?? index}`}
                  offer={offer}
                  itemById={itemById}
                  onAdd={() => {
                    edit.addTask(offer.type, offer.itemIds);
                    setShowOffers(false);
                  }}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      {pendingTask !== null && (
        <ConfirmSheet
          icon="lock_key"
          title="Delete this exercise?"
          body={`“${pendingTask.label}” will be removed from this unit.`}
          cancelLabel="Keep it"
          confirmLabel="Delete"
          onCancel={() => setPendingTask(null)}
          onConfirm={() => {
            setPendingTask(null);
            edit?.removeTask(pendingTask.id);
          }}
        />
      )}

      {/* One bar, two jobs (owner request): it walks the trail forward until
          the last content page, where it becomes the Practice launcher —
          `goNext` already treats "past the end" as Practice.
          Hidden in edit mode (spec 0021-6 §1): practising a draft is what
          Preview is for (slice 9), and a Practice button that starts a
          session over half-typed content is a trap. */}
      {(session === null || session.view === "preview") && (
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
      {undoMessage !== null && (
        <UndoToast message={undoMessage} onUndo={undo} />
      )}
    </main>
  );
}
