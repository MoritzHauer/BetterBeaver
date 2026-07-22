import {
  contentIdOf,
  documentId,
  CONTENT_SCHEMA_VERSION,
  type DomainDocument,
  type BookDocument,
} from "@betterbeaver/schema";
import {
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
  bundledBookDocuments,
} from "./bundled";
import {
  readCachedDocuments,
  putCachedDocuments,
  deleteCachedDocuments,
  type CachedDocument,
} from "./cache";
import {
  isFirstRun,
  readMyBooks,
  readArchived,
  initMembership,
  addToMyBooks,
  removeFromMembership,
  archiveInMembership,
  restoreInMembership,
} from "./myBooks";

export type { ContentUpdate } from "@betterbeaver/engine";

export interface ContentInit {
  result: { source: ContentSource } | { errors: string[] };
  /** Added Books that failed to load: validation errors or missing cache docs (plan 0015 decision 11a). For 0015-5's broken card. */
  broken: { bookId: string; errors: string[] }[];
  /** Resolves null when unconfigured, offline, errored, or up to date. Member-scoped (added + archived Books only). */
  checkForUpdate(): Promise<ContentUpdate | null>;
  /** Downloads, validates and commits per Book, and reloads if anything committed. Throws listing any Books kept at their current version. */
  acceptUpdate(update: ContentUpdate): Promise<void>;
  /** Fetches a Book from the Library, validates it against the current My Books set, caches it, and reloads. Throws a human-readable message on failure; membership is untouched on failure. */
  addBook(bookId: string, domainId: string): Promise<void>;
  /** Drops the Book from My Books (added or archived) and evicts its cache; reloads. Progress is untouched. */
  removeBook(bookId: string): Promise<void>;
  archiveBook(bookId: string): void;
  restoreBook(bookId: string): void;
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

/** A book document's declared domain id, read raw (before validation) — the same pattern `bundled.ts`/`documentSource.ts` use. */
function rawDomainId(doc: BookDocument): string {
  return typeof (doc.topic as { domainId?: unknown }).domainId === "string"
    ? (doc.topic as { domainId: string }).domainId
    : "";
}

function toCachedDocument(
  row: CatalogRow & { published: unknown },
): CachedDocument {
  return {
    id: row.id,
    kind: row.kind,
    version: row.published_version,
    schemaVersion: row.schema_version,
    doc: row.published as CachedDocument["doc"],
  };
}

/** The onboarding Book's bundled seed, shaped as catalog rows (version 0) — the offline Add/recovery source for `demo` (plan 0015 decisions 3/9). */
function seedCatalogRows(): (CatalogRow & { published: unknown })[] {
  const bookDoc = bundledBookDocuments().get("demo");
  const domainDoc = bundledDomainDocuments().get("demo");
  const rows: (CatalogRow & { published: unknown })[] = [];
  if (bookDoc !== undefined) {
    rows.push({
      id: documentId("topic", "demo"),
      kind: "topic",
      published_version: 0,
      schema_version: CONTENT_SCHEMA_VERSION,
      published: bookDoc,
    });
  }
  if (domainDoc !== undefined) {
    rows.push({
      id: documentId("domain", "demo"),
      kind: "domain",
      published_version: 0,
      schema_version: CONTENT_SCHEMA_VERSION,
      published: domainDoc,
    });
  }
  return rows;
}

/**
 * Writes the onboarding Book's seed documents into the cache if absent
 * (decision 9) — never overwriting an existing (possibly newer) record.
 * Best-effort: an unwritable IndexedDB is swallowed here; `buildMembers`'s
 * own demo fallback covers booting from the bundled seed in memory instead.
 */
async function seedOnboardingIfAbsent(cached: CachedDocument[]): Promise<void> {
  const ids = new Set(cached.map((d) => d.id));
  const missing = seedCatalogRows()
    .filter((row) => !ids.has(row.id))
    .map(toCachedDocument);
  if (missing.length === 0) {
    return;
  }
  try {
    await putCachedDocuments(missing);
  } catch {
    // IndexedDB unwritable — proceed; boot falls back to the in-memory seed.
  }
}

/**
 * One-time purge (decision 12): deletes every cached document not
 * referenced by current membership, keeping exactly `topic:<id>` for each
 * added/archived Book plus `domain:<id>` for each domain a kept book
 * document references. A no-op on a genuinely fresh install.
 */
async function purgeUnmembered(
  cached: CachedDocument[],
  added: string[],
  archived: string[],
): Promise<CachedDocument[]> {
  const byId = new Map(cached.map((d) => [d.id, d]));
  const keepIds = new Set<string>();
  for (const bookId of [...added, ...archived]) {
    const rec = byId.get(documentId("topic", bookId));
    if (rec === undefined) {
      continue;
    }
    keepIds.add(rec.id);
    const domainId = rawDomainId(rec.doc as BookDocument);
    if (domainId !== "") {
      keepIds.add(documentId("domain", domainId));
    }
  }
  const toDelete = cached.filter((d) => !keepIds.has(d.id)).map((d) => d.id);
  if (toDelete.length === 0) {
    return cached;
  }
  try {
    await deleteCachedDocuments(toDelete);
  } catch {
    // IndexedDB unwritable — the stray docs stay cached but inert (never
    // referenced by membership, so never loaded); harmless.
  }
  return cached.filter((d) => keepIds.has(d.id));
}

/**
 * Builds the maps `createDocumentContentSource` wants from cached documents,
 * for exactly `bookIds` (added Books at boot; a candidate set for a dry
 * run). A `bookId` missing its cached `topic:` document is reported in
 * `missing` — except `demo`, whose bundled seed serves as the offline
 * fallback (decision 3's "offline Add source" rule), so it's built from the
 * seed in memory instead of ever appearing missing.
 */
function buildMembers(
  cachedById: Map<string, CachedDocument>,
  bookIds: string[],
): { built: DocumentContentSource; missing: string[] } {
  const books = new Map<string, BookDocument>();
  const domains = new Map<string, DomainDocument>();
  const missing: string[] = [];
  for (const bookId of bookIds) {
    const rec = cachedById.get(documentId("topic", bookId));
    if (rec === undefined) {
      if (bookId === "demo") {
        const seedBook = bundledBookDocuments().get("demo");
        const seedDomain = bundledDomainDocuments().get("demo");
        if (seedBook !== undefined) {
          books.set("demo", seedBook);
        }
        if (seedDomain !== undefined) {
          domains.set("demo", seedDomain);
        }
        continue;
      }
      missing.push(bookId);
      continue;
    }
    const bookDoc = rec.doc as BookDocument;
    books.set(bookId, bookDoc);
    const domainId = rawDomainId(bookDoc);
    if (domainId !== "" && !domains.has(domainId)) {
      const domainRec = cachedById.get(documentId("domain", domainId));
      if (domainRec !== undefined) {
        domains.set(domainId, domainRec.doc as DomainDocument);
      }
    }
  }
  const built = createDocumentContentSource(
    books,
    domains,
    bundledAssetStems(),
  );
  return { built, missing };
}

/** Cached versions of exactly the added+archived Books' documents — what `planUpdate` scopes update-checking to (decision 11). */
function memberCachedVersions(
  cachedById: Map<string, CachedDocument>,
  added: string[],
  archived: string[],
): Map<string, number> {
  const versions = new Map<string, number>();
  for (const bookId of [...added, ...archived]) {
    const rec = cachedById.get(documentId("topic", bookId));
    if (rec === undefined) {
      continue;
    }
    versions.set(rec.id, rec.version);
    const domainId = rawDomainId(rec.doc as BookDocument);
    if (domainId === "") {
      continue;
    }
    const domainRec = cachedById.get(documentId("domain", domainId));
    if (domainRec !== undefined) {
      versions.set(domainRec.id, domainRec.version);
    }
  }
  return versions;
}

// Set once by initContentSource; read by getNoteMarkdown. Note markdown
// lives inside the content documents since plan 0012 (content left git), so
// the lookup must go through whichever document set actually booted.
let active: DocumentContentSource | undefined;

/** Raw markdown for a note of the active content set (bundled seed or cached backend documents). */
export function getNoteMarkdown(
  bookId: string,
  stem: string,
): string | undefined {
  return active?.noteMarkdown(bookId, stem);
}

/**
 * Boots the content layer (plan 0015: per-Book My Books membership,
 * amending plan 0012 §6's whole-catalog sync). Cache-first, never blocking
 * on the network.
 *
 * First run (decisions 9/12, `bb.mybooks` absent): the bundled seed's
 * onboarding documents are written into the cache if absent, My Books
 * becomes `["demo"]`, and every cached document not referenced by
 * membership is purged (a one-time fresh start for existing installs).
 *
 * Every boot: the source builds from added Books' cached documents only
 * (archived Books stay cached but unloaded until restored); a Book that
 * fails validation, or whose cached documents are missing, is excluded and
 * reported in `broken` instead of bricking the app — boot never wipes the
 * cache and never throws for them. Exception: the onboarding Book failing
 * right off the first-run seed write is still a shipping bug, not a
 * broken-card state — it throws to the developer error screen exactly as a
 * corrupted bundled seed always did.
 */
export async function initContentSource(): Promise<ContentInit> {
  const firstRun = isFirstRun();
  let cached = await readCachedDocuments();

  if (firstRun) {
    await seedOnboardingIfAbsent(cached);
    initMembership(["demo"], []);
    cached = await purgeUnmembered(
      await readCachedDocuments(),
      readMyBooks(),
      readArchived(),
    );
  }

  const added = readMyBooks();
  const archived = readArchived();
  const cachedById = new Map(cached.map((record) => [record.id, record]));

  const { built, missing } = buildMembers(cachedById, added);
  const broken: { bookId: string; errors: string[] }[] = [
    ...missing.map((bookId) => ({
      bookId,
      errors: ["missing cached content — try re-adding this book"],
    })),
    ...built.broken,
  ];

  const demoBroken = firstRun
    ? broken.find((b) => b.bookId === "demo")
    : undefined;
  const errors = demoBroken?.errors;
  active = errors === undefined ? built : undefined;

  const cachedVersions = memberCachedVersions(cachedById, added, archived);
  const configured =
    SUPABASE_URL !== undefined &&
    SUPABASE_URL !== "" &&
    SUPABASE_ANON_KEY !== undefined &&
    SUPABASE_ANON_KEY !== "";

  return {
    result: errors !== undefined ? { errors } : { source: built.source },
    broken: errors !== undefined ? [] : broken,

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
      return update.changed.length > 0 || update.appOutdated ? update : null;
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
      const memberBookIds = [...added, ...archived];

      function bookDomainId(bookId: string): string {
        const rec = cachedById.get(documentId("topic", bookId));
        return rec !== undefined ? rawDomainId(rec.doc as BookDocument) : "";
      }
      function effectiveTopicDoc(bookId: string): BookDocument | undefined {
        const downloadedRow = downloaded.get(documentId("topic", bookId));
        if (downloadedRow !== undefined) {
          return downloadedRow.published as BookDocument;
        }
        return cachedById.get(documentId("topic", bookId))?.doc as
          BookDocument | undefined;
      }
      function effectiveDomainDoc(
        domainId: string,
      ): DomainDocument | undefined {
        const downloadedRow = downloaded.get(documentId("domain", domainId));
        if (downloadedRow !== undefined) {
          return downloadedRow.published as DomainDocument;
        }
        return cachedById.get(documentId("domain", domainId))?.doc as
          DomainDocument | undefined;
      }

      // A changed topic row affects its own Book; a changed domain row
      // affects every member Book referencing it (spec: "a changed domain
      // doc belongs to every member Book referencing it").
      const changedTopicBookIds = new Set(
        rows.filter((r) => r.kind === "topic").map((r) => contentIdOf(r.id)),
      );
      const changedDomainIds = new Set(
        rows.filter((r) => r.kind === "domain").map((r) => contentIdOf(r.id)),
      );
      const affected = memberBookIds.filter(
        (bookId) =>
          changedTopicBookIds.has(bookId) ||
          changedDomainIds.has(bookDomainId(bookId)),
      );

      // Dry-run each affected Book, independently, with its new docs against
      // the rest of the member set at their *current* cached versions (spec:
      // "dry-run each affected Book with its new docs against the rest") —
      // one createDocumentContentSource call per affected Book, not one
      // combined pass, so the earliest-wins tie-break inside that builder
      // never decides between two affected Books by membership order.
      // Within each per-Book dry run, the affected Book itself must be
      // inserted LAST into `books` (mirroring `addBook`): the builder
      // reverts whichever Book is *processed* when a collision first
      // appears, so putting the rest first and the affected Book last makes
      // it the one blamed — the Book whose update actually introduced the
      // collision, not an untouched bystander (decision 11a: "existing
      // content untouched").
      const failedAffected: string[] = [];
      const errorsByFailedBook = new Map<string, string[]>();
      for (const bookId of affected) {
        const newDoc = effectiveTopicDoc(bookId);
        if (newDoc === undefined) {
          continue; // already broken-missing — not this accept's concern
        }
        const books = new Map<string, BookDocument>();
        const domains = new Map<string, DomainDocument>();
        const newDomainId = rawDomainId(newDoc);
        if (newDomainId !== "") {
          const newDomainDoc = effectiveDomainDoc(newDomainId);
          if (newDomainDoc !== undefined) {
            domains.set(newDomainId, newDomainDoc);
          }
        }
        for (const otherId of memberBookIds) {
          if (otherId === bookId) {
            continue;
          }
          const oldDoc = cachedById.get(documentId("topic", otherId))?.doc as
            BookDocument | undefined;
          if (oldDoc === undefined) {
            continue;
          }
          books.set(otherId, oldDoc);
          const oldDomainId = rawDomainId(oldDoc);
          if (oldDomainId !== "" && !domains.has(oldDomainId)) {
            const oldDomainDoc = cachedById.get(
              documentId("domain", oldDomainId),
            )?.doc as DomainDocument | undefined;
            if (oldDomainDoc !== undefined) {
              domains.set(oldDomainId, oldDomainDoc);
            }
          }
        }
        books.set(bookId, newDoc); // last — see comment above
        const dryRunX = createDocumentContentSource(
          books,
          domains,
          bundledAssetStems(),
        );
        const ownFailure = dryRunX.broken.find((b) => b.bookId === bookId);
        if (ownFailure !== undefined) {
          failedAffected.push(bookId);
          errorsByFailedBook.set(bookId, ownFailure.errors);
        }
      }

      // Commit every downloaded row whose Book(s) didn't fail: a topic row
      // commits unless its own Book failed; a domain row commits unless
      // every Book referencing it failed.
      const toCommit: CachedDocument[] = [];
      for (const row of rows) {
        if (row.kind === "topic") {
          if (failedAffected.includes(contentIdOf(row.id))) {
            continue;
          }
        } else {
          const domainId = contentIdOf(row.id);
          const referencingBooks = memberBookIds.filter(
            (bookId) => bookDomainId(bookId) === domainId,
          );
          if (
            referencingBooks.length > 0 &&
            referencingBooks.every((bookId) => failedAffected.includes(bookId))
          ) {
            continue;
          }
        }
        toCommit.push(toCachedDocument(row));
      }

      if (toCommit.length > 0) {
        await putCachedDocuments(toCommit);
        window.location.reload();
      }

      if (failedAffected.length > 0) {
        const messages = failedAffected.map((bookId) => {
          const bookErrors = errorsByFailedBook.get(bookId) ?? [];
          return `${bookId}: ${bookErrors[0] ?? "unknown error"}`;
        });
        throw new Error(
          `update kept the current version for: ${messages.join("; ")}`,
        );
      }
    },

    async addBook(bookId: string, domainId: string): Promise<void> {
      const topicDocId = documentId("topic", bookId);
      const domainDocId = documentId("domain", domainId);
      let rows: (CatalogRow & { published: unknown })[] | undefined;
      try {
        rows = (await fetchCatalog(
          "id,kind,published,published_version,schema_version",
          `&id=in.("${topicDocId}","${domainDocId}")`,
        )) as (CatalogRow & { published: unknown })[];
      } catch {
        rows = undefined;
      }
      if (rows === undefined || rows.length !== 2) {
        if (bookId === "demo") {
          rows = seedCatalogRows();
        } else {
          throw new Error(
            rows === undefined
              ? "could not add this book — check your connection and try again"
              : "could not add this book — it may no longer be available",
          );
        }
      }

      const newDocs = rows.map(toCachedDocument);

      // Dry-run against the current added Books, the new Book appended
      // last (decision 11a: earliest wins, so an introduced collision
      // rejects only the new Book — existing content untouched).
      const freshCached = await readCachedDocuments();
      const dryRunById = new Map(freshCached.map((d) => [d.id, d]));
      for (const doc of newDocs) {
        dryRunById.set(doc.id, doc);
      }
      const currentAdded = readMyBooks();
      const { built: dryRun } = buildMembers(dryRunById, [
        ...currentAdded.filter((id) => id !== bookId),
        bookId,
      ]);
      const rejection = dryRun.broken.find((b) => b.bookId === bookId);
      if (rejection !== undefined) {
        throw new Error(
          `can't add this book: ${rejection.errors[0] ?? "content conflict"}`,
        );
      }

      await putCachedDocuments(newDocs);
      addToMyBooks(bookId);
      window.location.reload();
    },

    async removeBook(bookId: string): Promise<void> {
      const freshCached = await readCachedDocuments();
      const byId = new Map(freshCached.map((d) => [d.id, d]));
      const topicRec = byId.get(documentId("topic", bookId));
      const domainId =
        topicRec !== undefined ? rawDomainId(topicRec.doc as BookDocument) : "";

      const otherMemberIds = [...readMyBooks(), ...readArchived()].filter(
        (id) => id !== bookId,
      );
      const domainStillReferenced =
        domainId !== "" &&
        otherMemberIds.some((otherId) => {
          const otherRec = byId.get(documentId("topic", otherId));
          return (
            otherRec !== undefined &&
            rawDomainId(otherRec.doc as BookDocument) === domainId
          );
        });

      removeFromMembership(bookId);

      const toDelete = [documentId("topic", bookId)];
      if (domainId !== "" && !domainStillReferenced) {
        toDelete.push(documentId("domain", domainId));
      }
      await deleteCachedDocuments(toDelete);
      window.location.reload();
    },

    archiveBook(bookId: string): void {
      archiveInMembership(bookId);
      window.location.reload();
    },

    restoreBook(bookId: string): void {
      restoreInMembership(bookId);
      window.location.reload();
    },
  };
}
