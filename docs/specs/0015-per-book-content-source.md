# Spec 0015-4: Per-Book content source (My Books membership, fetch-on-add, Archive/Remove, per-Book validation)

Normative source: [plan 0015](../plans/0015-library-marketplace.md) decisions 2, 3, 9, 11, 11a, 12, 15. Requires spec 0015-1 (rename) landed — post-rename identifiers throughout. This spec replaces the whole-catalog sync model; screens consuming the new API are spec 0015-5 (build the API here exactly as written so 0015-5 can call it).

## Membership store — new `apps/web/src/content/myBooks.ts`

`localStorage` keys (JSON string arrays of bare book ids, insertion-ordered — order is normative, it breaks 11a collision ties):

- `bb.mybooks` — added Books (the front list, in add order).
- `bb.mybooks.archived` — archived Books.

A Book id appears in at most one of the two. Exported helpers: `readMyBooks()`, `readArchived()`, plus mutators used by the API below. Absence of the `bb.mybooks` key (not empty-array) is the **first-run signal** (decision 9/12).

## Cache — `apps/web/src/content/cache.ts`

Add per-document operations alongside the existing whole-replace:

- `putCachedDocuments(docs: CachedDocument[])` — upsert without clearing.
- `deleteCachedDocuments(ids: string[])` — delete by id (kind-prefixed ids, e.g. `topic:kyrgyz`).

Existing `replaceCachedDocuments`/`readCachedDocuments` stay.

## Engine — `packages/engine/src/documentSource.ts`

1. **`createDocumentContentSource` stops throwing for per-Book failures.** New return shape adds `broken: { bookId: string; errors: string[] }[]`. Per-Book validation (a Book = its book document + its domain document) collects errors into `broken` and excludes that Book from the built source instead of throwing. `validateContentSet`'s cross-document checks run over the per-Book-valid Books; on a cross-Book collision, the earliest Book wins and later ones (by the input `Map`s' insertion order, which callers build in membership order) move to `broken`. `ContentValidationError` is still thrown only when the _caller_ asks (see seed rule below) — simplest: the function never throws; callers inspect `broken`.
2. **`planUpdate`**: `ContentUpdate` loses `removedIds` entirely (decision 11 — catalog removal is no longer acted on). `changed` and `appOutdated` are computed only over catalog rows whose id is a key of `cachedVersions` (the caller passes only member documents' versions — see below). Update the doc comments to plan 0015.

## Boot — `apps/web/src/content/source.ts` (`initContentSource`)

1. **First run** (`bb.mybooks` key absent): write the bundled seed's onboarding documents (`topic:demo`, `domain:demo`) into the cache **if absent** (never overwrite existing records — existing installs may hold newer versions), with `version: 0` and the seed's schema version; set `bb.mybooks = ["demo"]`, `bb.mybooks.archived = []`. Then (same boot) **purge**: delete every cached document not referenced by membership — i.e. keep exactly: `topic:<id>` for each added/archived Book, plus `domain:<id>` for each domain referenced by a kept book document. This is decision 12's one-time fresh start for existing installs; on a genuinely fresh install it's a no-op.
2. **Every boot**: build the source from cached documents of **added** Books only (archived Books stay cached but are _not_ loaded — not studiable, not in vocabulary/review — until restored). Build the input `Map`s in `bb.mybooks` order. `broken` Books (validation failure **or** membership entry whose cached documents are missing) are surfaced in the returned `ContentInit` (below) — boot never wipes the cache and never throws for them. Exception: if the _onboarding_ Book (`demo`) is broken while coming from the seed write path, rethrow to the developer error screen exactly as today's seed-validation failure.
3. The old "discard entire invalid cache" path disappears (superseded by per-Book `broken`); the seed fallback remains only for a completely unreadable IndexedDB (`readCachedDocuments` → `[]` with the membership key present → all member Books surface as broken-missing, onboarding Book rebuilt from seed per its offline-add rule).

## API — extend the returned `ContentInit`

```ts
interface ContentInit {
  result: { source: ContentSource } | { errors: string[] };
  /** Added Books that failed to load: validation errors or missing cache docs. For 0015-5's broken card. */
  broken: { bookId: string; errors: string[] }[];
  checkForUpdate(): Promise<ContentUpdate | null>; // unchanged signature; now member-scoped, no removedIds
  acceptUpdate(update: ContentUpdate): Promise<void>;
  addBook(bookId: string, domainId: string): Promise<void>;
  removeBook(bookId: string): Promise<void>;
  archiveBook(bookId: string): void;
  restoreBook(bookId: string): void;
}
```

- **`addBook`**: fetch from the `catalog` view (existing `fetchCatalog` helper) the rows `topic:<bookId>` and `domain:<domainId>` with full `published` JSON; dry-run validate the new Book against the current member set (per-Book + cross-set — an introduced collision **rejects the add** with an error, existing content untouched, decision 11a); `putCachedDocuments` both docs (real `published_version`); append to `bb.mybooks`; `window.location.reload()` (same post-mutation pattern as today's `acceptUpdate`). Offline/failed fetch: throw with a human-readable message, membership untouched (decision 15) — **except** the onboarding Book, which falls back to the bundled seed documents when the network fetch fails.
- **`removeBook`**: drop the id from both membership lists; `deleteCachedDocuments` of its `topic:` doc and of its `domain:` doc **iff** no other added/archived Book's cached book document references that domain; reload. (Progress in `localStorage` is untouched — never delete `bb.*` progress keys.)
- **`archiveBook`** / **`restoreBook`**: move the id between the two lists; reload. No cache changes.
- **`checkForUpdate`**: as today, but `cachedVersions` passed to `planUpdate` contains only documents belonging to added+archived Books.
- **`acceptUpdate`**: download changed rows as today; then validate and commit **per Book**: group changed docs by Book (a changed domain doc belongs to every member Book referencing it), dry-run each affected Book with its new docs against the rest; Books that validate commit via `putCachedDocuments`, Books that fail keep their old docs and are reported in the thrown error message (list per-Book first errors); commit what passed even when some fail, then reload (if anything committed).

## Done criteria

1. `corepack pnpm check` green.
2. Engine unit tests (extend the existing `documentSource`/`planUpdate` tests): per-Book `broken` on single-Book validation failure; cross-Book collision excludes the later Book; `planUpdate` ignores catalog rows absent from `cachedVersions` and no longer reports removals.
3. Web-side unit tests where the existing test seams allow (the repo tests engine logic headlessly; don't build an IndexedDB mock harness if one doesn't already exist — `pnpm check` plus the engine tests carry this spec, and 0015-5's browser verification covers the flows end-to-end).
4. `apps/web` compiles with `App.tsx` minimally adapted: it must keep working with the new `ContentInit` shape (ignore `broken`, don't render new UI — that's 0015-5). The update banner keeps functioning (now member-scoped automatically).

## Out of scope / no decisions open

Library browse fetch + all new UI (0015-5); seed shrink (0015-6). Every behavioral rule you need is written above or in plan 0015 — if two readings survive, the plan's decision text wins; do not invent behavior.
