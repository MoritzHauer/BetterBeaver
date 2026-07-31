# Spec 0012-B: Asset download, validation, and the storage bucket

Slice 2 of 3 of [0012-asset-pipeline.md](0012-asset-pipeline.md) (the design record — read for rationale, **this document is normative**). Slice A ([0012-A](0012-a-remote-asset-read-path.md)) landed the read path: `CachedDocument.assets`, `content/remote-assets.ts`, and the synchronous resolution chain. **It is inert because nothing writes blobs. This slice fills the store.** Slice C adds the editor upload UI and the seed export.

Make no new design choices. If anything is ambiguous, contradicts the code, or is impossible as written, STOP and report the gap.

## Goal

A Book's assets download from Supabase Storage when it is added or updated, all-or-nothing per Book, and every validation path knows what is in the bucket.

## Files to touch

1. `supabase/migrations/<YYYYMMDDHHMMSS>_assets.sql` — **new**. Author it; **do not apply it** to any project.
2. `apps/web/src/backend/storage.ts` — **new**. Listing, public URLs, and the object-key parse.
3. `apps/web/src/content/source.ts` — download in `addBook` and `acceptUpdate`; widen the accept dry-run's stems.
4. `apps/web/src/backend/publishCheck.ts` — widen the publish stems.
5. `apps/web/src/content/remote-assets.ts` + `apps/web/src/content/bundled.ts` — the domain-fallback fix in §5 below.
6. `apps/web/src/backend/storage.test.ts` — **new**.

Do **not** touch any editor file, `scripts/`, `idb.ts`, `cache.ts`, or `private-assets.ts`.

## Required reading

`docs/specs/0012-asset-pipeline.md` §1–4, §6 (the design record for this slice), `apps/web/src/content/source.ts` (804 — `addBook` at :614, `acceptUpdate`'s dry-run at :505–600, `toCachedDocument` at :172), `apps/web/src/backend/publishCheck.ts` (72), `apps/web/src/backend/supabase.ts` (347 — for the client and the existing call style), `apps/web/src/content/remote-assets.ts` and `bundled.ts:247–330`, `apps/web/src/offline.ts`.

## Pinned design

### 1. Migration

`supabase/migrations/<timestamp>_assets.sql`, following the style of the existing migrations in that directory:

- Create a **public** bucket `assets`, `file_size_limit` 10 MB (10485760), `allowed_mime_types` covering `audio/*` and `image/*`.
- RLS on `storage.objects` for bucket `assets`: `insert` / `update` / `delete` for `authenticated` where
  `public.is_maintainer((storage.foldername(name))[1] || ':' || (storage.foldername(name))[2])`.
- **Amended 2026-07-30 — a select policy IS required.** The original wording ("read access comes from the bucket being public; add no select policy") was wrong and would have made this whole slice inert for signed-out learners. A public bucket grants anonymous access to the **public-URL download endpoint** only; `list()` is a query against `storage.objects` and goes through SELECT RLS like any other table. Without a policy, `listDocumentAssets` returns `[]` for every learner while every local test still passes. Add:

  ```sql
  create policy "assets public read"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'assets');
  ```

  This grants nothing the public URLs do not already expose — the bucket is public by design; the policy only makes enumeration work.

- **Never modify an already-applied migration file.** This one is not applied yet, so amend it in place rather than adding a second migration.

**Do not run `supabase db push`, `supabase migration up`, or any command that touches a live project.** Applying this is an owner-run step, exactly like `20260721000000_vote_counts.sql` was.

### 2. `backend/storage.ts`

Object key layout: `<kind>/<contentId>/audio/<objectName>` and `<kind>/<contentId>/img/<objectName>`, where `<kind>` is `topic` or `domain` — the same two values `CachedDocument.kind` uses. So a document id `topic:kyrgyz` maps to the key prefix `topic/kyrgyz`.

An asset has a **stem** (what content references) and a **display name** (shown in UI). The object name carries both. The parse is exactly this and nothing else — the display name is unconstrained, so never infer the split from its shape:

```ts
const i = objectName.indexOf("__");
const stem = i === -1 ? stripExtension(objectName) : objectName.slice(0, i);
const name = i === -1 ? objectName : objectName.slice(i + 2); // verbatim, may itself contain "__"
```

This is safe because `slugPattern` (`/^[a-z0-9]+(-[a-z0-9]+)*$/`) forbids underscores, so the stem side never contains one.

Export at least:

```ts
export interface RemoteAsset {
  stem: string;
  name: string;
  kind: "audio" | "img";
  path: string; // full object key
  url: string; // public URL
  size: number | undefined;
  lastModified: string | undefined;
}

/** Lists both the audio/ and img/ folders for one document. Throws on failure — callers decide. */
export function listDocumentAssets(documentId: string): Promise<RemoteAsset[]>;
```

Use the existing Supabase client from `backend/supabase.ts` (`supabase.storage.from("assets").list(...)`) and its public-URL helper. `size` and `lastModified` come from the listing entry's `metadata.size` and its `last_modified` / `updated_at`, whichever the response actually provides — **leave them `undefined` when absent rather than substituting a default**; §4 depends on that.

Offline mode needs no new branch here: `getSupabase()` already returns null and `fetchRest` already throws, and neither caller is reachable offline.

### 3. Downloading: eager, all-or-nothing, per Book

Two call sites in `source.ts`, both already online by definition:

- **`addBook`** — after the dry-run validation passes and **before** `putCachedDocuments(newDocs)`. List and download the assets for both fetched documents, attach them to the records as `assets`, and only then commit. Any listing or download failure must leave the cache untouched and surface through `addBook`'s existing thrown error (reuse the existing message, do not invent a new one).
- **`acceptUpdate`** — after the per-Book document validation, for each Book that passed. Attach the blobs to the records in `toCommit` before `putCachedDocuments(toCommit)`. **A download failure fails only that Book**: route its id into the existing `failedAffected` list so its documents are skipped, exactly as a validation failure already does. One Book's bad asset must never block another Book's update.

Reuse `toCachedDocument` for record construction and set `assets` on the result; do not build records by hand.

Do **not** add a progress bar, a size warning, or any new UI. `addBook` already blocks behind its existing pending state.

### 4. Carry-forward

`putCachedDocuments` replaces whole records, so re-attaching every blob on a text-only edit would re-download a whole audio set. Before downloading, look up the previous cached record for the same document id and reuse its blob for a stem when the new listing reports **the same `size` and the same `lastModified`**. Download everything else.

**Fail towards re-downloading.** If either field is `undefined` on a listing entry, or the previous record has no blob for that stem, **download it**. Never treat two `undefined`s as equal — a hollow comparison key would silently serve stale bytes after a maintainer replaced a file with a different one of the same size, which is a wrong-content bug rather than a slow one. Put this reasoning in a comment at the comparison.

`acceptUpdate` already reads the old cache; `addBook` reads it as `freshCached`. Neither needs a new read.

### 4b. `addBook` must list before it validates (amended 2026-07-30)

`addBook`'s dry run calls `buildMembers` → `allAssetStems()`, which reflects only the overlay registered at last boot. A first-time Add of a Book whose content references Storage-hosted assets would therefore fail validation with dangling `audioRef`s — the assets exist, but nothing has listed them yet. That is a live bug the moment any such Book is published, not a theoretical one.

Fix the ordering: **list the new Book's (and its domain's) assets first, then dry-run with those stems included, then download.**

Give `buildMembers` an optional trailing `extraStems?: AssetStems` parameter, merged into `allAssetStems()` at its `createDocumentContentSource` call (`source.ts:322`) with the existing `mergeAssetStems` helper. Every current caller passes nothing and is unaffected; `addBook` passes the stems from its pre-validation listing. A listing failure at this point fails the Add through the existing thrown error, same as a download failure.

Bucket those stems from the listing exactly as §6 does — by the `audio`/`img` folder, not by MIME.

### 5. Domain fallback for remote-only Books (gap found in slice A)

`getAssetUrl(bookDir, …)` ends in a fallback that maps a book id to its domain id via `domainIdByBookId`, which `bundled.ts` builds **only from bundled content**. A Library-fetched Book (every Book except `demo`) is therefore absent from it, so an item whose `audioRef` points at a _lexicon_ asset resolves to `undefined` — the domain's blobs sit in `audioByDomain` under the domain id and nothing maps the book id to it.

This is latent today (no remote Book has assets) and becomes a live bug the moment this slice lands. Fix it:

- In `remote-assets.ts`, have `registerRemoteAssets` also record a book → domain map, read off each `topic:` record's document with the same raw `topic.domainId` read `source.ts`'s `rawDomainId` uses (do not import `rawDomainId` if that creates a cycle — `lint:cycles` must stay green; duplicate the three-line read with a comment saying why). Reset it alongside the other maps. Export `remoteDomainIdForBook(bookId): string | undefined`.
- In `bundled.ts`'s `getAssetUrl`, change the final fallback lookup to `domainIdByBookId.get(bookDir) ?? remoteDomainIdForBook(bookDir)`.

Nothing else in the chain changes, and `getAssetUrl` stays synchronous.

### 6. Validation inventories

Two remaining call sites still pass bundled-only stems:

- **`source.ts` accept dry-run (~:561)** — `bundledAssetStems()` becomes bundled ∪ private ∪ the stems just listed for the documents in that dry run. The startup path already uses `allAssetStems()` and needs no change.
- **`publishCheck.ts` (~:67)** — `bundledAssetStems()` becomes bundled ∪ the Storage listing for every document in the assembled set. **A listing failure must fail validation with a clear message** — never publish blind against an unknown inventory.

Bucket a listed asset the same way slice A does: a `topic/` prefix populates `audioByBook`/`imageByBook` keyed by content id, a `domain/` prefix populates `audioByDomain`/`imageByDomain`, and the `audio`/`img` folder — not the MIME type — picks the map here, because the listing is the source of truth for where it lives.

**On the folder-vs-MIME divergence** (raised as a gap, resolved here, no code change in this slice): validation buckets by folder, while slice A's runtime overlay buckets by `blob.type` because a `CachedDocument.assets` entry is a flat stem→blob map with no folder left in it. These agree by construction because **slice C's upload derives the folder from the file's MIME type** (`image/*` → `img/`, everything else → `audio/`), which is the only writer the RLS permits. A hand-uploaded object filed against its own MIME type could still diverge; that is an owner-side mistake with a loud symptom (validation passes, playback silent), and is accepted rather than guarded.

## Constraints — what must NOT change

- `getAssetUrl` / `getLexiconAssetUrl` stay **synchronous**, same signatures, same call sites.
- `DB_VERSION` stays 2. `cache.ts` and `idb.ts` are not touched.
- Private-Book behaviour, including `private-assets.ts` and its first place in the resolution chain.
- The all-or-nothing accept semantics and per-Book failure granularity plan 0015 established.
- No new dependencies. No new UI.
- No live-project commands.

## Done criteria

1. `corepack pnpm check` green (format, lint, `lint:types-fire`, `lint:cycles`, typecheck, tests).
2. `apps/web/src/backend/storage.test.ts` covers the §2 key parse as a pure function: `ky-abc__salam.mp3` → stem `ky-abc`, name `salam.mp3`; `ky-abc.mp3` (no `__`) → stem `ky-abc`, name `ky-abc.mp3`; a name containing its own `__` splits only on the first; and a key whose stem would contain `_` is impossible by `slugPattern` (assert the pattern, don't just claim it).
3. Tests for the §4 carry-forward **decision function** — extract it as a pure exported helper so it is testable without IndexedDB or the network. Must cover: same size + same lastModified → reuse; different size → download; **`undefined` on either side → download** (this is the case that catches a hollow key).
4. **Mutation check**: change the §4 comparison so two `undefined`s compare equal, confirm a test fails, revert. Report what failed.
5. Confirm by inspection and state in your report: no code path you added runs when `offline.ts` reports offline.

The live round-trip (apply the migration, upload an object, add the Book, play it in airplane mode) is an **owner-run step** and is not part of your done criteria. Do not attempt it.

## Report back

Files changed, mutation-check result, `pnpm check` output tail, the §5 cycle check result, and any ambiguity you hit — do not resolve ambiguities yourself.
