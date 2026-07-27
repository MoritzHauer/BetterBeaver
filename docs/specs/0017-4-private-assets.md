# Spec 0017-4: Assets in the private editor

Step 4 of [plan 0017](../plans/0017-private-books.md). Step 2 already built the runtime asset overlay (`content/private-assets.ts`) that resolves a private Book's blobs to object URLs and feeds their stems into `AssetStems`. Nothing writes those blobs yet — this step adds the authoring half. Design decisions are settled in the plan; do not reopen them.

## Context (read first)

- `apps/web/src/content/private-assets.ts` — `registerPrivateAssets`, `privateAssetStems`, `getPrivateAssetUrl`. The read side already works; assets in `PrivateBookRecord.assets` are already resolvable.
- `apps/web/src/content/private-store.ts` — `PrivateBookRecord.assets: Record<string, Blob>`, `readPrivateBook`, `putPrivateBook`.
- `apps/web/src/screens/EditScreen.tsx` — `PrivateEditScreen` (added in step 3) and its `editingDomain` toggle. `BookEditor`/`DomainEditor` are shared with the maintainer and propose paths.
- `packages/schema/src/validate.ts:601-620` — the dangling `audioRef`/`imageRef` checks. These are **hard errors**: an item referencing a stem with no asset makes the whole Book invalid.
- `content/demo/items/dx-item-pair-dam-dad.json` — a real item with `audioRef`s, for the payload shape.

## 1. An asset manager, not a per-field picker

Deliberately scoped: add one **Assets** view to `PrivateEditScreen`, reached from the book root the same way the Domain link already is. Do **not** add a file picker to individual item fields — that would mean changing `EntityForm`/`Field`, which the maintainer and propose paths share, for a feature only private Books can use.

The Assets view:

- Lists every stem in `record.assets`, with its kind (audio/image, from the blob's `type`), size, and a preview — an `<audio controls>` for audio, an `<img>` for images, both sourced from `URL.createObjectURL`. Revoke those URLs on unmount.
- **Add**: an `<input type="file" accept="audio/*,image/*">`. On select, generate the stem, store the blob, write through `putPrivateBook`.
- **Delete**: removes the stem from `record.assets`. Warn in the confirm if any item still references that stem, and say which — deleting a referenced asset makes the Book invalid, and the author should hear that before it happens, not after.
- Shows each stem as selectable text so the author can copy it into an item's `audioRef`/`imageRef` field. That is the intended workflow for this step; the ids are the contract between the two views.

## 2. Stem generation

`` `${book.code}-${newPrivateId()}` `` — the same rule step 3 established for entity ids. It satisfies both the book-code prefix requirement and global uniqueness. Do not derive the stem from the filename: filenames collide, contain spaces and non-slug characters, and `slugPattern` (`entities.ts:7`) would reject most of them.

Keep the original filename in neither the stem nor the record — it is not needed, and `PrivateBookRecord` must not grow a field for it.

## 3. Re-registering after a write

`registerPrivateAssets` runs once at boot (`initContentSource`). An asset added mid-session is in the store but not in the overlay, so a freshly-added asset would not resolve until reload.

Handle it the simple way: after a successful asset add or delete, re-run `registerPrivateAssets` over the current records so the overlay stays truthful within the session. Export whatever narrow helper this needs from `private-assets.ts` rather than reaching into its internals. Do **not** trigger a full app reload for an asset change.

## 4. Size ceiling

Add a guard: refuse a file over 10 MB with a plain message naming the limit. Mark it with a `ponytail:` comment giving the reason (IndexedDB quota is browser-managed and the whole Book is later serialised into one JSON string for export — see plan 0017 §7's stated ~20 MB ceiling) and the upgrade path (chunked/zip export). Do not build quota detection.

## Done criteria

1. `corepack pnpm check` green, except `ToDo.md`, which is dirty from the owner — do not touch it. Every file you touch must be prettier-clean.
2. Existing tests pass. New unit tests only if you add pure logic worth testing (a stem generator is covered by step 1's id tests; do not add `fake-indexeddb`).
3. Typecheck clean.

## Out of scope

Export/import (step 5), the private card marker / branched Remove confirm / `eraseAllData` (step 6). Do not modify `EntityForm`, `Field`, `IdListField`, `BookEditor` or `DomainEditor` beyond what step 3 already did. Do not change the maintainer or propose paths. Do not touch `packages/`, `cache.ts`, or `idb.ts`.
