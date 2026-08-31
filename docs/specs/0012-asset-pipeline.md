# Spec: Asset pipeline (Supabase Storage)

Implements the plan 0012 §2 deferral: assets leave the frozen bundled state so editing can add audio/images. Self-contained per the `/delegate` convention; make no new design choices.

**Revised 2026-07-30** after an owner grilling. The original spec predated plan 0015 (per-Book add/accept/remove), plan 0017 (private Books, which built the runtime asset overlay this now reuses) and the 2026-07-28 `EditScreen` split. Three of its mechanisms are deliberately reversed — the async `getAssetUrl` ripple, the Cache API store, and "seed re-export of remote assets is out of scope". Where this document contradicts plan 0012 §2's wording, this document wins.

## Goal

Maintainers upload audio/image assets for their documents in the editor; published content may reference them; learners receive them with the same offline and all-or-nothing guarantees as documents. Bundled assets keep working unchanged (they remain the seed's assets), and private Books' assets (plan 0017 §4) keep working unchanged.

## Context (read first)

- `docs/plans/0012-content-backend-and-editing.md` §2 (assets frozen), §6 (update flow); `docs/plans/0017-private-books.md` §4 (the runtime asset overlay this extends).
- `apps/web/src/content/bundled.ts` — `bundledAssetStems`, `allAssetStems`, `getAssetUrl`/`getLexiconAssetUrl`. The resolution point.
- `apps/web/src/content/private-assets.ts` — 87 lines, the overlay to copy. Read it in full; the remote overlay is the same shape.
- `apps/web/src/content/cache.ts` (`CachedDocument`, `putCachedDocuments`, `deleteCachedDocuments`), `apps/web/src/content/idb.ts`.
- `apps/web/src/content/source.ts` — `addBook`, `acceptUpdate`, `removeBook`, `purgeUnmembered`, `toCachedDocument`.
- `apps/web/src/screens/edit/AssetsManager.tsx` — 229 lines, the component to widen.
- `apps/web/src/backend/publishCheck.ts`, `packages/engine/src/documentSource.ts` (`AssetStems`).
- Validator rules consuming stems: `packages/schema/src/validate.ts` (`TASK_REQUIRED_ASSET`, the dangling `audioRef`/`imageRef` checks around lines 601–670 and 789–800, and the `slugPattern` stem check at line 236).
- `scripts/export-content.ts`.

## Pinned design

### 1. Storage layout and policies

- One public-read bucket **`assets`**. Object key: `<kind>/<contentId>/audio/<objectName>` and `<kind>/<contentId>/img/<objectName>`, where `<kind>` is `topic` or `domain`. (The key uses `/` where the row id uses `:`; the mapping is `<kind>/<contentId> ↔ documentId(kind, contentId)`.)
- New migration `supabase/migrations/<date>_assets.sql`: create the bucket (public); RLS on `storage.objects` for bucket `assets`: `insert`/`update`/`delete` for authenticated where `public.is_maintainer((storage.foldername(name))[1] || ':' || (storage.foldername(name))[2])`; public read comes from the bucket being public. Bucket-level `file_size_limit` 10 MB, `allowed_mime_types` prefixes `audio/` and `image/`.
- Never modify an already-applied migration file; new migrations only.

### 2. Stems and display names

An asset has two names, and they are not the same string:

- **Stem** — what content references (`audioRef` / `imageRef`). Generated, never derived from the filename: `` `${bookCode}-${crypto.randomUUID()}` ``, exactly as `AssetsManager.tsx:149` already does for private Books. Collision-proof and matches `slugPattern` (`/^[a-z0-9]+(-[a-z0-9]+)*$/`).
- **Display name** — the original filename, shown in the UI. Never show a bare stem as an asset's title.

The name is carried **in the object key**, after the stem, separated by `__`:

```
assets/topic/kyrgyz/audio/ky-a1b2c3d4__salam-aleikum.mp3
                          └─ stem ──┘  └── name ─────┘
```

`slugPattern` forbids underscores, so the stem side can never contain one. This is why the name is not stored in Supabase custom metadata — `list()` returns only the system metadata column, and reading `user_metadata` would need one `info()` request per asset.

**The parse is exactly this, and nothing else** — the display name is not itself constrained, so do not infer the split from its shape:

```ts
const i = objectName.indexOf("__");
const stem = i === -1 ? stripExtension(objectName) : objectName.slice(0, i);
const name = i === -1 ? stem : objectName.slice(i + 2); // verbatim, may contain "__"
```

Sanitise the filename to `[A-Za-z0-9._-]`, replacing every other character with `-`, before appending it; the extension rides along inside the name. The charset deliberately keeps `_`, so a name may contain `__` of its own — harmless, because only the **first** occurrence splits and everything after it is taken verbatim. If nothing survives sanitising, write the key as `<stem>.<ext>` with no `__` at all, and the reader falls back to the stem for display (the `i === -1` branch above).

Private Books read the display name from `File.name` — a `File` survives IndexedDB structured-clone with `.name` intact — falling back to the stem when the stored value is a plain `Blob` (which is what a `.bbbook` round-trip produces; do **not** change the export format to carry names).

Renaming an asset is out of scope. Delete and re-upload.

### 3. Learner delivery: blobs inside the cached document record

Extend `CachedDocument` (`apps/web/src/content/cache.ts`):

```ts
export interface CachedDocument {
  id: string;
  kind: "topic" | "domain";
  version: number;
  schemaVersion: number;
  doc: BookDocument | DomainDocument;
  /** stem -> blob, downloaded at add/accept. Absent on records written before this spec: no remote assets. */
  assets?: Record<string, Blob>;
}
```

This is the shape `PrivateBookRecord` already uses, and it is load-bearing for the whole lifecycle — **do not move the blobs into their own object store.** Every eviction path already deletes by document id, so each of these needs _no new code_:

| Path                          | Behaviour, for free                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `removeBook`                  | `deleteCachedDocuments` drops the record; assets go with it                                                                                                                                                                                                                                                                  |
| `purgeUnmembered`             | same call, same effect                                                                                                                                                                                                                                                                                                       |
| Settings → Refresh content    | re-downloads through `acceptUpdate`; the commit replaces both documents and assets (this row said `clearCachedDocuments` wipes and the next sync re-downloads — the wipe half was removed 2026-08-24: after plan 0015 scoped syncing to cached documents, the next sync planned nothing and the wiped Books never came back) |
| `archiveBook` / `restoreBook` | membership only — assets survive, matching documents                                                                                                                                                                                                                                                                         |
| accept / add commit           | one `store.put` in one transaction: literally all-or-nothing                                                                                                                                                                                                                                                                 |

`DB_VERSION` stays at **2**. Adding a field to a record is not an IndexedDB schema change, and `assets === undefined` means "no remote assets", which is the correct reading of every pre-existing record.

**Carry-forward.** `putCachedDocuments` replaces the whole record, so a document-only edit would otherwise re-download a Book's entire audio set. Before writing a record, reuse the previous record's blob for a stem only when the new listing reports the **same `metadata.size` and the same `last_modified`**; download everything else. `acceptUpdate` already reads the old cache, so this is a lookup, not a new read.

**Fail towards re-downloading.** `FileObject`'s own type doc warns that "some fields may not be present in all API responses". If either comparison field is missing or `undefined` on a listing entry, **re-download that asset** — never treat two absent values as equal. A hollow comparison key would silently serve stale bytes after a maintainer replaces a file with a different one of the same size, which is a wrong-content bug rather than a slow one. (`eTag` was considered and rejected for the same reason: it is documented on `FileMetadata` but not guaranteed on `list()` results.)

### 4. Download timing: eager, all-or-nothing, per Book

Assets download at the two places that already fetch documents and are online by definition:

- **`addBook`** — after the dry-run validation passes and before `putCachedDocuments`.
- **`acceptUpdate`** — after per-Book document validation, for each Book that passed.

Download every asset of every affected document via its public URL. **Any download failure fails that Book**, routing its id into the existing `failedAffected` / rejection paths rather than committing a partial record — the same per-Book granularity plan 0015 established for documents, so one Book's bad asset never takes down another Book's update. `addBook` surfaces it through its existing `throw new Error("could not add this book — check your connection and try again")`.

This is what makes the offline promise literally true: a Book added on wifi plays its audio on a plane. There is **no progress UI** — Add already blocks behind its existing pending state, and a progress bar is its own scope.

Offline mode needs no new rule: `fetchRest` already throws and the Library is already hidden, so neither entry point is reachable.

### 5. Resolution stays synchronous

**Do not make `getAssetUrl`/`getLexiconAssetUrl` async, and do not touch their call sites.** The original spec's "mechanical ripple" through `SessionScreen`, `UnitScreen`, `VocabularyScreen` and `EntryPopup` is cancelled — plan 0017 proved the overlay approach works and buys the same thing for nothing.

Add `apps/web/src/content/remote-assets.ts`, a near-copy of `private-assets.ts`:

- `registerRemoteAssets(docs: CachedDocument[]): void` — revoke previously-created object URLs, then create one per asset blob, indexed by content id (a `topic:` record's assets index by book id, a `domain:` record's by domain id) and kind (`img` when `blob.type` starts with `image/`, else `audio`). Called once per boot from `initContentSource`, before the content source is built — alongside the existing `registerPrivateAssets` call.
- `remoteAssetStems(): AssetStems` — the registered stems in `AssetStems` shape.
- `getRemoteAssetUrl(id, kind, stem): string | undefined`.

Then in `bundled.ts`, extend the two resolvers' existing fallback chain and the merge helper:

```
getAssetUrl / getLexiconAssetUrl:
  private overlay -> remote overlay -> bundled glob -> undefined

allAssetStems():  bundled ∪ private ∪ remote     (reuse the existing `merge`)
```

Order matters: private first (a private Book's ids are UUIDs and cannot collide, but keeping 0017's precedence avoids reasoning about it), remote before bundled so a published replacement of a seeded asset wins.

### 6. Where validation gets its stem inventory

Three call sites, three sources — all three currently pass bundled-only stems and all three must widen:

| Path                                         | Inventory                                                             | On failure                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Startup (`source.ts:322`, `allAssetStems()`) | bundled ∪ private ∪ **cached records' `assets` keys**                 | never touches the network                                                   |
| Accept dry-run (`source.ts:561`)             | bundled ∪ private ∪ **the listing just fetched**                      | listing fetch failure fails that Book's accept                              |
| Publish (`publishCheck.ts:67`)               | bundled ∪ **Storage listing for every document in the assembled set** | listing failure fails validation with a clear message — never publish blind |

Startup reads its stems straight off the cached records' `assets` keys. The original spec's separate per-record `assets` manifest field is **dropped**: the blobs are the manifest.

All three rows bucket a stem the same way §5's overlay does, and it is the record's `kind` — not the content — that decides which half of `AssetStems` it lands in: a `topic:` record's blobs populate `audioByBook`/`imageByBook` keyed by book id, a `domain:` record's populate `audioByDomain`/`imageByDomain` keyed by domain id, and `blob.type.startsWith("image/")` picks image over audio. Derive it once and share it between the overlay and the validation paths rather than writing the split twice.

### 7. Editor UI: widen `AssetsManager`, do not fork it

`EditScreen` is no longer one file — it is a 45-line dispatcher over `apps/web/src/screens/edit/`. The Assets section belongs to **`MaintainEditScreen`** and reuses the existing component.

Change `AssetsManager`'s contract so both modes drive it:

```ts
export interface AssetView {
  stem: string;
  name: string;            // display name; falls back to `stem`
  kind: "audio" | "image";
  size: number;
  url: string;             // object URL (private) or public URL (maintain)
}

AssetsManager({
  book, domain,            // unchanged, for assetReferences
  assets: AssetView[],
  onAdd: (file: File) => Promise<void>,
  onDelete: (stem: string) => Promise<void>,
  deleteBlockedBy?: (stem: string) => string[],   // §8; undefined in private mode
})
```

Everything below the props stays as it is: the file input, the `MAX_ASSET_BYTES` check, the audio/image preview, the copyable stem field, the error line. Two changes inside the body — each card's heading is now `name` (the stem stays in its copy field, labelled as today), and `writeThrough`'s hardcoded `putPrivateBook` / `registerPrivateAssets` / `onAssetsChange` sequence moves out into the private caller's `onAdd`/`onDelete`. `assetKind`, `formatBytes`, `MAX_ASSET_BYTES` and `assetReferences` are already pure and shared unchanged.

- **Private mode** (`PrivateEditScreen`) builds `AssetView[]` from its blobs — it already creates exactly these object URLs in an effect — and passes its current `writeThrough` as the two callbacks. Behaviour must not change; this path is browser-verified.
- **Maintain mode** builds `AssetView[]` from the Storage listing (`supabase.storage.from("assets").list(...)`), with public URLs. `onAdd` uploads through the authenticated client and refreshes the listing; `onDelete` removes the object. Reject non-slug results and non-audio/image MIME client-side for a clear message — the bucket rules are the real enforcement.
- **Propose mode gets no Assets section.** Storage RLS is maintainer-only, so a proposer cannot write; they reference existing stems like any other field.

### 8. Deleting an asset the published document references is blocked

Point `assetReferences` at the **published** document, not the open draft, and refuse the delete when it returns anything:

> ✗ Published content references this: `ky-item-salam`, `ky-item-greet`.
> Remove the references and publish first, then delete.

This reverses the original spec's "deleting a referenced asset is allowed". It has to: under §4 a deleted-but-published object 404s during another learner's Add, which rolls back the **whole Book** — a failure that surfaces on a stranger's device while the maintainer's own copy is already cached and looks fine. `assetReferences` is pure and already exists; it just needs the published doc passed in. Private mode keeps today's warn-and-allow confirm, which is correct there (no other device is involved).

Note in the UI copy that a _draft-only_ reference does not block deletion — that case still fails the next publish validation with the existing human-readable rule message.

### 9. Seed export carries the onboarding Book's assets

`scripts/export-content.ts` re-exports exactly the `demo` onboarding Book (`:39`) as the frozen bundled seed, and that Book is **pre-added from the bundle, never fetched**. A remote-only asset reference in it would put the onboarding Book into the broken-Books card on a fresh offline install, with no network path to repair.

So the export gains a download pass: fetch the demo Book's (and its domain's) Storage listing and write each object into `content/demo/assets/audio|img/<stem>.<ext>` — **named by stem, not by display name**, because the build-time glob in `bundled.ts` keys on the file stem. This reverses the original spec's "seed re-export of remote assets: out of scope" line.

Seeded assets therefore carry no display name, and §2's "never show a bare stem as a title" does not reach them: they resolve through the bundled glob, which has no name to show and no Assets section to show it in — the onboarding Book's assets are committed files, not Storage objects a maintainer manages. Accepted.

### 10. Task types unblocked

This spec only delivers the pipeline. The task-type editors that need it (listen/dictation/shadowing/minimal-pair/picture) are in `0012-editor-long-tail.md` and depend on this spec landing first.

### Out of scope

Asset versioning/history (storage is live-mutable; version history covers documents only — accepted); image resizing/transcoding; asset rename; a download progress bar; per-field file pickers in the entity forms (the stem-copy contract from plan 0017 §4 stands); carrying display names through the `.bbbook` export format.

Uploading an asset does **not** by itself reach learners — nothing bumps `published_version` until the maintainer publishes. This is self-solving (referencing a new asset requires a document edit anyway) and needs no handling; it is recorded here so it is not mistaken for a bug.

## Verification

- Maintainer uploads an audio file; the Assets list shows its **filename**, not its stem, with the stem copyable beside it. Reference it from a new `listen`-capable item, publish validates and succeeds.
- Learner accepts the update, then in **airplane mode** plays that audio (served from the blob in the cached record).
- Accept with one asset URL made unreachable (delete the object between check and accept) → that Book's update is rejected whole, its old content + assets intact, and any other Book in the same accept still commits.
- A document-only edit (no asset change) accepts without re-downloading unchanged assets — verify by network panel, not by inference.
- **The carry-forward key is not hollow**: replace an asset with a _different_ file of the _same byte size_, publish, accept, and confirm the learner is served the new bytes. This is the test that fails if the comparison field is absent from `list()` and every asset compares equal to itself; it must be run, not reasoned about.
- Delete an asset the published document references → blocked, with the referencing entity ids named. Delete one referenced only by the draft → allowed.
- Non-maintainer upload to another doc's path → storage RLS rejects (browser console check).
- Oversized (>10 MB) and wrong-MIME uploads rejected.
- Remove a Book → its blobs are gone from IndexedDB. Archive a Book → its blobs survive.
- Bundled assets still play/display for the seed content with an empty storage bucket, and a **private Book's** assets still play — that path is browser-verified today and must stay that way.
- `corepack pnpm check` green.
