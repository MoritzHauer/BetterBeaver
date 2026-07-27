# Plan 0017: Private Books (local-only authoring, export/import)

Status: **designed** · Owner: Moe · Date: 2026-07-27 · Direction pinned by a 10-question grilling session (2026-07-27), over a three-agent seam audit of the content source, cache, editor and PWA layers

## Purpose

Every Book today comes from the Supabase catalog: authored by a signed-in maintainer, published to a public catalog, downloaded by learners through the Library. There is no way to make a Book that stays on your device — for material that is personal, unfinished, licence-encumbered, or simply nobody else's business.

This plan adds **private Books**: created and edited on-device, never synced to any backend, studied through the exact same screens as a public Book, and shareable only as an explicit file the user hands to someone.

The second-order benefit is that private Books are the first content that works end-to-end with **no backend at all** — including inside offline mode, where the entire authoring path is reachable because nothing in it touches the network.

## Goals

After this plan: a learner taps "Create a Book" on My Books, names it, and edits it with the same form editor maintainers use — lessons, units, items, tasks, notes, lexicon entries, families. The Book appears in My Books alongside public Books, marked private, and is studied identically (Practice, Daily Review, Vocabulary, pinning, SRS). It can carry its own audio and images. It exports to a single `.bbbook` file and imports on any other device. It never appears in the Library, never reaches Supabase, and no cache sweep can destroy it by accident.

## Non-goals

- **No sync, ever.** A private Book has no backend row, no `published_version`, no update check, no proposals, no votes, no chat. Sharing is a file the user moves themselves.
- **No publishing path.** "Promote my private Book to the public catalog" is not in scope. It is a plausible follow-up, and nothing here forecloses it, but the conversion (id rewrite, asset upload, maintainer grant) is its own design.
- **No Library presence.** Private Books are invisible to the catalog and to every other user.
- **No collaborative editing.** One device is the source of truth. Two people editing the same exported Book fork it; there is no merge.
- **No progress-sync interaction.** `specs/0012-progress-sync.md` remains unimplemented; when it lands, private Book progress rides the same `bb.item.<id>` keys as everything else and needs no special handling (ids are UUID-unique, so they cannot collide across devices).

## Design decisions (from the 2026-07-27 grilling)

| # | Decision | Rationale |
|---|---|---|
| 1 | **In-app authoring**, not import-only | A learner cannot hand-write a `BookDocument`. Anything less means private Books are an owner-only feature. |
| 2 | A private Book **always owns its own Domain** | Export is self-contained by construction; import can never dangle. Cost: a word known in the public Kyrgyz Book gets a second, independent SRS state here. Accepted. |
| 3 | Private documents live in a **separate IndexedDB store** | Not a provenance flag. See §2 — three existing sweeps wipe the shared store, one of them (`Refresh content`) while promising it is safe. Safety by construction, not by every future sweep remembering a boolean. |
| 4 | Ids are **bare generated UUIDs** (`crypto.randomUUID()`) | Collision-proof across independently-authored private Books swapped as files — the case a readable slug convention loses. A UUID satisfies `slugPattern` (`entities.ts:7`, verified) and does not start with `user-`, so it passes class (y) untouched: **no schema change at all**. |
| 5 | **Additive-only schema policy** for private content | There is no admin republish for content that exists on one device. Written into the `CONTENT_SCHEMA_VERSION` bump rule. |
| 6 | Entry point is a **"Create a Book" card on My Books**; editing reuses the existing ✎ deep-links | Always visible (unlike the Library card, which hides without a backend). Reuses the pattern learners already see. |
| 7 | **Runtime asset store** — private Books carry their own audio/images | A language Book without audio is weak. This also becomes the foundation `specs/0012-asset-pipeline.md` reuses rather than a competing mechanism. |
| 8 | Export is a **single JSON file**, assets base64-inlined, extension `.bbbook` | One self-contained file, no new dependency, works with the file-picker import Settings already uses, stays inspectable. |
| 9 | Remove is a **permanent delete behind an export-first confirm** | Uniform card actions, but the confirm text must branch — today's copy actively lies for private Books. |
| 10 | Import onto an existing id **replaces**, behind a confirm | Same UUID = same Book identity. Never silently forks a duplicate. |

## Design

### 1. Why the content source needs almost no change

`createDocumentContentSource(bookDocs, domainDocs, assets)` (`packages/engine/src/documentSource.ts:139`) is already provenance-blind: it takes two `Map`s and validates whatever it is handed. Bundled, backend-cached and private documents are indistinguishable inputs to it.

The single assembly point is `buildMembers` (`apps/web/src/content/source.ts:220`), which today resolves every non-bundled document out of one IndexedDB store. It gains a merge step: private documents are read from the private store and folded into the same `books`/`domains` maps before the call. Nothing downstream — `App.tsx`, every screen, the SRS, pinning, Vocabulary — changes at all.

### 2. Why a separate store, concretely

Three existing code paths sweep the shared `bb-content` / `documents` store:

| Path | Today | With private docs in the same store |
|---|---|---|
| `clearCachedDocuments()` from **Refresh content** (`SettingsScreen.tsx:302`) | Wipes the store, re-downloads from backend. Status text: *"Clears cached lessons and re-downloads. Your progress is not affected."* | **Silently destroys every private Book**, while telling the user nothing is at risk |
| `purgeUnmembered()` on Remove (`content/source.ts:188`) | Drops docs for un-added Books; harmless, they re-download | Destroys the only copy |
| `eraseAllData()` (`progress/backup.ts:65`) | Wipes everything, explicit confirm | Correct — should take private Books too |

Only the third is right. A new object store `private` in the same `bb-content` database is unreachable from all three by construction; `eraseAllData` clears it explicitly.

### 3. Storage shape

```ts
// apps/web/src/content/private-store.ts  (new)
export interface PrivateBookRecord {
  id: string;                    // crypto.randomUUID(), the Book id
  book: BookDocument;
  domain: DomainDocument;
  assets: Record<string, Blob>;  // asset stem -> blob
  updatedAt: number;             // Date.now() at write
}
```

One record per private Book, holding its Book, its own Domain and its assets together — so export is a serialisation of one record, and delete is one key.

Note markdown is **not** a separate field: `BookDocument.notes` already carries it inline (`documents.ts:61`), and duplicating it would create two sources of truth. Assets are the only thing that needs its own home, because `BookDocument` deliberately holds no asset bytes (`documents.ts:5`).

### 4. Runtime assets

Today `AssetStems` and `getAssetUrl` come from build-time `import.meta.glob` (`content/bundled.ts:44-49`), and validation **hard-fails** on a dangling `audioRef`/`imageRef` (`validate.ts:607-617`). Private assets must therefore be resolvable before validation runs.

- `bundled.ts`'s asset accessors gain a runtime overlay: stems contributed by private Books are appended to `audioStems`/`imageStems`, and `getAssetUrl` resolves them to `URL.createObjectURL(blob)`.
- Object URLs are created once per session at content-source build and revoked on teardown. (ponytail: a per-session map, not a cache with eviction — a private library is small; revisit if a real user hits memory pressure.)
- The private editor's asset picker writes the `Blob` straight into the record; the stem is `user-<uuid>` too, so it cannot collide with a bundled stem.

**This is the layer `specs/0012-asset-pipeline.md` should build on** — that spec's backend half (upload to Supabase Storage, download into the cache) plugs into the same runtime resolution rather than inventing a parallel one. Update that spec to say so.

### 5. The editor: a third shell, not a new editor

`EditScreen.tsx` is already **I/O shell + pure editor**:

- `ProposeEditScreen` (`:404`) and `MaintainEditScreen` (`:733`) each hold `working` state and own every Supabase call (`loadDocument`, `saveDraft`, `publishDocument`, `loadCatalogEntry`, `submitProposal`).
- `BookEditor` (`:1332`), `DomainEditor` (`:1785`), `Field`/`EntityForm`/`IdListField`/`AddEntityForm` are props-in/props-out with no backend knowledge.
- `emptyDocFor(kind)` (`:1137`) already builds a blank document.

So `PrivateEditScreen` is a third shell over the same two editors, with local I/O: load from the private store, autosave to it directly (no Sync/Publish distinction — there is no server draft), validate with the same `validateContent`. Full editing parity is therefore also the smallest diff.

Reachability: the ✎ Edit deep-links on the book/lesson/unit/question screens currently render only when `isAuthor` (a Supabase session exists, `App.tsx:625`). They must also render, unconditionally, when the Book being viewed is private.

### 6. Ids

Every id a private Book generates — book, domain, lessons, units, items, tasks, resources, entries, families, asset stems — is a bare `crypto.randomUUID()`.

Two properties, both verified rather than assumed:

- `slugPattern` is `/^[a-z0-9]+(-[a-z0-9]+)*$/` (`entities.ts:7`). A UUID is lowercase hex in hyphen-separated segments, so it satisfies every `slugSchema` field.
- Class (y) (`validate.ts:813-841`) rejects ids starting with `user-`. A bare UUID does not, so **private content passes the existing validator unmodified** — no `private` flag on `validateContent`, no inverted rule, no schema work.

Collision safety comes from the UUID itself, and covers the case a readable convention cannot: two people independently authoring private Books and swapping files. That also means no `bb.item.<id>` SRS collision, on one device or across an import.

### 7. Export / import

```jsonc
// mydeck.bbbook
{
  "kind": "bb-private-book",
  "formatVersion": 1,
  "schemaVersion": 1,          // CONTENT_SCHEMA_VERSION at export time
  "book": { /* BookDocument */ },
  "domain": { /* DomainDocument */ },
  "notes": { "<stem>": "markdown" },
  "assets": { "<stem>": "data:audio/wav;base64,..." }
}
```

Import validates with the same `validateContent`/`validateContentSet` against the user's already-added set, refuses on error with the error list shown, and on an existing Book id asks to replace. A `schemaVersion` newer than the running app is refused with "update the app first" — the same posture as the existing catalog skew check.

ponytail ceiling: the whole file is one JSON string in memory. Fine to roughly 20 MB; if real Books outgrow that, switch to a zip and add the dependency then.

### 8. Lifecycle in My Books

- The card shows a `private` marker and no rating (there are no votes).
- Archive/Restore behave as today.
- **Remove** branches: for a private Book the confirm names the deletion as unrecoverable and offers Export first. Today's copy — *"Your learning progress is kept, and restored if you add it again"* (`MyBooksScreen.tsx:61`) — is false for private Books and must not be shown for them.
- Progress (`bb.item.<id>`) survives removal exactly as for public Books; it is the content that is gone.

## Schema changes (`packages/schema`)

- **No code changes.** UUID ids pass `slugSchema` and class (y) unmodified (§6).
- One comment only: `documents.ts`'s `CONTENT_SCHEMA_VERSION` bump-rule gains the additive-only-for-private policy (decision 5).
- No `CONTENT_SCHEMA_VERSION` bump — no entity schema changes at all.

## Engine changes (`packages/engine`)

- **No code changes.** `createDocumentContentSource` is provenance-blind, and `AssetStems` is already a *parameter* of it (`documentSource.ts:64`), not something the engine imports — so the runtime overlay is assembled in `apps/web` and passed in exactly as the bundled maps are today. Verified, because §4 depends on it.
- One comment only: `AssetStems`' doc comment (`documentSource.ts:59-63`) currently asserts that stems "always come from the bundled asset maps — regardless of where the documents themselves came from". That invariant stops being true; update it to say stems may also come from the private store.

## Web changes (`apps/web`)

- `content/private-store.ts` (new) — IndexedDB `private` object store, CRUD over `PrivateBookRecord`.
- `content/source.ts` — `buildMembers` merges private records; `initContentSource` exposes create/delete/import/export.
- `content/bundled.ts` — runtime asset overlay on `AssetStems` / `getAssetUrl`.
- `screens/EditScreen.tsx` — `PrivateEditScreen` shell; asset picker.
- `screens/MyBooksScreen.tsx` — "Create a Book" card, private marker, branched Remove confirm.
- `screens/SettingsScreen.tsx` — Import a Book…; per-Book Export.
- `App.tsx` — private-edit screen wiring; ✎ Edit ungated for private Books.
- `progress/backup.ts` — `eraseAllData` clears the private store too.

## Docs

- `docs/design.md` — requirement paragraph + decision rows for 2, 3, 4, 5, 7.
- `docs/STATUS.md` — plan row; note that `specs/0012-asset-pipeline.md` now builds on §4.
- `docs/specs/0012-asset-pipeline.md` — amend to reuse the runtime asset layer.
- `ToDo.md` — tick "creating private book".

## Implementation order (each step delegable; `pnpm check` green after every step)

1. **Store** — `private-store.ts` (IndexedDB `private` object store, CRUD over `PrivateBookRecord`), UUID id generation, unit tests. No schema work, no UI.
2. **Read path** — `buildMembers` merges private records; a hand-seeded private Book appears in My Books and is fully studiable. Runtime asset overlay.
3. **Create + edit** — "Create a Book" card, `PrivateEditScreen`, ✎ ungating.
4. **Assets in the editor** — picker, blob storage, stem generation.
5. **Export / import** — file shape, validation on import, replace-on-conflict.
6. **Lifecycle polish** — private marker, branched Remove confirm, `eraseAllData` coverage.

## Done-criteria

1. `corepack pnpm check` green.
2. Unit tests over the **pure** logic only — a generated UUID id passes `slugSchema` and `validateContent` unmodified; export serialisation round-trips; import rejects a newer `schemaVersion`; import replaces on an existing Book id. IndexedDB itself is browser-verified, not unit-tested: jsdom has no IndexedDB, and `cache.ts` has never had unit tests for the same reason. No `fake-indexeddb` dependency.
3. Browser pass via the `apps/web:verify` skill: create a Book from scratch, author a unit with one audio item, study it (Practice grades it, it enters Daily Review), export it, erase it via Remove (confirm names it unrecoverable), re-import the file, confirm progress reattaches to the same `bb.item.<id>` keys.
4. **Refresh content and Remove-a-public-Book both leave the private Book intact** — the regression this plan's storage choice exists to prevent.
5. The whole flow works with offline mode on and with no backend configured.

## Open questions

None. Decisions 1-10 close the design.

Resolved while writing: `hasCoverArt` is **hidden in the private editor for v1**. Its asset-path convention is `art/icons/<book.id>.png` in the app's *public* assets, which a private Book cannot write to, so the toggle could only ever produce a silently-missing image. Revisit once §4's runtime overlay exists — it is the natural home for a private cover.
