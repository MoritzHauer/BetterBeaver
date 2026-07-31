# Spec 0012-A: Remote asset read path

Slice 1 of 3 of [0012-asset-pipeline.md](0012-asset-pipeline.md), which is the design record — read it for rationale, but **this document is normative for what to build**. Slice B adds the downloads that fill the store; slice C adds the editor upload UI. This slice is deliberately **inert on its own**: nothing writes remote asset blobs yet, so behaviour is unchanged until B lands. That is the intended shape, not an oversight — do not add a download path to make it "do something".

Make no new design choices. If something here is ambiguous or contradicts the code, stop and report it rather than deciding.

## Goal

Give the app a place to hold a remote Book's asset blobs and a synchronous way to resolve them, mirroring plan 0017's private-Book overlay exactly.

## Files to touch

1. `apps/web/src/content/cache.ts` — add the `assets` field.
2. `apps/web/src/content/remote-assets.ts` — **new**, near-copy of `private-assets.ts`.
3. `apps/web/src/content/bundled.ts` — extend the resolution chain and `allAssetStems()`.
4. `apps/web/src/content/source.ts` — one new call in `initContentSource`, and widen the startup stem inventory.
5. `apps/web/src/content/remote-assets.test.ts` — **new**.
6. `apps/web/src/test-setup.ts` — add a `URL.createObjectURL` shim if jsdom lacks one.

Nothing else. In particular do **not** touch `addBook`, `acceptUpdate`, `publishCheck.ts`, any editor file, or `scripts/`.

## Required reading

`apps/web/src/content/private-assets.ts` (87 lines — read in full, it is the template), `apps/web/src/content/bundled.ts` (330), `apps/web/src/content/cache.ts` (107), `apps/web/src/content/source.ts` (804 — the parts that matter are `buildMembers` ending at :322 and `initContentSource` at :388–410), `packages/engine/src/documentSource.ts` (314 — for the `AssetStems` interface at :66), `apps/web/src/test-setup.ts`.

## Pinned design

### 1. `CachedDocument.assets`

```ts
export interface CachedDocument {
  id: string;
  kind: "topic" | "domain";
  version: number;
  schemaVersion: number;
  doc: BookDocument | DomainDocument;
  /** stem -> blob, downloaded at add/accept (spec 0012-B). Absent on records written before this spec: no remote assets. */
  assets?: Record<string, Blob>;
}
```

Optional, so every existing record reads correctly as "no remote assets". **`DB_VERSION` in `idb.ts` stays at 2** — adding a field to a record is not an IndexedDB schema change. Do not bump it, and do not add an upgrade branch.

`putCachedDocuments` / `replaceCachedDocuments` / `deleteCachedDocuments` need no changes: they already round-trip whole records, and structured clone handles `Blob` natively.

### 2. `content/remote-assets.ts`

Write it as a near-copy of `private-assets.ts`, with the same module doc-comment style explaining why it exists. Three exports:

```ts
export function registerRemoteAssets(docs: CachedDocument[]): void;
export function remoteAssetStems(): AssetStems;
export function getRemoteAssetUrl(
  id: string,
  kind: "audio" | "img",
  stem: string,
): string | undefined;
```

- `registerRemoteAssets` revokes every object URL it created on a previous call, resets its maps, then creates one object URL per blob. Same module-level `createdUrls` / four-map structure as `private-assets.ts`. Called once per boot.
- **Bucketing is decided by the record's `kind`, not by the content**: a `topic:` record's blobs go into `audioByBook`/`imageByBook` keyed by the record's content id (use the existing `contentIdOf` helper — the record `id` is kind-prefixed, the maps key on content ids); a `domain:` record's go into `audioByDomain`/`imageByDomain` keyed likewise. Within a record, `blob.type.startsWith("image/")` selects the image map, else audio — the same test `private-assets.ts:53` and `AssetsManager.tsx:11` already use.
- A record with `assets` absent or empty contributes nothing.
- `getRemoteAssetUrl` checks the book map then the domain map, exactly like `getPrivateAssetUrl`.

Unlike `private-assets.ts`, this module takes `CachedDocument[]`, not `PrivateBookRecord[]` — do not try to share one function between them; the record shapes and the id derivation differ.

### 3. `bundled.ts` — resolution chain and merge

`getAssetUrl` and `getLexiconAssetUrl` **stay synchronous and keep their exact signatures.** Do not make them async. Do not change any call site in `SessionScreen`, `UnitScreen`, `VocabularyScreen` or `EntryPopup`.

Insert the remote overlay into both resolvers, after the private check and before the bundled lookup:

```
private overlay -> remote overlay -> bundled glob -> (getAssetUrl only: domain fallback) -> undefined
```

In `getAssetUrl`, the remote check goes immediately after the existing `getPrivateAssetUrl` block, before `byDir.get(bookDir)`. The existing domain fallback at the end is unchanged — it already routes through `getLexiconAssetUrl`, which gains its own remote check, so a remote lexicon asset resolves through that path without extra code.

`allAssetStems()` becomes `bundled ∪ private ∪ remote`, reusing its existing `merge` helper (call it twice; keep the concatenate-don't-overwrite comment as-is).

Update the module doc comment at the top of `bundled.ts` to name the second overlay.

### 4. `source.ts` — register at boot, widen the startup inventory

In `initContentSource`, immediately after the existing `registerPrivateAssets(privateRecords)` at :407, register the remote overlay from the cached records:

```ts
registerRemoteAssets(cached);
```

Use `cached`, the full list — not `cachedById`, not a filtered subset. Ordering relative to `registerPrivateAssets` does not matter, but it must be before `buildMembers` at :410, because `buildMembers` calls `allAssetStems()`.

`buildMembers` at :322 already calls `allAssetStems()`, so the startup stem inventory widens with no change there. Confirm this by reading it; do not add a separate manifest parameter.

**The `acceptUpdate` dry-run at :561 still calls `bundledAssetStems()` and stays that way in this slice** — slice B owns it. Leave it alone even though it now looks inconsistent.

## Constraints — what must NOT change

- `getAssetUrl` / `getLexiconAssetUrl` signatures and every call site.
- `DB_VERSION` (stays 2), and the existing `idb.ts` upgrade function.
- Any private-Book behaviour. `private-assets.ts` is a template to copy, **not** a file to edit. Its precedence stays first in the chain.
- The bundled glob mechanism and the seed.
- No new dependencies.

## Done criteria

Each of these must pass, run from the repo root:

1. `corepack pnpm check` — green, including `format:check`, `lint:types-fire`, `lint:cycles` and the full test suite.
2. `apps/web/src/content/remote-assets.test.ts` exists and covers, with real `Blob`s:
   - a `topic:` record's `image/png` blob resolves through `getAssetUrl(<bookId>, "img", <stem>)` and appears in `allAssetStems().imageByBook`;
   - a `domain:` record's `audio/*` blob resolves through `getLexiconAssetUrl(<domainId>, "audio", <stem>)` and appears in `allAssetStems().audioByDomain`;
   - a record with no `assets` field contributes nothing and resolves to `undefined`;
   - calling `registerRemoteAssets` a second time with a different record set drops the first set's stems (the revoke-and-reset path).
3. **Mutation check** — verify the tests actually bite: temporarily invert the `blob.type.startsWith("image/")` test and confirm at least one assertion fails; revert. Report that you did this and what failed.
4. A record whose `assets` is absent must round-trip through `putCachedDocuments` → `readCachedDocuments` unchanged. Cover it in the test file or state why the existing suite already does.

If jsdom lacks `URL.createObjectURL`, add a shim to `test-setup.ts` in the style of the existing ones — a short comment naming what jsdom is missing and why the shim is enough. Do not silently work around it inside the test file.

## Report back

State: files changed, the mutation-check result, `pnpm check` output tail, and any place the spec was ambiguous (those are lessons for slices B and C — do not resolve them yourself).
