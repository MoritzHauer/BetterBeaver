/**
 * Content documents (plan 0012): the transport/storage grouping for content
 * once it lives outside git. One `TopicDocument` per topic, one
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
 */
export const CONTENT_SCHEMA_VERSION = 1;

/**
 * Backend/cache document identity: `<kind>:<content-id>` (e.g.
 * `topic:kyrgyz`, `domain:ky`). Topics and domains are separate id
 * namespaces in the content model (a `demo` topic and a `demo` domain
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

export interface TopicDocumentNote {
  /** Note ids derive as `<topic.code>-note-<stem>` inside `validateContent`. */
  stem: string;
  markdown: string;
}

export interface TopicDocument {
  topic: unknown;
  lessons: unknown[];
  units: unknown[];
  /** Topic-owned items only (sentences, pairs, non-lexicon concepts). */
  items: unknown[];
  tasks: unknown[];
  resources: unknown[];
  notes: TopicDocumentNote[];
}

export interface DomainDocument {
  domain: unknown;
  entries: unknown[];
  families: unknown[];
}

/** The per-document identity a content set is checked over. */
export interface ContentSetTopic {
  id: string;
  domainId: string;
  /** The topic's validated item pool — may include its domain's entries
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
 * same rules): duplicate domain codes, and any item id (topic-owned or
 * lexicon entry) appearing twice anywhere — every `bb.item.<id>` SRS key
 * must be globally unambiguous. Returns error messages; empty means valid.
 *
 * Runs on already-per-document-validated content: callers pass ids from
 * `validateContent` results, not raw input.
 */
export function validateContentSet(
  topics: ContentSetTopic[],
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
    ...topics.flatMap((topic) => {
      const entryIds =
        entryIdsByDomain.get(topic.domainId) ?? new Set<string>();
      // A topic's validated item pool includes its domain's referenced
      // entries; exclude them here so each entry counts once, via its domain.
      return topic.itemIds.filter((id) => !entryIds.has(id));
    }),
    ...domains.flatMap((d) => d.entryIds),
  ];
  reportDuplicates(allItemIds, "item", errors);
  return errors;
}
