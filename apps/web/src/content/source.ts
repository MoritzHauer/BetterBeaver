import type { DomainDocument, TopicDocument } from "@betterbeaver/schema";
import {
  ContentValidationError,
  createDocumentContentSource,
  planUpdate,
  type CatalogRow,
  type ContentSource,
  type ContentUpdate,
  type DocumentContentSource,
} from "@betterbeaver/engine";
import {
  bundledAssetStems,
  bundledDomainDocuments,
  bundledTopicDocuments,
} from "./bundled";
import {
  clearCachedDocuments,
  readCachedDocuments,
  replaceCachedDocuments,
  type CachedDocument,
} from "./cache";

export type { ContentUpdate } from "@betterbeaver/engine";

export interface ContentInit {
  result: { source: ContentSource } | { errors: string[] };
  /** Resolves null when unconfigured, offline, errored, or up to date. */
  checkForUpdate(): Promise<ContentUpdate | null>;
  /** Downloads, validates (all-or-nothing), stores, and reloads the app. Throws with a human-readable message on failure. */
  acceptUpdate(update: ContentUpdate): Promise<void>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  string | undefined;

function catalogEndpoint(select: string, filter = ""): string {
  return `${SUPABASE_URL}/rest/v1/catalog?select=${select}${filter}`;
}

async function fetchCatalog(select: string, filter = ""): Promise<unknown> {
  const response = await fetch(catalogEndpoint(select, filter), {
    headers: {
      apikey: SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    },
  });
  if (!response.ok) {
    throw new Error(`catalog request failed: ${response.status}`);
  }
  return response.json();
}

function toDocumentMaps(docs: CachedDocument[]): {
  topics: Map<string, TopicDocument>;
  domains: Map<string, DomainDocument>;
} {
  const topics = new Map<string, TopicDocument>();
  const domains = new Map<string, DomainDocument>();
  for (const record of docs) {
    if (record.kind === "topic") {
      topics.set(record.id, record.doc as TopicDocument);
    } else {
      domains.set(record.id, record.doc as DomainDocument);
    }
  }
  return { topics, domains };
}

function buildFromDocuments(docs: CachedDocument[]): DocumentContentSource {
  const { topics, domains } = toDocumentMaps(docs);
  return createDocumentContentSource(topics, domains, bundledAssetStems());
}

function buildFromSeed(): DocumentContentSource {
  return createDocumentContentSource(
    bundledTopicDocuments(),
    bundledDomainDocuments(),
    bundledAssetStems(),
  );
}

// Set once by initContentSource; read by getNoteMarkdown. Note markdown
// lives inside the content documents since plan 0012 (content left git), so
// the lookup must go through whichever document set actually booted.
let active: DocumentContentSource | undefined;

/** Raw markdown for a note of the active content set (bundled seed or cached backend documents). */
export function getNoteMarkdown(
  topicId: string,
  stem: string,
): string | undefined {
  return active?.noteMarkdown(topicId, stem);
}

/**
 * Boots the content layer (plan 0012 §6): cache-first, never blocking on
 * the network. Cached backend documents win; an empty cache boots the
 * bundled seed; a cache that fails validation (schema moved on, or
 * corruption) is discarded in favor of the seed — a broken cache must never
 * brick the app. Bundled-seed validation failure still throws to the
 * developer error screen, exactly as before plan 0012.
 */
export async function initContentSource(): Promise<ContentInit> {
  let cached = await readCachedDocuments();
  let built: DocumentContentSource | undefined;
  let errors: string[] | undefined;

  if (cached.length > 0) {
    try {
      built = buildFromDocuments(cached);
    } catch (error) {
      if (!(error instanceof ContentValidationError)) {
        throw error;
      }
      console.warn("discarding invalid content cache:", error.errors);
      await clearCachedDocuments();
      cached = [];
    }
  }
  if (built === undefined) {
    try {
      built = buildFromSeed();
    } catch (error) {
      if (!(error instanceof ContentValidationError)) {
        throw error;
      }
      errors = error.errors;
    }
  }
  active = built;

  const cachedVersions = new Map(
    cached.map((record) => [record.id, record.version]),
  );
  const configured =
    SUPABASE_URL !== undefined &&
    SUPABASE_URL !== "" &&
    SUPABASE_ANON_KEY !== undefined &&
    SUPABASE_ANON_KEY !== "";

  return {
    result: errors !== undefined ? { errors } : { source: built!.source },
    async checkForUpdate(): Promise<ContentUpdate | null> {
      if (!configured || errors !== undefined) {
        return null;
      }
      let catalog: CatalogRow[];
      try {
        catalog = (await fetchCatalog(
          "id,kind,published_version,schema_version",
        )) as CatalogRow[];
      } catch {
        return null; // offline, backend paused, misconfigured — never a learner-facing error
      }
      const update = planUpdate(cachedVersions, catalog);
      return update.changed.length > 0 ||
        update.removedIds.length > 0 ||
        update.appOutdated
        ? update
        : null;
    },
    async acceptUpdate(update: ContentUpdate): Promise<void> {
      const ids = update.changed.map((row) => `"${row.id}"`).join(",");
      let rows: (CatalogRow & { published: unknown })[] = [];
      if (update.changed.length > 0) {
        rows = (await fetchCatalog(
          "id,kind,published,published_version,schema_version",
          `&id=in.(${ids})`,
        )) as (CatalogRow & { published: unknown })[];
        if (rows.length !== update.changed.length) {
          throw new Error(
            "update failed: some documents were no longer available — try again later",
          );
        }
      }
      const downloaded = new Map(rows.map((row) => [row.id, row]));
      const removed = new Set(update.removedIds);
      const next: CachedDocument[] = [
        // Untouched cached documents that are still in the catalog…
        ...cached.filter(
          (record) => !downloaded.has(record.id) && !removed.has(record.id),
        ),
        // …plus every downloaded document.
        ...rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          version: row.published_version,
          schemaVersion: row.schema_version,
          doc: row.published as CachedDocument["doc"],
        })),
      ];
      try {
        buildFromDocuments(next); // all-or-nothing dry run (plan 0012 §6)
      } catch (error) {
        if (error instanceof ContentValidationError) {
          throw new Error(
            `update rejected, keeping current content — first problem: ${error.errors[0] ?? "unknown"}`,
            { cause: error },
          );
        }
        throw error;
      }
      await replaceCachedDocuments(next);
      window.location.reload();
    },
  };
}
