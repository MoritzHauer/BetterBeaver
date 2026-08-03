import { type BookDocument, type DomainDocument } from "@betterbeaver/schema";

export type Entity = { id: string } & Record<string, unknown>;

export type AnyDoc = BookDocument | DomainDocument;

export type View =
  | { v: "root" }
  | { v: "lesson"; lessonId: string }
  | { v: "unit"; lessonId: string; unitId: string }
  | { v: "item"; backTo: View; id: string }
  | { v: "task"; backTo: View; id: string }
  | { v: "note"; backTo: View; stem: string }
  | { v: "entry"; id: string }
  | { v: "family"; id: string }
  // Maintainer-only (plan 0012 §5): reviewing one open proposal.
  | { v: "proposal"; id: string };

/** Deep-link target from the learner screens' Edit buttons: the editor
 * opens directly at the matching level (book/lesson/unit/note/item/entry/
 * task). */
export interface EditTarget {
  lessonId?: string;
  unitId?: string;
  noteStem?: string;
  itemId?: string;
  entryId?: string;
  taskId?: string;
}

export interface StoredProposal {
  baseVersion: number;
  doc: AnyDoc;
}

export function initialView(target: EditTarget | undefined): View {
  if (target?.entryId !== undefined) {
    return { v: "entry", id: target.entryId };
  }
  if (target?.itemId !== undefined) {
    return { v: "item", backTo: { v: "root" }, id: target.itemId };
  }
  if (target?.taskId !== undefined) {
    return { v: "task", backTo: { v: "root" }, id: target.taskId };
  }
  if (target?.lessonId !== undefined && target.unitId !== undefined) {
    const unitView: View = {
      v: "unit",
      lessonId: target.lessonId,
      unitId: target.unitId,
    };
    return target.noteStem !== undefined
      ? { v: "note", backTo: unitView, stem: target.noteStem }
      : unitView;
  }
  if (target?.lessonId !== undefined) {
    return { v: "lesson", lessonId: target.lessonId };
  }
  return { v: "root" };
}

export function upView(view: View): View {
  switch (view.v) {
    case "lesson":
    case "entry":
    case "family":
    case "proposal":
      return { v: "root" };
    case "unit":
      return { v: "lesson", lessonId: view.lessonId };
    case "item":
    case "task":
    case "note":
      return view.backTo;
    case "root":
      return view;
  }
}

export function byId(list: unknown[], id: string): Entity | undefined {
  return (list as Entity[]).find((e) => e.id === id);
}

/** A Book's declared domain id, read raw off its topic — same pattern
 * `content/source.ts`'s and `content/private-assets.ts`'s own `rawDomainId`
 * use (each file keeps its own tiny copy rather than sharing one across
 * module boundaries). Despite the name (this predates spec 0018), it's not
 * private-path-specific: Maintain/ProposeEditScreen reuse it to look
 * up the domain doc for `BookEditor`'s itemIds pickers' merged pool. */
export function rawPrivateDomainId(book: BookDocument): string {
  return typeof (book.topic as { domainId?: unknown }).domainId === "string"
    ? (book.topic as { domainId: string }).domainId
    : "";
}

/** The Book's first `resources[]` id, or `""` if it has none — the default
 * `sourceRef` a newly-added lexicon entry gets (spec 0021-3 §4b). All three
 * edit shells compute it identically for `BookEditor`'s `sourceRef` prop.
 *
 * `resources` is optional-chained even though `BookDocument` declares it
 * non-optional: a working document is `JSON.parse(localStorage)` or a
 * backend/catalog row cast straight to `BookDocument` with no shape check,
 * and `documentSource.ts`'s `bookDocumentShapeError` exists because a
 * malformed document at rest once bricked the whole boot. This runs on
 * every render of every edit view, so an unguarded deref would white-screen
 * the editor rather than degrade one panel. */
export function firstResourceId(doc: BookDocument): string {
  const first = (doc.resources as Entity[] | undefined)?.[0];
  return typeof first?.id === "string" ? first.id : "";
}

/** Local-first draft storage (one key per document). The draft lives here
 * until the author explicitly syncs it from the root (book) view. */
export const draftKey = (docId: string) => `bb.author.draft.${docId}`;

/** Non-maintainer editing (plan 0012 §5): there is no `draft` column to
 * autosave to, so the working copy lives entirely in localStorage under
 * `bb.proposal.<docId>` until "Submit proposal" turns it into a `proposals`
 * row. Same forms (`BookEditor`/`DomainEditor`) as the maintainer path,
 * loaded from the learner-facing `catalog` view instead of `documents` —
 * RLS gives a non-maintainer no other way to read this document. */
export const proposalKey = (docId: string) => `bb.proposal.${docId}`;
