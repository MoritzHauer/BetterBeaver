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
  /** Cached documents no longer in the catalog (unlisted or removed). */
  removedIds: string[];
  /** True when some listed document needs a newer app to be readable. */
  appOutdated: boolean;
}

/**
 * Diffs the backend catalog against the cached document versions (plan 0012
 * §6/§8). A document counts as changed when its schema version is supported
 * and its published version differs from the cached one (0 when uncached,
 * so a fresh cache sees everything as new).
 */
export function planUpdate(
  cachedVersions: Map<string, number>,
  catalog: CatalogRow[],
): ContentUpdate {
  const changed = catalog.filter(
    (row) =>
      row.schema_version <= CONTENT_SCHEMA_VERSION &&
      row.published_version !== (cachedVersions.get(row.id) ?? 0),
  );
  const catalogIds = new Set(catalog.map((row) => row.id));
  const removedIds = [...cachedVersions.keys()].filter(
    (id) => !catalogIds.has(id),
  );
  const appOutdated = catalog.some(
    (row) => row.schema_version > CONTENT_SCHEMA_VERSION,
  );
  return { changed, removedIds, appOutdated };
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
}

/**
 * Builds a `ContentSource` from a set of content documents (plan 0012).
 * The single validation path shared by the bundled seed, the IndexedDB
 * cache, and the update-accept dry run: validates every book against its
 * domain (`validateContent`), then the whole set (`validateContentSet`).
 * Throws `ContentValidationError` listing every problem on any failure.
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
  const allErrors: string[] = [];

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
      allErrors.push(...result.errors.map((error) => `${key}: ${error}`));
      continue;
    }
    if (result.content.topic.id !== key) {
      allErrors.push(
        `${key}: book id "${result.content.topic.id}" must equal its document key`,
      );
      continue;
    }
    contentByBookId.set(result.content.topic.id, result.content);
    noteMarkdownByBookId.set(
      result.content.topic.id,
      new Map(doc.notes.map((note) => [note.stem, note.markdown])),
    );
    if (!domainContentById.has(result.domain.id)) {
      if (result.domain.id !== domainId) {
        allErrors.push(
          `${key}: domain id "${result.domain.id}" must equal its document key "${domainId}"`,
        );
        continue;
      }
      domainContentById.set(result.domain.id, {
        domain: result.domain,
        entries: result.entries,
        families: result.families,
        linksByEntryId: symmetricLinks(result.entries),
      });
    }
  }

  if (allErrors.length === 0) {
    const entryIdsByDomain = new Map(
      [...domainContentById.values()].map((d) => [
        d.domain.id,
        d.entries.map((e) => e.id),
      ]),
    );
    allErrors.push(
      ...validateContentSet(
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
      ),
    );
  }

  if (allErrors.length > 0) {
    throw new ContentValidationError(allErrors);
  }

  return {
    source: {
      listBooks(): Promise<BookSummary[]> {
        return Promise.resolve(
          [...contentByBookId.values()].map((content) => ({
            id: content.topic.id,
            title: content.topic.title,
            description: content.topic.description,
            domainId: content.topic.domainId,
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
