/**
 * Content documents (plan 0012): the transport/storage grouping for content
 * once it lives outside git. One `BookDocument` per book, one
 * `DomainDocument` per domain — together they carry exactly what
 * `validateContent` consumes, minus asset stems (assets stay bundled and
 * frozen until the asset pipeline lands; see plan 0012 §2).
 *
 * Entity payloads are deliberately `unknown`: documents at rest are
 * untrusted (backend rows, IndexedDB cache, proposals) and only become
 * typed by passing through `validateContent`.
 */

/**
 * Bumped on ANY entity-schema change — additive ones included, because a
 * strict discriminated union in an old client rejects an unknown task type
 * as hard as a breaking change (plan 0012 §8). Bump procedure (also §8):
 * bump here, admin republishes all listed documents, re-export the bundled
 * seed.
 *
 * Exemption (plan 0015 §6a): an additive _optional_ entity field that
 * non-strict zod parsing safely ignores — e.g. `bookSchema`'s `icon` or
 * `hasCoverArt` — does NOT bump. Old clients strip the unknown key
 * harmlessly instead of rejecting the document, so there's nothing to force
 * a republish over.
 */
/** Version 2: plan 0023 §7 renamed `lexemePayload.components[].script` to
 * `text`, which is breaking. The same plan's `entryId`, `bound` and
 * `variants` are additive and ride along on this one bump. */
/** Version 3 (plan 0027 §3/§7): the `question` item kind and the
 * `choice`/`assign` task types join their respective strict discriminated
 * unions, which an older client's union rejects outright — not an additive
 * case the 0015 §6a exemption covers. A private Book authored before 3 holds
 * none of them (private content is created only through this app or the
 * `.bbbook` import path, both gated by the schema version it was authored
 * under), so it needs no migration. */
export const CONTENT_SCHEMA_VERSION = 3;

/**
 * Backend/cache document identity: `<kind>:<content-id>` (e.g.
 * `topic:kyrgyz`, `domain:ky`). Books and domains are separate id
 * namespaces in the content model (a `demo` book and a `demo` domain
 * legitimately coexist), but documents share one primary key — the prefix
 * keeps them from colliding.
 */
export function documentId(
  kind: "topic" | "domain",
  contentId: string,
): string {
  return `${kind}:${contentId}`;
}

/** Inverse of `documentId`; returns the raw id unchanged if unprefixed. */
export function contentIdOf(docId: string): string {
  return docId.replace(/^(topic|domain):/, "");
}

export interface BookDocumentNote {
  /** Note ids derive as `<topic.code>-note-<stem>` inside `validateContent`. */
  stem: string;
  markdown: string;
}

export interface BookDocument {
  topic: unknown;
  lessons: unknown[];
  units: unknown[];
  /** Book-owned items only (sentences, pairs, non-lexicon concepts). */
  items: unknown[];
  tasks: unknown[];
  resources: unknown[];
  notes: BookDocumentNote[];
  /** Optional because no stored document has it: cached catalog rows,
   * backend rows, private Books and `.bbbook` files all lack the key.
   * Every reader treats a missing key as `[]` (plan 0027 §3). */
  exams?: unknown[];
}

export interface DomainDocument {
  domain: unknown;
  entries: unknown[];
  families: unknown[];
}

/** The per-document identity a content set is checked over. */
export interface ContentSetBook {
  id: string;
  domainId: string;
  /** The book's validated item pool — may include its domain's entries
   * (`validateContent` merges them in); those are filtered out here and
   * counted once via their domain instead. */
  itemIds: string[];
}

export interface ContentSetDomain {
  id: string;
  code: string;
  entryIds: string[];
}

function reportDuplicates(ids: string[], noun: string, errors: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  for (const id of duplicates) {
    errors.push(`${id}: duplicate ${noun} id across the content set`);
  }
}

/**
 * Cross-document checks over a whole content set (plan 0012, extracted from
 * the bundled source so the publish and update-accept paths enforce the
 * same rules): duplicate domain codes, and any item id (book-owned or
 * lexicon entry) appearing twice anywhere — every `bb.item.<id>` SRS key
 * must be globally unambiguous. Returns error messages; empty means valid.
 *
 * Runs on already-per-document-validated content: callers pass ids from
 * `validateContent` results, not raw input.
 */
export function validateContentSet(
  books: ContentSetBook[],
  domains: ContentSetDomain[],
): string[] {
  const errors: string[] = [];
  reportDuplicates(
    domains.map((d) => d.code),
    "domain code",
    errors,
  );
  const entryIdsByDomain = new Map(
    domains.map((d) => [d.id, new Set(d.entryIds)]),
  );
  const allItemIds = [
    ...books.flatMap((book) => {
      const entryIds = entryIdsByDomain.get(book.domainId) ?? new Set<string>();
      // A book's validated item pool includes its domain's referenced
      // entries; exclude them here so each entry counts once, via its domain.
      return book.itemIds.filter((id) => !entryIds.has(id));
    }),
    ...domains.flatMap((d) => d.entryIds),
  ];
  reportDuplicates(allItemIds, "item", errors);
  return errors;
}
