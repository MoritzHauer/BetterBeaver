# Spec 0012-C: Asset upload UI and seed export

Slice 3 of 3 of [0012-asset-pipeline.md](0012-asset-pipeline.md) (the design record — read for rationale, **this document is normative**). Slices [A](0012-a-remote-asset-read-path.md) and [B](0012-b-asset-download.md) landed: the read path, the storage bucket (**already applied to the live project**), listing/download, and the validation inventories. **Nothing can put an object in the bucket yet — that is this slice.**

Make no new design choices. If anything is ambiguous, contradicts the code, or is impossible as written, STOP and report the gap.

## Goal

A maintainer uploads and deletes a document's assets in the editor, and the bundled onboarding seed stays self-contained.

## Files to touch

1. `apps/web/src/backend/storage.ts` — add upload and delete.
2. `apps/web/src/screens/edit/AssetsManager.tsx` — widen the props so both modes drive it.
3. `apps/web/src/screens/edit/PrivateEditScreen.tsx` — adapt to the widened props. **Behaviour must not change.**
4. `apps/web/src/screens/edit/MaintainEditScreen.tsx` — add the Assets section and the delete guard.
5. `scripts/export-content.ts` — download the seed Book's assets.
6. `apps/web/src/backend/storage.upload.test.ts` — **new**.

Do **not** touch `ProposeEditScreen.tsx`, `content/`, `source.ts`, `cache.ts`, `remote-assets.ts`, `private-assets.ts`, or the migration.

## Required reading

`docs/specs/0012-asset-pipeline.md` §2, §7, §8, §9; `apps/web/src/backend/storage.ts` (from slice B — `RemoteAsset`, `parseObjectName`, `listDocumentAssets`); `apps/web/src/screens/edit/AssetsManager.tsx` (229); `apps/web/src/screens/edit/PrivateEditScreen.tsx` (302); `apps/web/src/screens/edit/MaintainEditScreen.tsx` (459); `apps/web/src/backend/supabase.ts` (347); `scripts/export-content.ts` (55); `apps/web/src/content/bundled.ts:55–95` (the asset globs — the seed's on-disk layout).

## Pinned design

### 1. `storage.ts` — upload and delete

```ts
export function assetFolder(mimeType: string): "audio" | "img";
export function buildObjectName(stem: string, fileName: string): string;
export function uploadAsset(
  documentId: string,
  bookCode: string,
  file: File,
): Promise<RemoteAsset>;
export function deleteAsset(path: string): Promise<void>;
```

- **`assetFolder`** returns `"img"` when the MIME type starts with `image/`, else `"audio"`. This is load-bearing, not cosmetic: slice B's validation buckets a listed asset by its **folder** while slice A's runtime overlay buckets by **`blob.type`**. They agree only because this function is the sole writer and derives the folder from the MIME type. Say so in a comment.
- **Stem** is generated, never derived from the filename: `` `${bookCode}-${crypto.randomUUID()}` `` — the same rule `AssetsManager.tsx:149` already uses for private Books. It satisfies `slugPattern` and cannot collide.
- **`buildObjectName`** sanitises `fileName` to `[A-Za-z0-9._-]`, replacing every other character with `-`, and returns `` `${stem}__${sanitised}` ``. If nothing survives sanitising, return `stem` alone (no `__`). This is the exact inverse of slice B's `parseObjectName`; the two must round-trip.
- **`uploadAsset`** puts the object at `` `${documentId.replace(":", "/")}/${folder}/${objectName}` `` using the authenticated client (`supabase.storage.from("assets").upload`), then returns the `RemoteAsset` for it. Reject a non-`audio/`/`image/` MIME type client-side with a clear message; the bucket rules are the real enforcement.
- **`deleteAsset`** removes one object by its full path.

### 2. `AssetsManager` — widen, do not fork

Replace the `assets: Record<string, Blob>` prop with a view model both modes can build:

```ts
export interface AssetView {
  stem: string;
  name: string; // display name; falls back to `stem`
  kind: "audio" | "image";
  size: number;
  url: string; // object URL (private) or public URL (maintain)
}
```

New props: `assets: AssetView[]`, `onAdd: (file: File) => Promise<void>`, `onDelete: (stem: string) => Promise<void>`, and an optional `deleteBlockedBy?: (stem: string) => string[]`. Keep `book`, `domain` and `bookId`.

**Everything below the props stays as it is** — the file input, the `MAX_ASSET_BYTES` check, the audio/image preview, the copyable stem field, the error line, the empty state. Two changes only:

- Each card's heading is now `name`. The stem keeps its existing copy field, labelled as today. **Never show a bare stem as an asset's title** — that is the whole point of carrying a display name.
- `writeThrough`'s hardcoded `putPrivateBook` / `registerPrivateAssets` / `onAssetsChange` sequence moves **out** of this component into the private caller's `onAdd`/`onDelete`.

**Delete behaviour**, two paths:

- `deleteBlockedBy` absent (private mode) — today's behaviour exactly: `assetReferences` produces a warning prefix and the `window.confirm` still lets the author through. Do not change it; that path is browser-verified.
- `deleteBlockedBy` present (maintain mode) — call it first. A non-empty result **blocks the delete** with a message naming the references, and `onDelete` is never called:

  > ✗ Published content references this: `<id>`, `<id>`. Remove the references and publish first, then delete.

  An empty result falls through to the existing confirm.

`assetKind`, `formatBytes`, `MAX_ASSET_BYTES` and `assetReferences` are already pure — keep them exported and unchanged.

### 3. `PrivateEditScreen` — adapt only

Build `AssetView[]` from the record's blobs. It already creates exactly these object URLs in an effect; that effect moves here or stays, but the URLs must still be revoked on change and on unmount. `name` comes from `File.name` when the stored value is a `File`, falling back to `stem` when it is a plain `Blob` (which is what a `.bbbook` round-trip produces — **do not change the export format** to carry names). Pass the existing `writeThrough` logic as `onAdd`/`onDelete`. Pass no `deleteBlockedBy`.

**No behaviour change is permitted here.** Same 10 MB cap, same generated stems, same warn-and-allow delete, same write-through ordering (persist → `registerPrivateAssets` → notify parent).

### 4. `MaintainEditScreen` — the Assets section

Add an Assets section rendering `AssetsManager` over `listDocumentAssets(docId)`, with:

- `onAdd` → `uploadAsset(docId, <book code>, file)`, then refresh the listing.
- `onDelete` → `deleteAsset(<path>)`, then refresh the listing.
- `deleteBlockedBy` → `assetReferences` against **`record.published`, not `working`**. The published document is what other people's devices download; a draft-only reference is not a hazard. `assetReferences(book, domain, stem)` wants both shapes, but a maintain screen edits one document — pass the published document in its own slot and an empty counterpart (`{ items: [] }` / `{ entries: [] }`) for the other. When `record.published` is null, nothing is published, so nothing can be blocked.
- `AssetView.url` is the object's public URL; `name` and `stem` come from `parseObjectName`.

Why blocking is correct rather than warning: under slice B's eager all-or-nothing download, a deleted-but-published object 404s during **another learner's** Add and rolls back that whole Book. The maintainer never sees it — their own copy is already cached. Put that reasoning in a comment.

**The section is gated on `!readOnly`** (amended 2026-07-30, gap found during implementation). `readOnly` is `record.schema_version > CONTENT_SCHEMA_VERSION` — a maintainer whose app build is older than the document's schema. Every other mutation surface in the file is already gated on it (`change`, publish, discard draft, sync), and assets are not an exception: uploads and deletes hit **live Storage** for a document this client has just declared it cannot safely reason about, and the delete guard's correctness depends on `assetReferences` understanding the published document's shape — which is exactly what a schema skew puts in doubt. Gate it the same way the root view already gates its other controls at `MaintainEditScreen.tsx:432`.

**Propose mode gets no Assets section.** Storage RLS is maintainer-only, so a proposer cannot write; they reference existing stems like any other field. Do not touch `ProposeEditScreen.tsx`.

### 5. `scripts/export-content.ts` — seed assets

The script re-exports exactly the `demo` onboarding Book as the frozen bundled seed, and that Book is **pre-added from the bundle, never fetched**. A remote-only asset reference in it would put the onboarding Book into the broken-Books card on a fresh offline install with no network path to repair.

Add a download pass for `topic:demo` and `domain:demo`, writing each object to disk **named by stem, not by display name**, because the build-time globs key on the file stem:

| Document      | Destination                                            |
| ------------- | ------------------------------------------------------ |
| `topic:demo`  | `content/demo/assets/{audio,img}/<stem>.<ext>`         |
| `domain:demo` | `content/lexicon/demo/assets/{audio,img}/<stem>.<ext>` |

Those two layouts are what `bundled.ts:59–90` globs; they are different paths, not a typo. `<ext>` is the object name's extension (after its final `.`); an object with no extension is written without one. Create directories as needed. Use the anon key the script already reads — no new env var.

Leave the existing document export untouched.

## Constraints — what must NOT change

- Private-Book asset behaviour, end to end.
- `getAssetUrl` / `getLexiconAssetUrl` — not touched at all in this slice.
- The `.bbbook` export format.
- The generated-stem rule; no filename-derived stems anywhere.
- `MAX_ASSET_BYTES` (10 MB) and the existing client-side checks.
- No new dependencies. No changes to the migration, and **no commands against a live Supabase project** — not `supabase db push`, not an upload, nothing.

## Done criteria

1. `corepack pnpm check` green (format, lint, `lint:types-fire`, `lint:cycles`, typecheck, tests).
2. `apps/web/src/backend/storage.upload.test.ts` covers, as pure functions:
   - `assetFolder("image/png") === "img"`, `assetFolder("audio/wav") === "audio"`, and that an empty/unknown MIME falls to `"audio"`;
   - **round-trip**: `parseObjectName(buildObjectName(stem, name))` recovers `stem` for a plain name, a name containing spaces and `#`, a name containing its own `__`, and a name that sanitises to nothing;
   - every generated stem matches `slugPattern` (import it, don't re-declare it).
3. **Mutation check**: change `assetFolder` to key off the file extension instead of the MIME type, confirm a test fails, revert. Report what failed.
4. State in your report that `ProposeEditScreen.tsx` is unmodified (`git diff --stat` proves it).

The live round-trip — upload through the editor, reference it, publish, add on another device, play offline — is an **owner-run step** and is not in your done criteria. Do not attempt it.

## Report back

Files changed, the mutation-check result, `pnpm check` output tail, confirmation that propose mode and the private path are untouched in behaviour, and any ambiguity you hit — do not resolve ambiguities yourself.
