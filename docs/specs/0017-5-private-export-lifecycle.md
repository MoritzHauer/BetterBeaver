# Spec 0017-5: Private Book export/import and lifecycle

Steps 5 and 6 of [plan 0017](../plans/0017-private-books.md), combined — they are small and touch the same two screens. Design decisions are settled in the plan; do not reopen them.

## Context (read first)

- `apps/web/src/content/private-store.ts` — `PrivateBookRecord` `{ id, book, domain, assets, updatedAt }` and its CRUD, including `clearPrivateBooks`.
- `apps/web/src/screens/SettingsScreen.tsx:100-175` — the **existing** Books/Domains export/import for maintainers. Read it for the file-picker and download idioms to match, but do **not** extend it: it is gated on a signed-in maintainer and writes into `bb.author.draft.*`. Private export is a separate feature with a different target.
- `apps/web/src/progress/backup.ts` — `eraseAllData`, which currently clears `localStorage` + the `documents` store.
- `apps/web/src/screens/MyBooksScreen.tsx:59-68` — `handleRemove` and its confirm text.
- `apps/web/src/content/source.ts` — `createPrivateBook`, `privateBookIds`, and the reload helper the membership mutations share.
- `packages/schema/src/documents.ts` — `CONTENT_SCHEMA_VERSION`.

## 1. Export file format

```jsonc
{
  "kind": "bb-private-book",
  "formatVersion": 1,
  "schemaVersion": 1, // CONTENT_SCHEMA_VERSION at export time
  "book": {/* BookDocument */},
  "domain": {/* DomainDocument */},
  "assets": { "<stem>": "data:audio/wav;base64,..." },
}
```

Filename: the Book's title slugified, `.bbbook` extension. Fall back to the Book id if the title slugifies to nothing.

Assets serialise as data URIs (`FileReader.readAsDataURL` or `Blob` → base64). On import, convert back to `Blob` via `fetch(dataUri).then(r => r.blob())` — that is the shortest correct route and needs no manual base64 decoding.

ponytail: the whole file is one JSON string in memory. Add a comment naming the ~20 MB practical ceiling and the upgrade path (zip archive with separate asset entries).

## 2. Export UI

A per-Book **Export** action on the private Book's card menu in `MyBooksScreen` (the existing `<details className="card-menu">` "⋯" menu, alongside Archive/Remove). Only for private Books — `MyBooksScreen` needs to know which those are; pass it the same `privateBookIds` set `App.tsx` already has from step 3.

## 3. Import UI and rules

An **Import a Book…** control in `SettingsScreen`, in its own section, **not** gated on a backend or a session (unlike the maintainer export/import already there). Rules, all of which must be enforced:

1. Reject a file whose `kind !== "bb-private-book"` with a plain message.
2. Reject `schemaVersion > CONTENT_SCHEMA_VERSION` with "update the app first" — mirror the posture of the existing catalog skew check.
3. Validate with the same `validateContent`/`createDocumentContentSource` path the app boots with, **against the user's already-added Books**, so a cross-Book collision (duplicate item id, duplicate domain code) is caught at import rather than turning the Book into a broken card afterwards. Show the error list and refuse.
4. If a Book with the same id already exists, `window.confirm` that importing **replaces** it, then replace. Same UUID = same Book identity; never silently fork a duplicate.
5. On success: `putPrivateBook`, `addToMyBooks` if not already a member, then reload through the same helper the other membership mutations use.

## 4. Private marker on the card

A private Book's card in `MyBooksScreen` shows a small `private` marker near the title. No rating (there are no votes on a Book that no backend knows about). Keep it visually quiet — a `.status`-style chip, not a loud badge.

## 5. Remove must stop lying

`MyBooksScreen`'s `handleRemove` confirm currently reads:

> This removes the downloaded book from this device. Your learning progress is kept, and restored if you add it again. Continue?

That is **false** for a private Book — there is nothing to add it back from. Branch the text:

> "<title>" only exists on this device. Removing it deletes it permanently — it cannot be downloaded again. Your learning progress is kept. Export it first if you want a copy. Continue?

And the removal path itself must call `deletePrivateBook` plus remove it from membership. `purgeUnmembered` cannot do this — it only sweeps the `documents` store, by design.

## 6. `eraseAllData` covers the private store

`progress/backup.ts`'s `eraseAllData` must also call `clearPrivateBooks()`. This is the one sweep that **should** take private Books with it — it is the explicit "erase everything" action, already behind its own confirm. Update that confirm's wording to say Books you created on this device are included, since they are the one thing it destroys that cannot be re-downloaded.

## Done criteria

1. `corepack pnpm check` green, except `ToDo.md`, which is dirty from the owner — do not touch it. Every file you touch must be prettier-clean.
2. Unit tests for the **pure** parts, which are genuinely testable here and worth it: the import validator's rejection rules (wrong `kind`, newer `schemaVersion`). Factor those checks into a pure function taking the parsed object so they can be tested without IndexedDB or the DOM. Do not add `fake-indexeddb`.
3. Typecheck clean.

## Out of scope

Publishing a private Book to the public catalog. Merge/conflict resolution on import beyond replace-or-refuse. Any change to the maintainer export/import already in `SettingsScreen`. Do not touch `packages/`, `cache.ts`, or `idb.ts`.
