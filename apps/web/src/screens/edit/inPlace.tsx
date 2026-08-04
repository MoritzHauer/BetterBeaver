import type { Item, ItemKind } from "@betterbeaver/schema";
import { DOMAIN_ENTRY_KIND, domainSchema } from "@betterbeaver/schema";
import type { Problem } from "@betterbeaver/engine";
import {
  moveId,
  removeEntity,
  removeNote,
  setNote,
  upsertDomainEntry,
  upsertEntity,
} from "@betterbeaver/engine";
import { newEntityId } from "../../content/entity-ids";
import { newPrivateId } from "../../content/private-ids";
import type { LexiconAccess, NoteAsset } from "../../components/NoteEditor";
import type { EditSessionValue } from "./EditSessionContext";
import { type Entity, firstResourceId } from "./types";

/** Shared support for editing the learner screens in place (plan 0021 §3).
 * The mutations live here, not in the screens: every one of them has to pick
 * the right document and go through `documentEdit`'s ops, and none of that
 * is presentation. Slice 7 extends this for Book and Lesson. */

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * A quiet marker, never an error dialog (spec 0021-6 §3). No `aria-invalid`:
 * a field the author is still filling in is not invalid, it is unfinished,
 * and announcing it as an error on every keystroke would be worse than
 * saying nothing.
 */
export function ProblemMarker({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) {
    return null;
  }
  return (
    <span className="problem-marker">
      <span aria-hidden="true">⚠</span>{" "}
      {problems.map((problem) => problem.message).join(" · ")}
    </span>
  );
}

/** The two marker lookups every in-place screen needs (§3): field-level
 * problems carry a dotted `path`, entity-level ones carry none. */
interface ProblemViews {
  fieldProblems: (id: string, path: string) => Problem[];
  entityProblems: (id: string) => Problem[];
}

function problemViews(session: EditSessionValue): ProblemViews {
  const of = (id: string) => session.problemsByEntity.get(id) ?? [];
  return {
    fieldProblems: (id, path) => of(id).filter((p) => p.path === path),
    entityProblems: (id) => of(id).filter((p) => p.path === undefined),
  };
}

export interface UnitEditOps extends ProblemViews {
  /** The unit as it is stored, not as `draftContent` coerced it — every
   * write starts from this so nothing the adapter dropped is lost. */
  rawUnit: Entity;
  /** Whether this id is a Book-owned item (vs a lexicon entry the unit
   * merely references, vs neither). */
  isBookItem: (id: string) => boolean;
  isLexiconEntry: (id: string) => boolean;
  /** Editable at all: a lexicon row is read-only when the Book points at a
   * lexicon this user does not maintain (slice 5 §4), and an id in neither
   * document has nothing to write to. */
  canEditRow: (id: string) => boolean;
  raw: (id: string) => Entity | undefined;
  /** A stored payload field, read off the raw entity rather than the
   * coerced one, so an input shows exactly what will be written back. */
  payloadValue: (id: string, ...path: string[]) => string;
  problemsFor: (id: string) => Problem[];
  patchUnit: (next: Entity) => void;
  /** Writes one item/entry back to whichever document owns it. */
  patchEntity: (next: Entity) => void;
  /** Delete (Book-owned) or unlink (lexicon entry) — never the other way
   * round, or taking a word out of one unit deletes it from every Book that
   * shares the lexicon. */
  removeRow: (id: string) => void;
  removeLabel: (id: string) => string;
  moveRow: (id: string, delta: -1 | 1) => void;
  /** Creates an empty **Book-owned** item of `kind` and appends it to
   * `unit.itemIds`. Empty on purpose (§2e): the new row carries problem
   * markers straight away, which is the design, not a bug to pre-empt. */
  addItem: (kind: ItemKind) => void;
  /** Creates an empty **lexicon entry**, of whichever kind this domain
   * holds, and references it from the unit. Two controls rather than one
   * smart one (§2e): Concepts and Examples always create Book items, and a
   * new word always belongs to the lexicon. */
  addEntry: () => void;
  addNote: () => void;
  setNoteMarkdown: (stem: string, markdown: string) => void;
  removeNoteByStem: (stem: string) => void;
  /** The `Аү` sheet's dependencies (spec 0021-3), or undefined when this
   * Book's lexicon could not be parsed. */
  lexicon: LexiconAccess | undefined;
  /** Which kind a new lexicon entry has to be — `validate.ts` enforces that
   * it matches the domain's own kind (lexeme for a language domain, concept
   * for a general one). `undefined` when the lexicon could not be parsed, so
   * no page offers `+ word` at all. */
  entryKind: ItemKind | undefined;
  /** False when the Book points at a lexicon this user does not maintain
   * (slice 5 §4): its rows render read-only and no add control is offered. */
  canEditLexicon: boolean;
  /** For a note's `+ image` picker; images only, since a figure's stem
   * validates against `imageStemSet` (spec 0021-2 §2d). */
  imageAssets: NoteAsset[];
  uploadAsset: ((file: File) => Promise<void>) | undefined;
}

/**
 * Everything the Unit screen needs to edit itself, or `null` in learner
 * mode. Not a hook: it runs during render off the session value and holds
 * no state of its own.
 */
export function unitEditOps(
  session: EditSessionValue | null,
  unitId: string,
): UnitEditOps | null {
  if (session === null) {
    return null;
  }
  const book = session.book;
  const domain = session.domain;
  const rawUnit = (book.units as Entity[]).find((u) => u.id === unitId) ?? {
    id: unitId,
  };
  const bookItems = book.items as Entity[];
  const entries = domain.entries as Entity[];
  const bookItemIds = new Set(bookItems.map((i) => i.id));
  const entryIds = new Set(entries.map((e) => e.id));
  const bookCode =
    typeof (book.topic as Entity).code === "string"
      ? ((book.topic as Entity).code as string)
      : "";
  const parsedDomain = domainSchema.safeParse(domain.domain);
  const domainEntity = parsedDomain.success ? parsedDomain.data : undefined;

  const isBookItem = (id: string) => bookItemIds.has(id);
  const isLexiconEntry = (id: string) => entryIds.has(id);

  const patchUnit = (next: Entity) =>
    session.changeBook(upsertEntity(book, "units", next));

  const setItemIds = (ids: string[]) => patchUnit({ ...rawUnit, itemIds: ids });

  return {
    rawUnit,
    isBookItem,
    isLexiconEntry,
    canEditRow: (id) =>
      isBookItem(id) || (isLexiconEntry(id) && session.canEditLexicon),
    raw: (id) =>
      bookItems.find((i) => i.id === id) ?? entries.find((e) => e.id === id),
    payloadValue: (id, ...path) => {
      const entity =
        bookItems.find((i) => i.id === id) ?? entries.find((e) => e.id === id);
      let current: unknown = obj(entity?.payload);
      for (const key of path) {
        current = obj(current)[key];
      }
      return typeof current === "string" ? current : "";
    },
    problemsFor: (id) => session.problemsByEntity.get(id) ?? [],
    ...problemViews(session),
    patchUnit,
    patchEntity: (next) => {
      // An id in neither document is a dangling `itemIds` reference, which
      // is routine mid-edit. Writing it anywhere would silently *create* the
      // entity in whichever document guessed first, so do nothing — the row
      // renders read-only and the reference checker already names it.
      if (isBookItem(next.id)) {
        session.changeBook(upsertEntity(book, "items", next));
      } else if (isLexiconEntry(next.id) && session.canEditLexicon) {
        session.changeDomain(upsertDomainEntry(domain, next));
      }
    },
    removeRow: (id) => {
      if (isBookItem(id)) {
        // `removeEntity` strips every reference across the document too —
        // removing it from `itemIds` by hand would orphan the entity.
        session.changeBook(removeEntity(book, "items", id));
        return;
      }
      setItemIds(list(rawUnit.itemIds).filter((x) => x !== id));
    },
    removeLabel: (id) => (isBookItem(id) ? "Delete" : "Unlink"),
    moveRow: (id, delta) =>
      setItemIds(moveId(list(rawUnit.itemIds), id, delta)),
    addItem: (kind) => {
      // One `changeBook`, not two: the second would start from the stale
      // `book` this closure captured and drop the item the first just added.
      const id = newEntityId(bookCode);
      const withItem = upsertEntity(book, "items", {
        id,
        kind,
        sourceRef: firstResourceId(book),
        payload: {},
      });
      session.changeBook(
        upsertEntity(withItem, "units", {
          ...rawUnit,
          itemIds: [...list(rawUnit.itemIds), id],
        }),
      );
    },
    addEntry: () => {
      if (domainEntity === undefined || !session.canEditLexicon) {
        return;
      }
      // `validate.ts` requires every entry to match
      // `DOMAIN_ENTRY_KIND[domain.kind]`, so there is no kind to offer.
      const id = newEntityId(domainEntity.code);
      session.changeDomain(
        upsertDomainEntry(domain, {
          id,
          kind: DOMAIN_ENTRY_KIND[domainEntity.kind],
          sourceRef: firstResourceId(book),
          payload: {},
        }),
      );
      // A different document, so this second write is independent — unlike
      // `addItem`, where both halves land in the Book.
      setItemIds([...list(rawUnit.itemIds), id]);
    },
    addNote: () => {
      const stem = newPrivateId();
      // Seed the heading a note is titled by. Without it a brand-new note
      // has no `# ` line, so every list labels it by its stem — a UUID since
      // spec 0018 generated ids.
      const withNote = setNote(book, stem, "# New note\n\n");
      session.changeBook(
        upsertEntity(withNote, "units", {
          ...rawUnit,
          noteIds: [...list(rawUnit.noteIds), `${bookCode}-note-${stem}`],
        }),
      );
    },
    setNoteMarkdown: (stem, markdown) =>
      session.changeBook(setNote(book, stem, markdown)),
    // `removeNote` deletes the note *and* strips its derived id from every
    // unit's `noteIds`.
    removeNoteByStem: (stem) => session.changeBook(removeNote(book, stem)),
    lexicon:
      domainEntity !== undefined
        ? {
            entries,
            domain: domainEntity,
            domainCode: domainEntity.code,
            sourceRef: firstResourceId(book),
            ...(session.canEditLexicon
              ? {
                  onAddEntry: (entry: Item) =>
                    session.changeDomain(upsertDomainEntry(domain, entry)),
                }
              : {}),
          }
        : undefined,
    entryKind:
      domainEntity !== undefined
        ? DOMAIN_ENTRY_KIND[domainEntity.kind]
        : undefined,
    canEditLexicon: session.canEditLexicon,
    imageAssets: session.assets.filter((asset) => asset.kind === "image"),
    uploadAsset: session.uploadAsset,
  };
}

export interface BookEditOps extends ProblemViews {
  /** The Book's own entity (`topic`), as stored. */
  rawBook: Entity;
  /** A private Book can never reach the app's public assets, so it is never
   * offered the cover-art toggle (§1a). */
  isPrivate: boolean;
  patchBook: (next: Entity) => void;
  rawLesson: (id: string) => Entity | undefined;
  patchLesson: (next: Entity) => void;
  moveLesson: (id: string, delta: -1 | 1) => void;
  removeLesson: (id: string) => void;
  addLesson: () => void;
}

/** The Book screen's half of §1, or `null` in learner mode. */
export function bookEditOps(
  session: EditSessionValue | null,
): BookEditOps | null {
  if (session === null) {
    return null;
  }
  const book = session.book;
  const topic = obj(book.topic) as Entity;
  const bookCode = typeof topic.code === "string" ? topic.code : "";
  const lessons = book.lessons as Entity[];
  const patchBook = (next: Entity) =>
    session.changeBook({ ...book, topic: next });

  return {
    rawBook: topic,
    isPrivate: session.mode === "private",
    ...problemViews(session),
    patchBook,
    rawLesson: (id) => lessons.find((l) => l.id === id),
    patchLesson: (next) =>
      session.changeBook(upsertEntity(book, "lessons", next)),
    moveLesson: (id, delta) =>
      patchBook({
        ...topic,
        lessonIds: moveId(list(topic.lessonIds), id, delta),
      }),
    // `removeEntity` strips the id from `topic.lessonIds` and every other
    // reference; doing it by hand would orphan the lesson.
    removeLesson: (id) => session.changeBook(removeEntity(book, "lessons", id)),
    addLesson: () => {
      // One `changeBook`: the entity and the reference land together, or the
      // second write starts from this closure's stale `book`.
      const id = newEntityId(bookCode);
      const withLesson = upsertEntity(book, "lessons", {
        id,
        // A `topicId` that doesn't match its Book is validator class (a).
        topicId: typeof topic.id === "string" ? topic.id : "",
        title: "",
        goal: "",
        unitIds: [],
      });
      session.changeBook({
        ...withLesson,
        topic: { ...topic, lessonIds: [...list(topic.lessonIds), id] },
      });
    },
  };
}

export interface LessonEditOps extends ProblemViews {
  rawLesson: Entity;
  patchLesson: (next: Entity) => void;
  rawUnit: (id: string) => Entity | undefined;
  patchUnit: (next: Entity) => void;
  moveUnit: (id: string, delta: -1 | 1) => void;
  removeUnit: (id: string) => void;
  addUnit: () => void;
}

/** The Lesson screen's half of §2, or `null` in learner mode. */
export function lessonEditOps(
  session: EditSessionValue | null,
  lessonId: string,
): LessonEditOps | null {
  if (session === null) {
    return null;
  }
  const book = session.book;
  const topic = obj(book.topic) as Entity;
  const bookCode = typeof topic.code === "string" ? topic.code : "";
  const rawLesson = (book.lessons as Entity[]).find(
    (l) => l.id === lessonId,
  ) ?? { id: lessonId };
  const patchLesson = (next: Entity) =>
    session.changeBook(upsertEntity(book, "lessons", next));

  return {
    rawLesson,
    ...problemViews(session),
    patchLesson,
    rawUnit: (id) => (book.units as Entity[]).find((u) => u.id === id),
    patchUnit: (next) => session.changeBook(upsertEntity(book, "units", next)),
    moveUnit: (id, delta) =>
      patchLesson({
        ...rawLesson,
        unitIds: moveId(list(rawLesson.unitIds), id, delta),
      }),
    removeUnit: (id) => session.changeBook(removeEntity(book, "units", id)),
    addUnit: () => {
      const id = newEntityId(bookCode);
      const withUnit = upsertEntity(book, "units", {
        id,
        // Must match the owning lesson: a mismatch is validator class (a),
        // and a unit no lesson lists is class (d).
        lessonId,
        title: "",
        goal: "",
        itemIds: [],
        taskIds: [],
        noteIds: [],
      });
      session.changeBook(
        upsertEntity(withUnit, "lessons", {
          ...rawLesson,
          unitIds: [...list(rawLesson.unitIds), id],
        }),
      );
    },
  };
}

/** Immutable set of one `payload` field. An empty value **deletes** the
 * key, the same rule `fields.tsx`'s `setPath` follows, and it is load-bearing
 * twice over: zod's `optional()` expects an absent key rather than `""` (so
 * slice 8's optional refs stay absent), and every payload string is a bare
 * `z.string()` — which accepts `""` — so keeping the key would mean clearing
 * a required field showed *no* problem marker at all. The input stays
 * mounted either way; `payloadValue` reads a missing key as `""`. */
export function withPayload(
  entity: Entity,
  path: [string] | [string, string],
  value: string,
): Entity {
  const payload = obj(entity.payload);
  const set = (into: Record<string, unknown>, key: string) => {
    const next = { ...into };
    if (value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
    return next;
  };
  if (path.length === 1) {
    return { ...entity, payload: set(payload, path[0]) };
  }
  return {
    ...entity,
    payload: { ...payload, [path[0]]: set(obj(payload[path[0]]), path[1]) },
  };
}

/** Sets an optional top-level key, or **deletes** it when the value is
 * empty (`undefined`, `""` or `false`). Deleting is the whole point: zod's
 * `optional()` expects the key absent, and an `undefined` value survives in
 * memory while vanishing across the JSON round-trip to localStorage / the
 * private store, leaving the live document and its persisted copy
 * disagreeing. `BookEditor.tsx:263` records the same trap for
 * `unlocksAfterUnitId`; `icon` and `hasCoverArt` need it too. */
export function withOptionalKey(
  entity: Entity,
  key: string,
  value: string | boolean | undefined,
): Entity {
  const next = { ...entity };
  if (value === undefined || value === "" || value === false) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}
