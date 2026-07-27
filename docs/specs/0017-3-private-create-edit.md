# Spec 0017-3: Create and edit a private Book

Step 3 of [plan 0017](../plans/0017-private-books.md). Steps 1–2 already ship the store and the read path — a private Book that exists in IndexedDB is already listed on My Books, opens, and is studiable. This step lets a learner **create and edit one in the app**, with no account and no network. All design decisions are settled in the plan; do not reopen them.

## Context (read first)

- `apps/web/src/content/private-store.ts` — `PrivateBookRecord` `{ id, book, domain, assets, updatedAt }`, plus `readPrivateBook`, `putPrivateBook`, `deletePrivateBook`.
- `apps/web/src/content/private-ids.ts` — `newPrivateId()`.
- `apps/web/src/screens/EditScreen.tsx` — study its shape before writing anything. `EditScreen` (`:374`) dispatches on `mode` to `ProposeEditScreen` (`:404`) or `MaintainEditScreen` (`:733`). **Those two are I/O shells**: they hold `working` state and own every Supabase call. `BookEditor` (`:1332`), `DomainEditor` (`:1785`), `Field`, `EntityForm`, `IdListField`, `AddEntityForm`, `RowActions` are props-in/props-out and know nothing about the backend. `emptyDocFor(kind)` (`:1137`) builds a blank document.
- `apps/web/src/App.tsx` — the `Screen` union (`:65-122`, the `"edit"` variant at `:110-117`), `isAuthor` (`:632`), and the three ✎ call sites (`:1189`, `:1227`, `:1289`).
- `apps/web/src/screens/MyBooksScreen.tsx` — the home list and its `onLibrary` entry card.
- `apps/web/src/content/myBooks.ts` — `addToMyBooks`.
- `apps/web/src/content/source.ts` — `initContentSource`'s returned `ContentInit`, and how `addBook`/`removeBook` trigger a reload.

## 1. `PrivateEditScreen` — a third shell, not a new editor

Add a third mode to `EditScreen`: `mode?: "maintain" | "propose" | "private"`. When `"private"`, render a new `PrivateEditScreen` that reuses `BookEditor` and `DomainEditor` **unchanged**.

Its I/O replaces all five Supabase primitives with the private store:

| Maintainer path                       | Private path                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `loadDocument(docId)`                 | `readPrivateBook(bookId)` → `record.book` or `record.domain`                                                                   |
| `saveDraft` / Sync button             | direct `putPrivateBook` autosave — **there is no server draft, so there is no Sync button and no draft/published distinction** |
| `publishDocument` / Publish button    | none — remove it. Edits are live immediately.                                                                                  |
| `discardDraft`                        | none                                                                                                                           |
| `listOpenProposals` / proposal review | none                                                                                                                           |

Keep the maintainer path's **local** autosave idiom (debounced writes, flush on unmount/tab-close) but write to the private store instead of `bb.author.draft.*`. Do not introduce a `bb.author.draft.*` key for private Books — the store is the single source of truth.

Validation: run the same `validateContent` the rest of the app uses and show the error list inline, exactly as the maintainer editor already does before publish. **Do not block saving on validation** — a half-built Book is a normal intermediate state, and the read path already routes an invalid Book to a broken card rather than crashing (see `bookDocumentShapeError` and plan 0015 decision 11a). Saving invalid content is allowed; the errors are shown so the author can fix them.

The screen edits **both** documents of the Book. The book root view needs a way to reach the Book's own Domain (its lexicon), since a private Book always owns one and there is no catalog list to reach it from. A link/tab on the root view is enough.

`hasCoverArt` is **hidden in the private editor** (plan 0017 open-questions resolution): its asset convention is `art/icons/<book.id>.png` in the app's _public_ assets, which a private Book cannot write to, so the toggle could only ever produce a silently-missing image.

## 2. Creating a Book

A new `createPrivateBook(title: string)` in `apps/web/src/content/source.ts` (next to `addBook`):

1. `const bookId = newPrivateId()`, `const domainId = newPrivateId()`.
2. Build the record from `emptyDocFor`-shaped documents, filled in enough to be a _valid_ starting point — this matters, so be precise. From the real content files, a minimum viable Book needs:
   - `topic`: `{ id: bookId, code: <see below>, title, domainId, lessonIds: [], description: "" }`
   - `domain`: `{ id: domainId, code: <same code>, kind: "general", title, glossLanguage: "en" }`
   - empty `lessons`/`units`/`items`/`tasks`/`resources`/`notes`, empty `entries`/`families`.
3. `putPrivateBook`, then `addToMyBooks(bookId)`, then reload through the same helper `addBook` already uses so the app lands back on My Books (plan 0015's session flag that skips the welcome cover).

**The `code` field is load-bearing and easy to get wrong.** Verified against the validator: every lesson/unit/item/task/resource id must start with `` `${book.code}-` ``, and the domain has its own separate `code` which must be globally unique across all added Books. Generate a code that cannot collide — derive it from the book UUID (e.g. its first 8 hex characters), not from the title. Use the same code for the Book and its Domain, matching how the shipped Books do it. Every entity the editor creates inside a private Book must be given an id of the form `` `${book.code}-${newPrivateId()}` `` so it satisfies both the prefix rule and global uniqueness.

## 3. Entry point on My Books

`MyBooksScreen` gains an `onCreateBook?: () => void` prop, rendered as a card directly below the Library card, styled the same way. Unlike the Library card it is **always shown** — it needs no backend and works in offline mode.

Tapping it prompts for a title (`window.prompt` is fine and matches the codebase's existing use of `window.confirm`; do not build a modal) and calls `createPrivateBook`. An empty/cancelled title aborts.

## 4. Reaching the editor again

The three ✎ Edit call sites in `App.tsx` (`:1189`, `:1227`, `:1289`) currently render only when `isAuthor`. They must **also** render when the Book being viewed is private, regardless of `isAuthor` — a private Book has no account behind it. Route those to `{ screen: "edit", docId: documentId("topic", bookId), mode: "private", back: screen }`.

`App.tsx` needs to know which Book ids are private. Expose that from `initContentSource` (a `privateBookIds: Set<string>` on `ContentInit` is the least invasive shape) rather than re-reading IndexedDB in the view layer.

The `"edit"` Screen variant's `mode` already exists — extend its union with `"private"`.

## Done criteria

1. `corepack pnpm check` green, except `ToDo.md`, which is dirty in the working tree from the owner — do not touch or reformat it. Every file you touch must be prettier-clean.
2. Existing tests still pass. No new unit tests required (this is UI + IndexedDB; jsdom has no IndexedDB, matching the `cache.ts` precedent). Do not add `fake-indexeddb`.
3. Typecheck clean, which will catch the `Screen` union and prop threading.

## Out of scope

The editor's asset picker (step 4), export/import (step 5), the private card marker, branched Remove confirm and `eraseAllData` coverage (step 6). Do not change the maintainer or propose paths' behaviour — you are adding a third branch beside them, not refactoring them. Do not touch `cache.ts`, `idb.ts`, `private-store.ts`, or anything in `packages/`.
