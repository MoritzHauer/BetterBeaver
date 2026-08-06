import type {
  BookDocument,
  Content,
  DomainDocument,
} from "@betterbeaver/schema";
import { canonicalJson } from "./documentDiff.js";
import { draftContent } from "./draftContent.js";
import type { AssetStems } from "./documentSource.js";
import { type NoteBlock, parseNoteBlocks } from "./noteBlocks.js";

/**
 * What publishing would change, rendered in place (spec 0021-9 §2).
 *
 * `documentDiff.ts` stays exactly as it is and keeps serving
 * `ProposalReview` — this is an additional view of the same facts, not a
 * replacement, and it reuses that module's `canonicalJson` rather than
 * growing a second deep-equal.
 */

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface ContentDiff {
  /** The union — base ∪ draft. **This is the whole trick**: a removed
   * entity is absent from the draft, so rendering the draft alone leaves it
   * nowhere to appear and a deletion is invisible in the diff. */
  content: Content;
  status: Map<string, DiffStatus>;
  /** Base-side entities, for rendering the old row above the new one. Only
   * `changed` and `removed` ids are present. */
  before: Map<string, unknown>;
}

type Entity = { id: string } & Record<string, unknown>;

/** The union content is only ever rendered, never checked, and `Content`
 * carries no stems — they feed `parsed`, which this module discards. */
const NO_STEMS: AssetStems = {
  audioByBook: new Map(),
  imageByBook: new Map(),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const idOf = (entity: unknown): string => {
  const id = (entity as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : "";
};

/**
 * One collection's union, in the order §2 pins: the draft's order, with
 * entities the draft removed re-inserted at their base-side index — so a
 * deleted unit stays where it was rather than collecting at the end.
 *
 * Insertions run in ascending base index, so each one shifts the positions
 * after it; the index is clamped rather than corrected, which puts a run of
 * consecutive deletions in their original order relative to each other and
 * is as close as an order-preserving union gets without move detection.
 */
function unionOf(
  base: unknown[],
  draft: unknown[],
  key: (entity: unknown) => string,
  status: Map<string, DiffStatus>,
  before: Map<string, unknown>,
): unknown[] {
  const baseByKey = new Map(base.map((entity) => [key(entity), entity]));
  const draftKeys = new Set(draft.map(key));
  const out = [...draft];

  for (const entity of draft) {
    const id = key(entity);
    const baseEntity = baseByKey.get(id);
    if (baseEntity === undefined) {
      status.set(id, "added");
      continue;
    }
    if (canonicalJson(baseEntity) === canonicalJson(entity)) {
      status.set(id, "unchanged");
      continue;
    }
    status.set(id, "changed");
    before.set(id, baseEntity);
  }

  base.forEach((entity, index) => {
    const id = key(entity);
    if (draftKeys.has(id)) {
      return;
    }
    status.set(id, "removed");
    before.set(id, entity);
    out.splice(Math.min(index, out.length), 0, entity);
  });

  return out;
}

/**
 * The union of two id *lists*, same order rule as `unionOf`.
 *
 * **Load-bearing, and easy to miss**: every screen renders from the
 * reference arrays, never from the collections — `BookScreen` walks
 * `topic.lessonIds`, `LessonScreen` walks `lesson.unitIds`, `UnitScreen`
 * walks `unit.itemIds`/`taskIds`/`noteIds`. A removed lesson put into
 * `content.lessons` but not into `topic.lessonIds` renders nowhere at all,
 * which is exactly the deletion the union exists to make visible.
 */
function unionIds(base: string[], draft: string[]): string[] {
  const draftSet = new Set(draft);
  const out = [...draft];
  base.forEach((id, index) => {
    if (!draftSet.has(id)) {
      out.splice(Math.min(index, out.length), 0, id);
    }
  });
  return out;
}

const strs = (value: unknown): string[] =>
  arr(value).filter((x): x is string => typeof x === "string");

/** Rebuilds each entity present in *both* documents with its reference
 * arrays unioned. Runs after `unionOf` has classified everything, so
 * widening a list here cannot change any entity's own status. */
function withUnionedRefs(
  list: unknown[],
  base: unknown[],
  draft: unknown[],
  fields: string[],
): unknown[] {
  const baseById = new Map(base.map((e) => [idOf(e), e as Entity]));
  const draftById = new Map(draft.map((e) => [idOf(e), e as Entity]));
  return list.map((entity) => {
    const id = idOf(entity);
    const b = baseById.get(id);
    const d = draftById.get(id);
    if (b === undefined || d === undefined) {
      return entity;
    }
    const next: Entity = { ...(entity as Entity) };
    for (const field of fields) {
      next[field] = unionIds(strs(b[field]), strs(d[field]));
    }
    return next;
  });
}

/** The singletons carry no id of their own; the screens look them up under
 * these names, exactly as `documentProblems` keys their problems. */
function statusOfSingleton(
  name: string,
  base: unknown,
  draft: unknown,
  status: Map<string, DiffStatus>,
  before: Map<string, unknown>,
): void {
  if (canonicalJson(base) === canonicalJson(draft)) {
    status.set(name, "unchanged");
    return;
  }
  status.set(name, "changed");
  before.set(name, base);
}

export function diffContent(
  base: BookDocument,
  draft: BookDocument,
  baseDomain: DomainDocument,
  draftDomain: DomainDocument,
): ContentDiff {
  const status = new Map<string, DiffStatus>();
  const before = new Map<string, unknown>();

  statusOfSingleton("topic", base.topic, draft.topic, status, before);
  statusOfSingleton(
    "domain",
    baseDomain.domain,
    draftDomain.domain,
    status,
    before,
  );

  const union = (
    field: "lessons" | "units" | "items" | "tasks" | "resources",
  ) => unionOf(arr(base[field]), arr(draft[field]), idOf, status, before);

  // Notes are keyed by **stem**, not by the `<code>-note-<stem>` id a screen
  // shows: the id is derived from the Book's `code`, and a renamed Book
  // would then read every note as removed-and-added at once.
  const noteKey = (note: unknown) => {
    const stem = (note as { stem?: unknown } | null)?.stem;
    return typeof stem === "string" ? stem : "";
  };
  const notes = unionOf(
    arr(base.notes),
    arr(draft.notes),
    noteKey,
    status,
    before,
  );

  const unionBook = {
    ...draft,
    topic: {
      ...(draft.topic as Entity),
      lessonIds: unionIds(
        strs((base.topic as Entity | undefined)?.lessonIds),
        strs((draft.topic as Entity | undefined)?.lessonIds),
      ),
    },
    lessons: withUnionedRefs(
      union("lessons"),
      arr(base.lessons),
      arr(draft.lessons),
      ["unitIds"],
    ),
    units: withUnionedRefs(union("units"), arr(base.units), arr(draft.units), [
      "itemIds",
      "taskIds",
      "noteIds",
    ]),
    items: union("items"),
    tasks: withUnionedRefs(union("tasks"), arr(base.tasks), arr(draft.tasks), [
      "itemIds",
    ]),
    resources: union("resources"),
    notes,
  } as BookDocument;

  const unionDomain = {
    ...draftDomain,
    entries: unionOf(
      arr(baseDomain.entries),
      arr(draftDomain.entries),
      idOf,
      status,
      before,
    ),
    families: unionOf(
      arr(baseDomain.families),
      arr(draftDomain.families),
      idOf,
      status,
      before,
    ),
  };

  // `draftContent` is the adapter that cannot fail — which is exactly what a
  // union needs, since base ∪ draft is not a document anybody validated.
  const { content } = draftContent(unionBook, unionDomain, NO_STEMS);
  return { content, status, before };
}

/** Whether anything in `ids` (plus `own`) is not `unchanged` — the one
 * predicate behind every "is there a Diff tab on this screen?" question
 * (§3a). Absent from the map means the entity is in neither document, which
 * is not a change. */
export function anyChanged(
  status: Map<string, DiffStatus>,
  ids: (string | undefined)[],
): boolean {
  return ids.some((id) => {
    const s = id === undefined ? undefined : status.get(id);
    return s !== undefined && s !== "unchanged";
  });
}

export interface NoteBlockDiff {
  block: NoteBlock;
  status: DiffStatus;
}

/**
 * A note diffed **by block** (§2a). `documentDiff` compares whole fields, so
 * a note's entire markdown is one field and a one-word edit reads as "the
 * whole note changed".
 *
 * Deliberately dumb, exactly as §2a specifies: a block whose content appears
 * in both versions is unchanged, otherwise it is added or removed. **No move
 * detection** — a block that only moved reads as removed-and-added, which is
 * the honest thing to show without a matching algorithm nobody asked for.
 *
 * Compares block *content*, never `raw`, so slice 1's trailing-whitespace
 * normalisation never surfaces as a change.
 */
export function diffNoteBlocks(
  baseMarkdown: string,
  draftMarkdown: string,
): NoteBlockDiff[] {
  const contentKey = (block: NoteBlock) => {
    const rest: Record<string, unknown> = { ...block };
    delete rest.raw;
    return canonicalJson(rest);
  };
  const baseBlocks = parseNoteBlocks(baseMarkdown);
  const draftBlocks = parseNoteBlocks(draftMarkdown);
  // Multisets, so a note with two identical paragraphs and one deleted shows
  // one removal rather than none.
  const remaining = new Map<string, number>();
  for (const block of baseBlocks) {
    const key = contentKey(block);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const out: NoteBlockDiff[] = [];
  for (const block of draftBlocks) {
    const key = contentKey(block);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      out.push({ block, status: "unchanged" });
    } else {
      out.push({ block, status: "added" });
    }
  }

  // Whatever the draft never claimed is gone; re-inserted at its base index
  // under the same rule the entity union uses.
  const claimed = new Map(remaining);
  baseBlocks.forEach((block, index) => {
    const key = contentKey(block);
    const left = claimed.get(key) ?? 0;
    if (left <= 0) {
      return;
    }
    claimed.set(key, left - 1);
    out.splice(Math.min(index, out.length), 0, { block, status: "removed" });
  });

  return out;
}
