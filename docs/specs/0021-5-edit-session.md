# Spec 0021-5: `EditSession` and routing

Slice 5 of [plan 0021](../plans/0021-in-place-editing.md) (§7–§8). Depends on **slice 4**. Self-contained per the `/delegate` convention; **make no new design choices**.

**The riskiest slice in the plan, and the one with the least to show for it.** Nothing looks different afterwards. What changes is that edit mode stops being a destination: `screen: "edit"` is removed, edit mode becomes a flag on the `book`/`lesson`/`unit` routes, and one component owns the Book **and its lexicon** together. Slices 6–9 then have somewhere to plug in.

## Context (read first)

- `apps/web/src/App.tsx` — the `Screen` union (lines 83–155), `editModeFor` (947), `privateBookForDoc` (1005), `openSessionEdit` (1024), `importDocuments` (966), the `sessionEdit` overlay (683–691, 1043–1075), `backActionRef` (694, 1109–1140), and the three `<EditScreen>` renders. **This is the file the slice is about.**
- `apps/web/src/screens/edit/MaintainEditScreen.tsx` (557) — **the whole file.** Its lifecycle is the one being generalised.
- `apps/web/src/screens/edit/ProposeEditScreen.tsx` (399) and `PrivateEditScreen.tsx` (399) — **both whole.** Their differences from Maintain are the branch points.
- `apps/web/src/screens/edit/types.ts` (106) — `draftKey`, `proposalKey`, `EditTarget`, `StoredProposal`.
- `apps/web/src/backend/supabase.ts` — the API surface only (exported signatures, lines 60–330).

~1500 lines. At the top of the design.md budget; do not add reading to it. If it grows, stop and re-slice rather than skim.

## Not in this slice

Any in-place editing (slices 6–7). Preview or Diff (slice 9). Deleting the form editor (slice 11) — `EditScreen` and its forms stay reachable and working throughout.

---

## 0. What "coexist" means here

After this slice, **both editors exist and both work**. `EditSession` owns the document lifecycle; `EditScreen`'s form tree is rendered _inside_ it as the editing surface, replacing the three shells' own copies of load/save/publish. The forms are not touched.

An implementer who deletes a form here strands every surface slices 6–8 have not built yet. Slice 11 is the only slice that deletes.

---

## 1. `apps/web/src/screens/edit/EditSession.tsx` (new)

One component, owning **two documents**, with three modes as branches rather than three components.

```ts
export type EditMode = "maintain" | "propose" | "private";

export function EditSession({
  bookId,
  mode,
  children,
}: {
  bookId: string;
  mode: EditMode;
  /** The learner screens, rendered with editing context available. */
  children: React.ReactNode;
}): JSX.Element;
```

It exposes its state through **React context**, not props: slices 6–7 need it three levels down inside `UnitScreen`'s sub-pages, and threading a dozen props through `BookScreen`/`LessonScreen`/`UnitScreen` for something only edit mode reads would distort every learner signature.

```ts
export interface EditSessionValue {
  mode: EditMode;
  book: BookDocument;
  domain: DomainDocument;
  changeBook: (next: BookDocument) => void;
  changeDomain: (next: DomainDocument) => void;
  /** From slice 4; recomputed on change. Slices 6–8 render these. */
  problems: Problem[];
  /** True when this build's CONTENT_SCHEMA_VERSION is behind the document's. */
  readOnly: boolean;
  /** False when the signed-in user does not maintain the lexicon (§4). */
  canEditLexicon: boolean;
  assets: AssetView[];
  uploadAsset?: (file: File) => Promise<void>;
  save: SaveState;
  publish: PublishState;
}

export function useEditSession(): EditSessionValue | null;
```

`useEditSession()` returns `null` outside a session, so a learner-mode screen calls it safely and renders read-only.

### 1a. Lifecycle, per mode

The three shells' behaviours become branches. Preserve each exactly — they are load-bearing and were each fixed in response to a real bug.

| concern     | maintain                                                                         | propose                                                                                             | private                                                            |
| ----------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| load        | `loadDocument(docId)`, local `bb.author.draft.<docId>` wins over the server copy | `loadCatalogEntry(docId)` + `bb.proposal.<docId>`; a `baseVersion` mismatch discards the local copy | `readPrivateBook(bookId)` — holds both documents already           |
| autosave    | debounced localStorage, 400 ms                                                   | same, under `proposalKey` with `baseVersion`                                                        | debounced write-through to the private store, **including assets** |
| leaving     | flush on unmount **and** `beforeunload`                                          | same                                                                                                | same                                                               |
| server      | explicit `saveDraft` via Sync                                                    | none until submit                                                                                   | none, ever                                                         |
| ship it     | `validateForPublish` → `publishDocument`                                         | `submitProposal`                                                                                    | nothing — every keystroke is already saved                         |
| schema skew | `record.schema_version > CONTENT_SCHEMA_VERSION` → `readOnly`                    | same                                                                                                | not applicable                                                     |

**Do not unify what is genuinely different.** `MaintainEditScreen`'s comments record why several of these are the way they are — the unmount flush, the local-draft-wins rule, the post-publish reload order, the proposal-accept localStorage clear. Carry those comments across; they are the record of bugs already paid for.

### 1b. Two documents

This is the new part. `PrivateEditScreen` already holds the pair; maintain and propose do not.

- **maintain**: load the Book document _and_ `documentId("domain", domainId)`. Both get their own draft key, their own dirty tracking, their own publish. `MaintainEditScreen` today fetches `domainEntries` read-only (lines 101–128) — that fetch is replaced by a full second working document.
- **propose**: same, over `loadCatalogEntry` for each.
- **private**: unchanged — the record already carries both.

The Book's `domainId` comes from `rawPrivateDomainId(book)` (`types.ts:90`), which despite its name is not private-specific.

**`editModeFor` is per document.** A user can maintain the Book and not its lexicon. `mode` on the session is the _Book's_ mode; the lexicon's is resolved separately and drives `canEditLexicon` (§4).

### 1c. The `[⋮]` menu

`apps/web/src/screens/edit/EditMenu.tsx` (new), rendered by `EditSession` and available from all three screens. Carries what has no in-place home:

Publish / Suggest changes · What changed (slice 9; omit here) · Sync · Discard draft · Assets · open proposals · Feedback.

`ProposalReview` and `AssetsManager` **move under `EditSession` unchanged** — do not rewrite them, do not change their props beyond what the new parent passes.

Per mode: propose shows "Suggest changes" and no Sync/Assets/proposals; private shows none of Publish/Sync/Discard/proposals — a private Book has no such moment.

### 1d. Publish covers both documents, invisibly

One `Publish`. It publishes whichever of the two documents changed, in whichever way that document's own mode allows. The word "domain" or "lexicon document" appears nowhere in the UI — the plan's §7 rule.

Order: **Book first, then lexicon.** If the lexicon publish fails, the Book is already out and the failure is reported honestly; the reverse order would leave content referencing entries learners cannot see.

Result copy, one line, no jargon:

- both published → `Published — learners will be offered it.` (today's string, unchanged)
- Book published, lexicon proposed → `Published. 2 word changes were sent for review.`
- nothing changed in one of them → say nothing about it at all.

---

## 2. Routing

### 2a. The `Screen` union

Remove `{ screen: "edit"; docId; target?; mode?; back? }`. Add an `editing` flag to the three learner routes:

```ts
| { screen: "book"; bookId: string; editing?: boolean }
| { screen: "lesson"; bookId: string; lessonId: string; editing?: boolean }
| { screen: "unit"; bookId: string; lessonId: string; unitId: string; atEnd?: boolean; editing?: boolean }
```

Navigating book → lesson → unit **carries `editing` through**. That is the whole point: entering edit mode never moves you, and neither does moving while in it.

`✎` sets `editing: true` on the current screen. Exiting clears it. `backActionRef` (`App.tsx:694`) keeps working unchanged — edit mode is not a history level.

### 2b. Who may enter

One predicate, replacing six call sites (`App.tsx:1564, 1603, 1666, 1793, 1880, 1950`):

```ts
const canEdit = (bookId: string) => isAuthor || isPrivateBook(bookId);
```

`isAuthor` means **signed in at all**, not _maintainer_ — it flips once `listMyDocuments()` settles, deliberately, because propose mode exists for everyone else. The name misleads; do not "fix" it by narrowing the predicate.

### 2c. Routes that used to open the editor

Three call sites currently push `screen: "edit"`. Each needs a destination now:

- **`AuthorScreen`'s two lists** (`AuthorScreen.tsx:193, 215`) pin a mode and open a document by id — including **domain documents**, which have no learner screen. Route a Book document to `{ screen: "book", bookId, editing: true }`. Route a **domain** document to the Book that owns it; when none is added locally, keep it on the old `EditScreen` behind an explicitly-labelled fallback rather than dead-ending. Say so in the PR.
- **`importDocuments`** (`App.tsx:966`) writes a draft/proposal key then opens the editor. Same routing; the storage half is unchanged.
- **`openSessionEdit`** (`App.tsx:1024`) is the question screen's `✎`. **Leave it alone in this slice** — it still layers `EditScreen` over the running session, and slice 13's scoped sheet replaces it later. Touching it here means changing a live session's behaviour for no gain.

### 2d. Content in edit mode

`App.tsx` resolves `content` per `bookId` today. In edit mode it comes from `draftContent(book, domain, assets).content` instead — the seam slice 4 built. One conditional at the resolution point; the screens are not touched in this slice.

`UnitScreen` also needs note markdown from the draft rather than the module-global `getNoteMarkdown`. Add the optional prop now so slice 6 has it:

```ts
noteMarkdown?: (stem: string) => string | undefined;   // defaults to today's global
```

---

## 3. The unsaved-draft marker

Leaving edit mode with an unsynced draft currently leaves it **invisible** — the learner screens render published content and nothing says a draft exists. Add a marker on the Book screen and the My Books card: one quiet line, `unpublished changes`.

Read it from the presence of `bb.author.draft.<docId>` / `bb.proposal.<docId>`, not from session state — the point is that it shows when no session is open.

---

## 4. The lexicon you don't maintain

Plan decision 12. When `editModeFor(domainDocId)` says the signed-in user does not maintain the lexicon, `canEditLexicon` is `false`. Slices 6–7 render those words read-only behind one plain line — _"these words come from somewhere else — you can use them, but not change them"_. No jargon, no document ids, no mention of domains.

`Publish` stays all-or-nothing and always the user's own.

This state is **not** made a validation error and **not** created by any UI. It exists only for a Book that already points at a shared lexicon.

---

## 5. Tests

`App.tsx` has existing route tests — `App.back-nav.test.tsx`, `App.import-route.test.tsx`, `App.session-edit.test.tsx`, `App.nav-perf.test.tsx`. **All four must stay green**; `App.import-route.test.tsx` and `App.session-edit.test.tsx` assert exactly the routes this slice moves, so read them before editing and change assertions only where the route genuinely moved.

New:

- `editing` survives book → lesson → unit → back navigation.
- Hardware back from edit mode behaves as it does from the same screen without it (`backActionRef` unchanged).
- `EditSession` loads both documents in maintain mode; a failed lexicon load leaves the Book editable rather than blocking the session.
- The unmount flush still writes a pending debounced draft — port `MaintainEditScreen`'s existing coverage if it has any, add it if not.
- `canEditLexicon` is false when the lexicon's `editModeFor` is `propose`.
- A private Book's session exposes no Publish, Sync, Discard or proposals.

## Verification

`corepack pnpm check` green. Watch `lint:cycles`: `EditSession` importing the screens while the screens read its context is exactly the shape madge exists to catch — the context must live in its own module if a cycle appears.

Browser, private-Book path first (no account): create a Book, `✎`, navigate book → lesson → unit and back, confirm edit mode persists and nothing visibly changed; confirm autosave still survives a reload.

Then **maintain mode with a real account** — this slice cannot be signed off on the private path alone, because the two-document load, Sync, publish and the schema-skew guard only exist there. Propose mode needs a second account; that is the same outstanding gap STATUS.md already records for the 0012 proposal flow.

## Done-criteria

- `screen: "edit"` is gone from the `Screen` union.
- `editing` is a flag on `book`/`lesson`/`unit` and survives navigation between them.
- One `EditSession` owns both documents in all three modes.
- One `Publish` covers both; the UI never says "domain" or "lexicon document".
- `ProposalReview` and `AssetsManager` work, rehomed and unmodified.
- An unsynced draft is visible from outside edit mode.
- `EditScreen` and its forms still work — nothing is deleted.
- The four existing `App.*.test.tsx` suites pass.
