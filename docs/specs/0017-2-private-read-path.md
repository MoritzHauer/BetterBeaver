# Spec 0017-2: Private Book read path + runtime asset overlay

Step 2 of [plan 0017](../plans/0017-private-books.md). Makes a private Book that already exists in the store **visible and fully studiable**. There is still no way to create one in the UI — that is step 3. All design decisions are settled in the plan; do not reopen them.

## Context (read first, in this order)

- `apps/web/src/content/private-store.ts` — the store from step 1. `PrivateBookRecord` is `{ id, book, domain, assets, updatedAt }`. Note markdown is **not** on the record: `BookDocument.notes` already carries it inline.
- `apps/web/src/content/source.ts` lines 180-360 — `purgeUnmembered`, `buildMembers`, `memberCachedVersions`, `initContentSource`. This is the file you are mainly changing.
- `apps/web/src/content/bundled.ts` lines 210-270 — `bundledAssetStems`, `getAssetUrl`, `getLexiconAssetUrl`.
- `packages/engine/src/documentSource.ts` lines 55-70 (`AssetStems`) and 139-233 (`createDocumentContentSource`).
- `apps/web/src/content/myBooks.ts` — membership id arrays.

## 1. `apps/web/src/content/private-assets.ts` (new)

A module-level registry of object URLs for private assets. It exists because `AssetStems` and `getAssetUrl` are otherwise build-time-only, and `validateContent` **hard-fails on a dangling `audioRef`/`imageRef`** (`validate.ts:607-617`) — so a private Book's stems must be known before its documents are validated.

```ts
import type { AssetStems } from "@betterbeaver/engine";
import type { PrivateBookRecord } from "./private-store";

/**
 * Runtime asset overlay for private Books (plan 0017 §4). Bundled assets are
 * resolved at build time via `import.meta.glob`; a private Book's assets are
 * blobs in IndexedDB, so they become object URLs here and are merged into the
 * same `AssetStems` / `getAssetUrl` lookups the screens already use.
 *
 * ponytail: a per-session map with no eviction — a private library is small.
 * Revisit if a real user hits memory pressure.
 */
```

Exports:

| Export                                                                                      | Behaviour                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerPrivateAssets(records: PrivateBookRecord[]): void`                                 | Revokes any previously-created URLs, then creates one object URL per asset. Called once per boot, before the content source is built.                                                                                                                                                                                                                    |
| `privateAssetStems(): AssetStems`                                                           | The registered stems, in `AssetStems` shape. A private Book owns its Domain, so put each Book's stems under **both** `audioByBook`/`imageByBook` (keyed by book id) **and** `audioByDomain`/`imageByDomain` (keyed by that Book's domain id) — `getLexiconAssetUrl` is what Vocabulary and the entry popup call, and they only have a domain id in hand. |
| `getPrivateAssetUrl(id: string, kind: "audio" \| "img", stem: string): string \| undefined` | Object URL, or `undefined`. `id` may be a book id or a domain id — check both maps.                                                                                                                                                                                                                                                                      |

Determine `kind` per asset from the blob's `type` (`image/*` → `img`, else `audio`). Assets whose stem appears in neither an `audioRef` nor an `imageRef` are still registered; that is harmless.

## 2. `apps/web/src/content/bundled.ts` — consult the overlay first

`getAssetUrl` and `getLexiconAssetUrl` are imported by only five call sites across four screens. **Do not change those call sites.** Instead, inside both functions, check `getPrivateAssetUrl(...)` first and return it when defined, falling through to today's bundled lookup otherwise.

Update the file's top doc comment: it is no longer purely "bundled" content — it is the asset resolution point, and private Books contribute at runtime.

Also add:

```ts
/** Bundled stems merged with any registered private-Book stems. */
export function allAssetStems(): AssetStems;
```

Merging four `Map<string, string[]>` pairs. On a key present in both (impossible today — private ids are UUIDs — but do not rely on that), concatenate rather than overwrite.

## 3. `apps/web/src/content/source.ts` — merge private records

- `buildMembers` gains a parameter: `privateById: Map<string, PrivateBookRecord>`. For each `bookId`, **check `privateById` first**; on a hit, `books.set(bookId, rec.book)` and `domains.set(rawDomainId(rec.book), rec.domain)` and `continue` — never touch `cachedById` for a private Book, and never report it in `missing`. Existing cached/demo behaviour is otherwise unchanged.
- `buildMembers` passes `allAssetStems()` instead of `bundledAssetStems()`.
- `initContentSource`: read the private records (`readPrivateBooks()`), build `privateById`, call `registerPrivateAssets(records)` **before** `buildMembers`, and pass the map through.
- `purgeUnmembered` and `memberCachedVersions` are **unchanged** and must stay that way — a private Book has no cached document and no catalog row, so it is naturally skipped by both. Add a one-line comment to each saying so, because the reason is not obvious to the next reader.
- A private Book id lives in `bb.mybooks` exactly like any other; `myBooks.ts` needs no change.

## 4. `packages/engine/src/documentSource.ts` — comment only

`AssetStems`' doc comment (lines 59-63) asserts stems "always come from the bundled asset maps — regardless of where the documents themselves came from". That is no longer true. Update it to say stems may also come from the private-Book store at runtime. **No code change in `packages/engine`.**

## Done criteria

1. `corepack pnpm check` green (`ToDo.md` is dirty in the working tree from the owner — ignore that one file; every file you touch must be prettier-clean).
2. Existing tests still pass unchanged. No new unit tests are required for this step: the logic is IndexedDB-bound and jsdom has no IndexedDB (same reason `cache.ts` has never been unit-tested). Do not add `fake-indexeddb`.
3. Typecheck proves `buildMembers`' new parameter is threaded everywhere it is called (there is a dry-run call site as well as the boot one — find it).

## Out of scope

Creating or editing a private Book (step 3), the editor asset picker (step 4), export/import (step 5), the private card marker / branched Remove confirm / `eraseAllData` (step 6). Do not add UI. Do not modify any screen, `App.tsx`, `myBooks.ts`, `cache.ts`, or `private-store.ts`.
