import { type BookDocument, type DomainDocument } from "@betterbeaver/schema";

export type Entity = { id: string } & Record<string, unknown>;

export type AnyDoc = BookDocument | DomainDocument;

/** What the question screen's `✎` names: the one entity the scoped session
 * sheet holds (spec 0021-11 §3). `lessonId`/`unitId`/`noteStem` were here to
 * seed the form editor's opening screen and went with it, along with the
 * `View` union and `upView` — spec 0021-10 §3's publish-error deep-linking
 * has its own `ChangedTarget`, so nothing else needs the wider shape. An
 * `entryId` and an `itemId` are the same thing to every reader; which
 * document owns it is `unitEditOps`' business. */
export interface EditTarget {
  itemId?: string;
  entryId?: string;
  taskId?: string;
}

export interface StoredProposal {
  baseVersion: number;
  doc: AnyDoc;
}

/** A Book's declared domain id, read raw off its topic — same pattern
 * `content/source.ts`'s and `content/private-assets.ts`'s own `rawDomainId`
 * use (each file keeps its own tiny copy rather than sharing one across
 * module boundaries). Despite the name (this predates spec 0018), it's not
 * private-path-specific: every mode resolves the lexicon's document id
 * through it, since the Book is the only thing that names it. */
export function rawPrivateDomainId(book: BookDocument): string {
  return typeof (book.topic as { domainId?: unknown }).domainId === "string"
    ? (book.topic as { domainId: string }).domainId
    : "";
}

/** The Book's first `resources[]` id, or `""` if it has none — the default
 * `sourceRef` a newly-added lexicon entry gets (spec 0021-3 §4b).
 *
 * `resources` is optional-chained even though `BookDocument` declares it
 * non-optional: a working document is `JSON.parse(localStorage)` or a
 * backend/catalog row cast straight to `BookDocument` with no shape check,
 * and `documentSource.ts`'s `bookDocumentShapeError` exists because a
 * malformed document at rest once bricked the whole boot. This runs on
 * every render in edit mode, so an unguarded deref would white-screen the
 * screen rather than degrade one control. */
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
 * row. Same in-place surfaces as the maintainer path, loaded from the
 * learner-facing `catalog` view instead of `documents` — RLS gives a
 * non-maintainer no other way to read this document. */
export const proposalKey = (docId: string) => `bb.proposal.${docId}`;

/** Whether this Book has work that has not left the device (spec 0021-5
 * §3). Read at render, not once at mount: the point is that it shows from
 * *outside* a session, so it has to notice the session that just closed.
 * A private Book has neither key and correctly reports nothing — every
 * keystroke is already saved, there is nothing "unpublished" about it. */
export function hasUnpublishedChanges(docId: string): boolean {
  try {
    return (
      localStorage.getItem(draftKey(docId)) !== null ||
      localStorage.getItem(proposalKey(docId)) !== null
    );
  } catch {
    // Same degrade as every other storage read in this app (spec 0019 §1):
    // a private-mode webview throws rather than returning null.
    return false;
  }
}
