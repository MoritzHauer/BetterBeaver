import type {
  Book,
  Lesson,
  Unit,
  Item,
  Task,
  Resource,
  Domain,
  Family,
  DomainKind,
  TaskType,
  LinkType,
  Content,
  ParsedSet,
  BookDocument,
  DomainDocument,
} from "@betterbeaver/schema";
import { noteImageStems } from "./noteBlocks.js";
import type { AssetStems } from "./documentSource.js";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
/** Exported for `documentProblems.ts`, which walks the same untrusted
 * document and needs the identical guards — a second copy would drift. */
export const obj = (v: unknown) =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
/** The document's list fields are typed as arrays but arrive from
 * `JSON.parse(localStorage)` and backend rows, where they can be missing or
 * any other type — see `documentSource.ts`'s `bookDocumentShapeError`, which
 * guards the boot path for exactly this reason but does not cover the
 * editor's working document. */
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type LexemePayload = Extract<Item, { kind: "lexeme" }>["payload"];
type ConceptPayload = Extract<Item, { kind: "concept" }>["payload"];
type SentencePayload = Extract<Item, { kind: "sentence" }>["payload"];
type PairPayload = Extract<Item, { kind: "pair" }>["payload"];

/** The `components` breakdown, identical on both lexicon payloads (plan 0023
 * §4) — a second copy would drift. */
function draftComponents(
  raw: unknown[],
): NonNullable<LexemePayload["components"]> {
  return raw.map((c) => {
    const entryId = obj(c).entryId;
    return {
      text: str(obj(c).text),
      gloss: str(obj(c).gloss),
      ...(typeof entryId === "string" && entryId !== "" ? { entryId } : {}),
    };
  });
}

function draftLexemePayload(p: Record<string, unknown>): LexemePayload {
  return {
    script: str(p.script),
    transliteration: str(p.transliteration),
    gloss: str(p.gloss),
    ...(typeof p.example === "object" && p.example !== null
      ? {
          example: {
            text: str(obj(p.example).text),
            translation: str(obj(p.example).translation),
          },
        }
      : {}),
    ...(typeof p.usageNote === "string" && p.usageNote !== ""
      ? { usageNote: p.usageNote }
      : {}),
    ...(typeof p.audioRef === "string" && p.audioRef !== ""
      ? { audioRef: p.audioRef }
      : {}),
    ...(typeof p.imageRef === "string" && p.imageRef !== ""
      ? { imageRef: p.imageRef }
      : {}),
    ...(Array.isArray(p.links)
      ? {
          links: p.links.map((l) => ({
            type: str(obj(l).type) as LinkType,
            entryId: str(obj(l).entryId),
          })),
        }
      : {}),
    ...(Array.isArray(p.components)
      ? { components: draftComponents(p.components) }
      : {}),
    // An unrecognised `bound` string is dropped like every other malformed
    // value here, rather than cast across as a lie the editor then renders.
    ...(p.bound === "prefix" || p.bound === "suffix" ? { bound: p.bound } : {}),
    ...(Array.isArray(p.variants)
      ? { variants: p.variants.map((v) => str(v)) }
      : {}),
  };
}

function draftConceptPayload(p: Record<string, unknown>): ConceptPayload {
  return {
    term: str(p.term),
    definition: str(p.definition),
    ...(typeof p.example === "string" && p.example !== ""
      ? { example: p.example }
      : {}),
    ...(typeof p.audioRef === "string" && p.audioRef !== ""
      ? { audioRef: p.audioRef }
      : {}),
    ...(typeof p.imageRef === "string" && p.imageRef !== ""
      ? { imageRef: p.imageRef }
      : {}),
    ...(Array.isArray(p.links)
      ? {
          links: p.links.map((l) => ({
            type: str(obj(l).type) as LinkType,
            entryId: str(obj(l).entryId),
          })),
        }
      : {}),
    ...(Array.isArray(p.components)
      ? { components: draftComponents(p.components) }
      : {}),
  };
}

function draftSentencePayload(p: Record<string, unknown>): SentencePayload {
  return {
    text: str(p.text),
    translation: str(p.translation),
    ...(typeof p.audioRef === "string" && p.audioRef !== ""
      ? { audioRef: p.audioRef }
      : {}),
  };
}

function draftPairPayload(p: Record<string, unknown>): PairPayload {
  const a = obj(p.a);
  const b = obj(p.b);
  return {
    a: { script: str(a.script), audioRef: str(a.audioRef) },
    b: { script: str(b.script), audioRef: str(b.audioRef) },
    contrast: str(p.contrast),
  };
}

/**
 * Coerces one raw item entity into a renderable `Item`. Switches on
 * `str(e.kind)`; an unknown or missing kind defaults to `sentence` (spec
 * 0021-4 §2b) so a freshly created or malformed row still renders instead
 * of vanishing — see the module doc comment on `draftContent` for why that
 * matters. Optional payload fields are spread in only when meaningfully
 * present (non-empty string / present object / array), never coerced to a
 * value the schema would reject (`slugSchema` rejects `""`).
 */
function draftItem(raw: unknown): Item {
  const e = obj(raw);
  const id = str(e.id);
  const sourceRef = str(e.sourceRef);
  const payload = obj(e.payload);
  switch (str(e.kind)) {
    case "lexeme":
      return {
        id,
        kind: "lexeme",
        sourceRef,
        payload: draftLexemePayload(payload),
      };
    case "concept":
      return {
        id,
        kind: "concept",
        sourceRef,
        payload: draftConceptPayload(payload),
      };
    case "pair":
      return {
        id,
        kind: "pair",
        sourceRef,
        payload: draftPairPayload(payload),
      };
    default:
      return {
        id,
        kind: "sentence",
        sourceRef,
        payload: draftSentencePayload(payload),
      };
  }
}

function draftLesson(raw: unknown): Lesson {
  const e = obj(raw);
  return {
    id: str(e.id),
    topicId: str(e.topicId),
    title: str(e.title),
    goal: str(e.goal),
    unitIds: ids(e.unitIds),
    ...(typeof e.unlocksAfterLessonId === "string" &&
    e.unlocksAfterLessonId !== ""
      ? { unlocksAfterLessonId: e.unlocksAfterLessonId }
      : {}),
  };
}

function draftUnit(raw: unknown): Unit {
  const e = obj(raw);
  return {
    id: str(e.id),
    lessonId: str(e.lessonId),
    title: str(e.title),
    goal: str(e.goal),
    itemIds: ids(e.itemIds),
    taskIds: ids(e.taskIds),
    noteIds: ids(e.noteIds),
    ...(typeof e.unlocksAfterUnitId === "string" && e.unlocksAfterUnitId !== ""
      ? { unlocksAfterUnitId: e.unlocksAfterUnitId }
      : {}),
    ...(Array.isArray(e.recallUnitIds)
      ? { recallUnitIds: ids(e.recallUnitIds) }
      : {}),
  };
}

function draftTask(raw: unknown): Task {
  const e = obj(raw);
  return {
    id: str(e.id),
    type: str(e.type) as TaskType,
    itemIds: ids(e.itemIds),
    ...(typeof e.instructions === "string" && e.instructions !== ""
      ? { instructions: e.instructions }
      : {}),
  };
}

function draftResource(raw: unknown): Resource {
  const e = obj(raw);
  return { id: str(e.id), title: str(e.title), path: str(e.path) };
}

function draftFamily(raw: unknown): Family {
  const e = obj(raw);
  return { id: str(e.id), name: str(e.name), entryIds: ids(e.entryIds) };
}

function draftBook(raw: unknown): Book {
  const e = obj(raw);
  return {
    id: str(e.id),
    code: str(e.code),
    title: str(e.title),
    description: str(e.description),
    lessonIds: ids(e.lessonIds),
    domainId: str(e.domainId),
    // Both optional, and both are edited in place (plan 0021 §1a) — dropping
    // them here left their controls showing "(none)" and unchecked no matter
    // what the author picked, since edit mode renders *this* Book, not the
    // stored one. Kept absent rather than coerced, the way the document
    // stores them: `icon` is a `z.enum(...).optional()`, so "" is not a
    // member, and `hasCoverArt: false` is written as no key at all.
    ...(typeof e.icon === "string" && e.icon !== ""
      ? { icon: e.icon as Book["icon"] }
      : {}),
    ...(e.hasCoverArt === true ? { hasCoverArt: true } : {}),
  };
}

function draftDomain(raw: unknown): Domain {
  const e = obj(raw);
  return {
    id: str(e.id),
    code: str(e.code),
    kind: str(e.kind) as DomainKind,
    title: str(e.title),
    glossLanguage: str(e.glossLanguage),
    ...(typeof e.readAloudLang === "string" && e.readAloudLang !== ""
      ? { readAloudLang: e.readAloudLang }
      : {}),
  };
}

/**
 * Builds a renderable `Content`/`ParsedSet` pair straight from a mid-edit
 * `BookDocument`/`DomainDocument`, without ever running zod (spec 0021-4
 * §2). It **constructs**; it never parses, never validates, and cannot
 * throw, for any input.
 *
 * Why not a lenient `validateContent`: dropping an invalid entity makes the
 * row the author is typing into vanish mid-keystroke. A freshly created
 * item (`{ id, kind, payload: {}, sourceRef: "" }`, the shape every add
 * control creates) fails every field the real validator checks;
 * `draftContent`
 * turns that into `{ text: "", translation: "" }` — an empty, focusable
 * input — instead of a validation error with nothing to render.
 *
 * Returns two shapes on purpose: `parsed` is `ParsedSet` (book-owned items
 * only, ready for `checkReferences`), `content` is the merged `Content` a
 * screen renders (book items plus the domain entries this book's units
 * actually reference — see `validate.ts`'s `Content.items` merge, which
 * this replicates so the Vocabulary page isn't empty in edit mode).
 */
export function draftContent(
  book: BookDocument,
  domain: DomainDocument,
  assets: AssetStems,
): { content: Content; parsed: ParsedSet } {
  // Every read goes through `obj`/`arr`: the parameters are *typed* as
  // documents but arrive as `JSON.parse(localStorage)` or a backend row cast
  // straight across, so a truncated or stale-schema draft reaches here with
  // fields missing or of the wrong type. This function's contract is that it
  // cannot throw for any input (§2), and the editor has no shape guard on
  // this path — an unguarded `.map` here is a white screen.
  const b = obj(book);
  const d = obj(domain);
  const draftedBook = draftBook(b.topic);
  const draftedDomain = draftDomain(d.domain);
  const lessons = arr(b.lessons).map(draftLesson);
  const units = arr(b.units).map(draftUnit);
  const items = arr(b.items).map(draftItem);
  const tasks = arr(b.tasks).map(draftTask);
  const resources = arr(b.resources).map(draftResource);
  // Derived note ids, same rule as `validateContent` (§2d): the note's
  // markdown itself is not part of Content; slice 6 threads it separately.
  // Each note goes through `obj` before its fields are read — a `null` entry
  // in the list would otherwise throw, and `noteImageStems` expects a real
  // string.
  const notes = arr(b.notes).map((note) => {
    const stem = str(obj(note).stem);
    return { id: `${draftedBook.code}-note-${stem}`, stem };
  });
  const entries = arr(d.entries).map(draftItem);
  const families = arr(d.families).map(draftFamily);
  const noteImageRefs = arr(b.notes).flatMap((note) =>
    noteImageStems(str(obj(note).markdown)).map((stem) => ({
      noteStem: str(obj(note).stem),
      stem,
    })),
  );

  const parsed: ParsedSet = {
    book: draftedBook,
    lessons,
    units,
    items,
    tasks,
    resources,
    notes,
    domain: draftedDomain,
    entries,
    families,
    audioStems: assets.audioByBook.get(draftedBook.id) ?? [],
    imageStems: assets.imageByBook.get(draftedBook.id) ?? [],
    lexiconAudioStems: assets.audioByDomain.get(draftedDomain.id) ?? [],
    lexiconImageStems: assets.imageByDomain.get(draftedDomain.id) ?? [],
    noteImageRefs,
  };

  // §2c: Content.items is book items plus the domain entries this book's
  // units actually reference (replicates validate.ts's pinned Content.items
  // merge) — skip it and the Vocabulary page is empty in edit mode.
  const unitItemIdUnion = new Set(units.flatMap((u) => u.itemIds));
  const referencedEntries = entries.filter((entry) =>
    unitItemIdUnion.has(entry.id),
  );

  const content: Content = {
    topic: draftedBook,
    lessons,
    units,
    items: [...items, ...referencedEntries],
    tasks,
    resources,
    notes,
  };

  return { content, parsed };
}
