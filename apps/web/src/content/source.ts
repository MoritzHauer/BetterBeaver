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
  type AssetStems,
  type CatalogRow,
  type ContentSource,
  type ContentUpdate,
  type DocumentContentSource,
} from "@betterbeaver/engine";
import {
  allAssetStems,
  bundledAssetStems,
  bundledDomainDocuments,
  bundledBookDocuments,
  mergeAssetStems,
} from "./bundled";
import {
  readCachedDocuments,
  putCachedDocuments,
  deleteCachedDocuments,
  type CachedDocument,
} from "./cache";
import {
  readPrivateBooks,
  putPrivateBook,
  deletePrivateBook,
  type PrivateBookRecord,
} from "./private-store";
import { newPrivateId } from "./private-ids";
import { registerPrivateAssets, privateAssetStems } from "./private-assets";
import { registerRemoteAssets } from "./remote-assets";
import {
  listDocumentAssets,
  downloadRemoteAsset,
  canReuseBlob,
  previousAssetMeta,
  assetStemsFromListing,
  type RemoteAsset,
} from "../backend/storage";
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
import { isStorageUnwritable } from "../storage-health";
import { isOffline } from "../offline";

export type { ContentUpdate } from "@betterbeaver/engine";

/**
 * Set just before a My Books membership/content reload so `App` skips the
 * welcome cover on the way back up: adding, removing or archiving a Book is
 * a My Books action, and landing on the start screen afterwards reads as
 * having lost the tap. Session-scoped, so a genuinely fresh launch (or
 * "erase all my data") still shows the cover.
 */
export const SKIP_COVER_KEY = "bb.skipCover";

/** Reload, keeping the user on My Books rather than the welcome cover. */
function reloadToMyBooks(): void {
  try {
    sessionStorage.setItem(SKIP_COVER_KEY, "1");
  } catch {
    // Storage denied (private-mode webviews throw rather than no-op) — the
    // reload still has to happen; the user just sees the cover on the way back.
  }
  window.location.reload();
}

/**
 * Reload after a **membership** change — skipped when storage is unwritable,
 * because `writeIds` then swallowed the change: there is nothing to reload
 * for, and the reload would throw away the storage notice, which lives in a
 * module flag precisely because storage is what's broken and can't carry it
 * across a navigation. Staying put leaves the library as it truly is, with
 * the banner saying why.
 *
 * `acceptUpdate` deliberately calls `reloadToMyBooks` directly instead: its
 * documents *did* land in IndexedDB, and only a reload starts serving them.
 */
function reloadAfterMembershipChange(): void {
  if (isStorageUnwritable()) {
    return;
  }
  reloadToMyBooks();
}

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
  /** Book ids currently in the private store (plan 0017 §3) — lets the view
   * layer ungate the ✎ Edit buttons and route to the private editor for a
   * private Book without re-reading IndexedDB itself. */
  privateBookIds: Set<string>;
  /** Creates a minimum-viable private Book + the Domain it exclusively owns
   * (plan 0017 §3), adds it to My Books, and reloads onto My Books. No
   * backend, no validation gate — a freshly created Book is deliberately
   * empty and gets fleshed out in the editor. */
  createPrivateBook(title: string): Promise<void>;
  /** Imports a private Book export (spec 0017-5 §3 rules 3+5): validates
   * `book`+`domain` against the user's already-added Books — a cross-Book
   * collision (duplicate item id or domain code) is refused, same dry-run
   * shape as `addBook` — then commits and reloads. The caller
   * (SettingsScreen) has already run the parse + kind/schemaVersion checks
   * and any replace-existing confirm before calling this. */
  importPrivateBook(
    bookId: string,
    book: BookDocument,
    domain: DomainDocument,
    assets: Record<string, Blob>,
  ): Promise<void>;
  /** Drops the Book from My Books (added or archived) and evicts its cache; reloads. Progress is untouched. */
  removeBook(bookId: string): Promise<void>;
  archiveBook(bookId: string): void;
  restoreBook(bookId: string): void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  string | undefined;

/**
 * Anon-key PostgREST fetch against any exposed view/table — shared by
 * `fetchCatalog` below and by `content/library.ts`'s Library browse (plan
 * 0015 decision 2), rather than each duplicating the endpoint/headers.
 */
export async function fetchRest(
  table: string,
  select: string,
  filter = "",
): Promise<unknown> {
  if (isOffline()) {
    // Throw rather than resolve empty: `checkForUpdate` already treats any
    // failure as "no update", and the Library — the only other caller — is
    // unreachable in offline mode, so nothing renders this message.
    throw new Error("offline mode is on");
  }
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${select}${filter}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`${table} request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchCatalog(select: string, filter = ""): Promise<unknown> {
  return fetchRest("catalog", select, filter);
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
 *
 * Unchanged by plan 0017: a private Book has no cached document, so it's
 * simply absent from `cached`/`byId` and never touched here.
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
 * seed in memory instead of ever appearing missing. A `bookId` present in
 * `privateById` (plan 0017 §4) resolves straight from that record instead —
 * no cache lookup, never reported missing.
 *
 * `extraStems` (spec 0012-B §4b) widens `allAssetStems()` for this one call
 * only — `addBook`'s dry run needs its not-yet-registered new Book's freshly
 * listed Storage assets included, since nothing has downloaded (and so
 * registered) them yet. Every other caller omits it and is unaffected.
 *
 * Exported for `source.test.ts`'s direct `extraStems` coverage — every
 * other caller reaches it only through `addBook`/`acceptUpdate`, which need
 * a full IndexedDB + network stack to exercise.
 */
export function buildMembers(
  cachedById: Map<string, CachedDocument>,
  bookIds: string[],
  privateById: Map<string, PrivateBookRecord>,
  extraStems?: AssetStems,
): { built: DocumentContentSource; missing: string[] } {
  const books = new Map<string, BookDocument>();
  const domains = new Map<string, DomainDocument>();
  const missing: string[] = [];
  for (const bookId of bookIds) {
    const privateRec = privateById.get(bookId);
    if (privateRec !== undefined) {
      books.set(bookId, privateRec.book);
      domains.set(rawDomainId(privateRec.book), privateRec.domain);
      continue;
    }
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
  const stems =
    extraStems === undefined
      ? allAssetStems()
      : mergeAssetStems(allAssetStems(), extraStems);
  const built = createDocumentContentSource(books, domains, stems);
  return { built, missing };
}

/**
 * Cached versions of exactly the added+archived Books' documents — what
 * `planUpdate` scopes update-checking to (decision 11). Unchanged by plan
 * 0017: a private Book has no cached document and no catalog row, so `rec`
 * is `undefined` for it and it's skipped here too.
 */
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

  const privateRecords = await readPrivateBooks();
  registerPrivateAssets(privateRecords);
  registerRemoteAssets(cached);
  const privateById = new Map(privateRecords.map((rec) => [rec.id, rec]));

  const { built, missing } = buildMembers(cachedById, added, privateById);
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
    privateBookIds: new Set(privateById.keys()),

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
      //
      // Storage listings are fetched at most once per document id per
      // accept (spec 0012-B §3/§6): the validation loop below needs one to
      // widen the dry run's stem inventory, and the download loop right
      // after needs the very same listing to decide what to fetch — this
      // cache is how "reuse the listing" actually happens rather than just
      // being a comment.
      const listingsByDocId = new Map<string, RemoteAsset[]>();
      async function listing(docId: string): Promise<RemoteAsset[]> {
        const cached = listingsByDocId.get(docId);
        if (cached !== undefined) {
          return cached;
        }
        const fetched = await listDocumentAssets(docId);
        listingsByDocId.set(docId, fetched);
        return fetched;
      }

      const failedAffected: string[] = [];
      const errorsByFailedBook = new Map<string, string[]>();
      for (const bookId of affected) {
        const newDoc = effectiveTopicDoc(bookId);
        if (newDoc === undefined) {
          continue; // already broken-missing — not this accept's concern
        }
        const newDomainId = rawDomainId(newDoc);

        // Only this Book's *changed* documents get a fresh Storage listing
        // (spec 0012-B §6: "the stems just listed for the documents in
        // that dry run") — the rest of the member set's stems come from
        // bundled/private only, same as before this spec; their own
        // already-registered remote stems are last boot's state, not this
        // accept's concern, and a stale mismatch here only weakens this
        // discarded dry run's cross-Book check, never causes a false
        // rejection (the real source rebuilds from `allAssetStems()` at
        // next boot).
        const changedDocIds = [
          ...(downloaded.has(documentId("topic", bookId))
            ? [documentId("topic", bookId)]
            : []),
          ...(newDomainId !== "" &&
          downloaded.has(documentId("domain", newDomainId))
            ? [documentId("domain", newDomainId)]
            : []),
        ];
        const listingEntries: { documentId: string; assets: RemoteAsset[] }[] =
          [];
        let listingFailed = false;
        for (const docId of changedDocIds) {
          try {
            listingEntries.push({
              documentId: docId,
              assets: await listing(docId),
            });
          } catch {
            listingFailed = true;
            break;
          }
        }
        if (listingFailed) {
          failedAffected.push(bookId);
          errorsByFailedBook.set(bookId, [
            "could not check this book's assets — try again later",
          ]);
          continue;
        }

        const books = new Map<string, BookDocument>();
        const domains = new Map<string, DomainDocument>();
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
        const dryRunStems = mergeAssetStems(
          mergeAssetStems(bundledAssetStems(), privateAssetStems()),
          assetStemsFromListing(listingEntries),
        );
        const dryRunX = createDocumentContentSource(
          books,
          domains,
          dryRunStems,
        );
        const ownFailure = dryRunX.broken.find((b) => b.bookId === bookId);
        if (ownFailure !== undefined) {
          failedAffected.push(bookId);
          errorsByFailedBook.set(bookId, ownFailure.errors);
        }
      }

      // Download blobs for every Book that passed validation (spec
      // 0012-B §3), one Storage listing per distinct document id — not per
      // Book, because a changed domain doc can back several member Books
      // at once — reusing the very listing the validation loop above
      // already fetched. A download failure fails only the Book(s) that
      // document belongs to, routed into the same `failedAffected` list a
      // validation failure uses, so one Book's bad asset never blocks
      // another Book's update.
      const docsToDownload = new Map<string, string[]>(); // docId -> referencing book ids
      for (const bookId of affected) {
        if (failedAffected.includes(bookId)) {
          continue;
        }
        const newDoc = effectiveTopicDoc(bookId);
        if (newDoc === undefined) {
          continue; // already broken-missing — not this accept's concern
        }
        const newDomainId = rawDomainId(newDoc);
        const topicDocId = documentId("topic", bookId);
        if (downloaded.has(topicDocId)) {
          docsToDownload.set(topicDocId, [
            ...(docsToDownload.get(topicDocId) ?? []),
            bookId,
          ]);
        }
        if (newDomainId !== "") {
          const domainDocId = documentId("domain", newDomainId);
          if (downloaded.has(domainDocId)) {
            docsToDownload.set(domainDocId, [
              ...(docsToDownload.get(domainDocId) ?? []),
              bookId,
            ]);
          }
        }
      }

      const downloadedAssetsByDocId = new Map<string, Record<string, Blob>>();
      for (const [docId, referencingBooks] of docsToDownload) {
        try {
          const entries = await listing(docId);
          const previousBlobs = cachedById.get(docId)?.assets;
          const assets: Record<string, Blob> = {};
          for (const asset of entries) {
            const previousBlob = previousBlobs?.[asset.stem];
            const reuse = canReuseBlob(
              { size: asset.size, lastModified: asset.lastModified },
              previousAssetMeta(previousBlob),
            );
            assets[asset.stem] =
              reuse && previousBlob !== undefined
                ? previousBlob
                : await downloadRemoteAsset(asset);
          }
          downloadedAssetsByDocId.set(docId, assets);
        } catch {
          for (const bookId of referencingBooks) {
            if (!failedAffected.includes(bookId)) {
              failedAffected.push(bookId);
              errorsByFailedBook.set(bookId, [
                "could not download this book's assets — try again later",
              ]);
            }
          }
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
        const cachedDoc = toCachedDocument(row);
        const assets = downloadedAssetsByDocId.get(row.id);
        if (assets !== undefined) {
          cachedDoc.assets = assets;
        }
        toCommit.push(cachedDoc);
      }

      if (toCommit.length > 0) {
        await putCachedDocuments(toCommit);
        // Not `reloadAfterMembershipChange`: these documents *did* land in
        // IndexedDB, and the running app keeps serving the old in-memory
        // source until a reload — so this one happens even when a write
        // elsewhere has already failed.
        reloadToMyBooks();
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
      // Whether `rows` actually came off the catalog (true "online, both
      // documents found") vs. falling back to the bundled `demo` seed
      // below — the asset download pass only runs for the former: the
      // seed's assets are bundled files, not Storage objects, and this
      // fallback is `demo`'s offline-Add path (decision 3), which must
      // keep working with no network at all.
      const fetchedFromCatalog = rows !== undefined && rows.length === 2;
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

      // List (not yet download) the new Book's assets before validating
      // (spec 0012-B §4b): the dry run below needs these stems, since
      // nothing has downloaded — and so registered — them yet. Reused for
      // the actual download further down, so this is the only listing
      // call. Skipped for the demo-seed fallback: bundled files, not
      // Storage objects.
      let listingByDocId: Map<string, RemoteAsset[]> | undefined;
      if (fetchedFromCatalog) {
        try {
          listingByDocId = new Map(
            await Promise.all(
              newDocs.map(
                async (doc) =>
                  [doc.id, await listDocumentAssets(doc.id)] as const,
              ),
            ),
          );
        } catch {
          throw new Error(
            "could not add this book — check your connection and try again",
          );
        }
      }
      const extraStems =
        listingByDocId !== undefined
          ? assetStemsFromListing(
              [...listingByDocId].map(([docId, assets]) => ({
                documentId: docId,
                assets,
              })),
            )
          : undefined;

      // Dry-run against the current added Books, the new Book appended
      // last (decision 11a: earliest wins, so an introduced collision
      // rejects only the new Book — existing content untouched).
      const freshCached = await readCachedDocuments();
      const dryRunById = new Map(freshCached.map((d) => [d.id, d]));
      for (const doc of newDocs) {
        dryRunById.set(doc.id, doc);
      }
      const currentAdded = readMyBooks();
      const { built: dryRun } = buildMembers(
        dryRunById,
        [...currentAdded.filter((id) => id !== bookId), bookId],
        privateById,
        extraStems,
      );
      const rejection = dryRun.broken.find((b) => b.bookId === bookId);
      if (rejection !== undefined) {
        throw new Error(
          `can't add this book: ${rejection.errors[0] ?? "content conflict"}`,
        );
      }

      // Download every asset of both fetched documents, all-or-nothing
      // (spec 0012-B §3): any download failure leaves the cache untouched
      // and surfaces through the same message a fetch failure already
      // uses. `freshCached` (read above) doubles as the carry-forward
      // source — never happens here in practice (this Book wasn't cached
      // before), but kept for symmetry with `acceptUpdate`.
      if (listingByDocId !== undefined) {
        const freshCachedById = new Map(freshCached.map((d) => [d.id, d]));
        try {
          for (const doc of newDocs) {
            const entries = listingByDocId.get(doc.id) ?? [];
            const previousBlobs = freshCachedById.get(doc.id)?.assets;
            const assets: Record<string, Blob> = {};
            for (const asset of entries) {
              const previousBlob = previousBlobs?.[asset.stem];
              const reuse = canReuseBlob(
                { size: asset.size, lastModified: asset.lastModified },
                previousAssetMeta(previousBlob),
              );
              assets[asset.stem] =
                reuse && previousBlob !== undefined
                  ? previousBlob
                  : await downloadRemoteAsset(asset);
            }
            doc.assets = assets;
          }
        } catch {
          throw new Error(
            "could not add this book — check your connection and try again",
          );
        }
      }

      await putCachedDocuments(newDocs);
      addToMyBooks(bookId);
      reloadAfterMembershipChange();
    },

    async createPrivateBook(title: string): Promise<void> {
      const bookId = newPrivateId();
      const domainId = newPrivateId();
      // Load-bearing (plan 0017 §3): every non-Book entity id must start
      // with "<book.code>-", and a domain's code must be globally unique
      // across every added Book. The book UUID's first 8 hex characters
      // (before its first hyphen) is itself a valid slug and, at 16^8
      // possibilities, cannot practically collide with another private
      // Book's code or a shipped Book's short code (e.g. "dx", "ky").
      const code = bookId.slice(0, 8);
      const book: BookDocument = {
        topic: {
          id: bookId,
          code,
          title,
          domainId,
          lessonIds: [],
          description: "",
        },
        lessons: [],
        units: [],
        items: [],
        tasks: [],
        resources: [],
        notes: [],
      };
      const domain: DomainDocument = {
        domain: {
          id: domainId,
          code,
          kind: "general",
          title,
          glossLanguage: "en",
        },
        entries: [],
        families: [],
      };
      await putPrivateBook({ id: bookId, book, domain, assets: {} });
      addToMyBooks(bookId);
      reloadAfterMembershipChange();
    },

    async importPrivateBook(
      bookId: string,
      book: BookDocument,
      domain: DomainDocument,
      assets: Record<string, Blob>,
    ): Promise<void> {
      // Dry-run against the current added Books, the imported Book appended
      // last (mirrors addBook/createPrivateBook: earliest wins, so an
      // introduced collision rejects only the imported Book — existing
      // content untouched). Replacing an existing private Book: overwriting
      // `bookId`'s entry in `dryRunPrivateById` below means the OLD version
      // is never part of the dry run, so it can't collide with the new one.
      const freshCached = await readCachedDocuments();
      const cachedById = new Map(freshCached.map((d) => [d.id, d]));
      const freshPrivate = await readPrivateBooks();
      const dryRunPrivateById = new Map(
        freshPrivate.map((rec) => [rec.id, rec]),
      );
      dryRunPrivateById.set(bookId, {
        id: bookId,
        book,
        domain,
        assets,
        updatedAt: 0,
      });
      const currentAdded = readMyBooks();
      const { built: dryRun } = buildMembers(
        cachedById,
        [...currentAdded.filter((id) => id !== bookId), bookId],
        dryRunPrivateById,
      );
      const rejection = dryRun.broken.find((b) => b.bookId === bookId);
      if (rejection !== undefined) {
        // Spec 0017-5 §3 rule 3: "show the error list" — every validation
        // error for this Book, not just the first (unlike addBook/
        // acceptUpdate, which only ever report one book's headline error
        // because they always have other, unaffected books to fall back on).
        const detail =
          rejection.errors.length > 0
            ? rejection.errors.join("; ")
            : "content conflict";
        throw new Error(`can't import this book: ${detail}`);
      }

      await putPrivateBook({ id: bookId, book, domain, assets });
      addToMyBooks(bookId);
      reloadAfterMembershipChange();
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

      if (privateById.has(bookId)) {
        // A private Book has no cached document — purgeUnmembered-style
        // sweeps can't reach it by design (plan 0017 §2/§5) — so deleting
        // its own record is the only thing that actually removes it.
        await deletePrivateBook(bookId);
      } else {
        const toDelete = [documentId("topic", bookId)];
        if (domainId !== "" && !domainStillReferenced) {
          toDelete.push(documentId("domain", domainId));
        }
        await deleteCachedDocuments(toDelete);
      }
      reloadAfterMembershipChange();
    },

    archiveBook(bookId: string): void {
      archiveInMembership(bookId);
      reloadAfterMembershipChange();
    },

    restoreBook(bookId: string): void {
      restoreInMembership(bookId);
      reloadAfterMembershipChange();
    },
  };
}
