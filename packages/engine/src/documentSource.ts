import {
  CONTENT_SCHEMA_VERSION,
  validateContent,
  validateContentSet,
  type Content,
  type DomainDocument,
  type BookDocument,
} from "@betterbeaver/schema";
import { symmetricLinks } from "./domain.js";
import type { DomainContent } from "./domain.js";
import {
  ContentValidationError,
  type ContentSource,
  type DomainSummary,
  type BookSummary,
} from "./interfaces.js";

/** One row of the backend's learner-facing `catalog` view (plan 0012 §4). */
export interface CatalogRow {
  id: string;
  kind: "topic" | "domain";
  published_version: number;
  schema_version: number;
}

export interface ContentUpdate {
  /** Compatible documents whose published version differs from the cache. */
  changed: CatalogRow[];
  /** True when some listed document needs a newer app to be readable. */
  appOutdated: boolean;
}

/**
 * Diffs the backend catalog against the cached document versions, scoped to
 * the caller's membership (plan 0015 decision 11): catalog removal no
 * longer force-removes local content, so this only considers catalog rows
 * whose id the caller passes in `cachedVersions` (added + archived Books'
 * documents) — a row absent from `cachedVersions` is simply ignored, not
 * reported. A document counts as changed when its schema version is
 * supported and its published version differs from the cached one (0 when
 * uncached, so a fresh cache sees everything as new).
 */
export function planUpdate(
  cachedVersions: Map<string, number>,
  catalog: CatalogRow[],
): ContentUpdate {
  const memberCatalog = catalog.filter((row) => cachedVersions.has(row.id));
  const changed = memberCatalog.filter(
    (row) =>
      row.schema_version <= CONTENT_SCHEMA_VERSION &&
      row.published_version !== (cachedVersions.get(row.id) ?? 0),
  );
  const appOutdated = memberCatalog.some(
    (row) => row.schema_version > CONTENT_SCHEMA_VERSION,
  );
  return { changed, appOutdated };
}

/**
 * Per-book and per-domain asset stem inventories (plan 0012: assets stay
 * bundled and frozen, so these always come from the bundled asset maps —
 * regardless of where the documents themselves came from).
 */
export interface AssetStems {
  audioByBook: Map<string, string[]>;
  imageByBook: Map<string, string[]>;
  audioByDomain: Map<string, string[]>;
  imageByDomain: Map<string, string[]>;
}

export interface DocumentContentSource {
  source: ContentSource;
  /** Raw markdown for a note, from the document that owns it. */
  noteMarkdown(bookId: string, stem: string): string | undefined;
  /**
   * Added Books excluded from `source` (plan 0015 decision 11a): per-Book
   * validation failure, or a cross-Book collision (duplicate item id or
   * domain code) — in which case the earliest Book (by `bookDocs`
   * insertion order) wins and later ones land here instead.
   */
  broken: { bookId: string; errors: string[] }[];
}

/** The errors `validateContentSet` reports for the currently-committed set (helper for the incremental cross-Book check below). */
function crossSetErrors(
  contentByBookId: Map<string, Content>,
  domainContentById: Map<string, DomainContent>,
): string[] {
  const entryIdsByDomain = new Map(
    [...domainContentById.values()].map((d) => [
      d.domain.id,
      d.entries.map((e) => e.id),
    ]),
  );
  return validateContentSet(
    [...contentByBookId.values()].map((content) => ({
      id: content.topic.id,
      domainId: content.topic.domainId,
      itemIds: content.items.map((item) => item.id),
    })),
    [...domainContentById.values()].map((d) => ({
      id: d.domain.id,
      code: d.domain.code,
      entryIds: entryIdsByDomain.get(d.domain.id) ?? [],
    })),
  );
}

/**
 * Builds a `ContentSource` from a set of content documents (plan 0012,
 * per-Book granularity per plan 0015 decision 11a). The single validation
 * path shared by the bundled seed, the IndexedDB cache, and the
 * update-accept dry run: validates every book against its domain
 * (`validateContent`), then folds it into the running set and re-checks
 * the whole set (`validateContentSet`). A book that fails either check is
 * excluded and reported in `broken` instead of throwing — including a
 * cross-Book collision, where the earliest Book (by `bookDocs` insertion
 * order) wins and the later one is excluded. Never throws; callers inspect
 * `broken`.
 *
 * Map keys must equal the contained book/domain ids — they are the
 * document identities (directory names for bundled content, row ids for
 * backend content).
 */
export function createDocumentContentSource(
  bookDocs: Map<string, BookDocument>,
  domainDocs: Map<string, DomainDocument>,
  assets: AssetStems,
): DocumentContentSource {
  const contentByBookId = new Map<string, Content>();
  const domainContentById = new Map<string, DomainContent>();
  const noteMarkdownByBookId = new Map<string, Map<string, string>>();
  const broken: { bookId: string; errors: string[] }[] = [];

  for (const [key, doc] of bookDocs) {
    const domainId =
      typeof (doc.topic as { domainId?: unknown }).domainId === "string"
        ? (doc.topic as { domainId: string }).domainId
        : "";
    const domainDoc = domainDocs.get(domainId);
    const result = validateContent({
      topic: doc.topic,
      lessons: doc.lessons,
      units: doc.units,
      items: doc.items,
      tasks: doc.tasks,
      resources: doc.resources,
      noteStems: doc.notes.map((note) => note.stem),
      audioStems: assets.audioByBook.get(key) ?? [],
      imageStems: assets.imageByBook.get(key) ?? [],
      domain: domainDoc?.domain,
      entries: domainDoc?.entries ?? [],
      families: domainDoc?.families ?? [],
      lexiconAudioStems: assets.audioByDomain.get(domainId) ?? [],
      lexiconImageStems: assets.imageByDomain.get(domainId) ?? [],
    });
    if ("errors" in result) {
      broken.push({ bookId: key, errors: result.errors });
      continue;
    }
    if (result.content.topic.id !== key) {
      broken.push({
        bookId: key,
        errors: [
          `book id "${result.content.topic.id}" must equal its document key`,
        ],
      });
      continue;
    }
    // A domain shared by an earlier Book is already committed under its id
    // (plan 0006: two Books may share a domain); only a Book that
    // introduces a domain id for the first time can add or revert it.
    const domainWasNew = !domainContentById.has(result.domain.id);
    if (domainWasNew) {
      if (result.domain.id !== domainId) {
        broken.push({
          bookId: key,
          errors: [
            `domain id "${result.domain.id}" must equal its document key "${domainId}"`,
          ],
        });
        continue;
      }
      domainContentById.set(result.domain.id, {
        domain: result.domain,
        entries: result.entries,
        families: result.families,
        linksByEntryId: symmetricLinks(result.entries),
      });
    }
    contentByBookId.set(result.content.topic.id, result.content);
    noteMarkdownByBookId.set(
      result.content.topic.id,
      new Map(doc.notes.map((note) => [note.stem, note.markdown])),
    );

    // Incremental cross-Book check (plan 0015 decision 11a): since every
    // earlier Book in `bookDocs` order already committed clean, any new
    // error here is necessarily introduced by this Book — revert it and
    // report it broken, leaving the earlier Books (and the running set)
    // untouched.
    const errors = crossSetErrors(contentByBookId, domainContentById);
    if (errors.length > 0) {
      contentByBookId.delete(result.content.topic.id);
      noteMarkdownByBookId.delete(result.content.topic.id);
      if (domainWasNew) {
        domainContentById.delete(result.domain.id);
      }
      broken.push({ bookId: key, errors });
    }
  }

  return {
    broken,
    source: {
      listBooks(): Promise<BookSummary[]> {
        return Promise.resolve(
          [...contentByBookId.values()].map((content) => ({
            id: content.topic.id,
            title: content.topic.title,
            description: content.topic.description,
            domainId: content.topic.domainId,
            icon: content.topic.icon,
          })),
        );
      },
      loadBook(id: string): Promise<Content> {
        const content = contentByBookId.get(id);
        if (content === undefined) {
          return Promise.reject(
            new ContentValidationError([`unknown book: ${id}`]),
          );
        }
        return Promise.resolve(content);
      },
      listDomains(): Promise<DomainSummary[]> {
        return Promise.resolve(
          [...domainContentById.values()].map(({ domain }) => ({
            id: domain.id,
            title: domain.title,
            kind: domain.kind,
          })),
        );
      },
      loadDomain(id: string): Promise<DomainContent> {
        const domainContent = domainContentById.get(id);
        if (domainContent === undefined) {
          return Promise.reject(
            new ContentValidationError([`unknown domain: ${id}`]),
          );
        }
        return Promise.resolve(domainContent);
      },
    },
    noteMarkdown(bookId: string, stem: string): string | undefined {
      return noteMarkdownByBookId.get(bookId)?.get(stem);
    },
  };
}
