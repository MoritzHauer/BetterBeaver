# Plan 0021: In-place editing (edit the page you are looking at)

Status: **designed** · Owner: Moe · Date: 2026-07-31 · Direction pinned by a 15-question grilling session (2026-07-31) over the shipped editor, `validate.ts`, the asset pipeline and the content backend migration

## Purpose

Authoring today happens somewhere else. `✎` leaves the Book you were reading and drops you into `EditScreen`, a parallel tree of forms with its own navigation (`View` state machine), its own vocabulary (`item`, `task`, `noteIds`), and UUIDs on nearly every row. A note is a `<textarea rows={14}>` of raw markdown (`BookEditor.tsx:197-204`). Nothing shows what the change will look like until it is published to strangers.

This plan makes the editor disappear into the app. You stay on the page you were reading; its text becomes editable; buttons add tables, callouts and images; a word becomes a lexicon link by selecting it. You never see an id, and you never see a second window. Before publishing, the same three screens toggle between **Edit**, **Preview** and **Diff**, with old content tinted red and new content tinted green.

## Goals

After this plan: an author reading a unit taps `✎` and stays exactly where they were. The unit's title, goal, vocabulary rows, concept rows and example cards become editable in place. The Theory page becomes a block editor — paragraphs, headings, lists, tables, callouts, images — with a selection toolbar for bold and lexicon links. Exercises are chosen from a list of what this unit can actually support, not assembled field by field. Book and Lesson screens edit the same way. A `Preview` toggle plays the draft for real; a `Diff` toggle shows exactly what publishing would change, with a "What changed" index across the whole Book. One `Publish` covers everything, including the Book's lexicon, which is never named. `EditScreen` and its form tree are deleted.

## Non-goals

- **No structural change to the content model.** `BookDocument`/`DomainDocument` stay as they are. `CONTENT_SCHEMA_VERSION` does not bump: the two new note constructs live inside a `markdown` string, which is `z.string()`.
- **No shared-lexicon feature.** Every new Book gets its own lexicon. A Book that already points at someone else's is handled (§7) but never created, offered or explained in product terms.
- **No word-level diffing.** Diff granularity is the field and the note block. A one-word edit tints the whole paragraph red-then-green, which is what the vision describes.
- **No contenteditable.** The note editor is plain inputs and textareas with a selection toolbar. Markdown WYSIWYG's failure modes — caret placement across inline spans, IME composition for Cyrillic, paste normalisation, Android soft keyboards — are each their own multi-day bug and buy nothing the block editor does not.
- **No collaborative editing.** The existing optimistic version check is unchanged.
- **No new editing surface on the question screen.** Its `✎` gets a scoped sheet (§9), not the full session.

## Design decisions (from the 2026-07-31 grilling)

| #  | Decision | Rationale |
|----|----------|-----------|
| 1  | In-place editing covers **Book, Lesson and Unit** screens | Every gesture in the vision lands on one of them. The question screen is a detour, not a destination (design.md:115). |
| 2  | **The form editor is deleted.** The Unit trail grows an edit-only Exercises page and the Book screen an edit-only Sources section, so nothing becomes unreachable | Two editors is the state that produced the problem. Deletion is the *last* slice — see §12. |
| 3  | Learner screens render drafts through **`draftContent`**, a pure adapter that cannot fail, plus **inline problem markers** | `validateContent` is all-or-nothing and a mid-edit draft is legitimately invalid — verified, §1. A lenient variant of `validateContent` is the wrong fix: dropping invalid entities makes the row you are typing into vanish. |
| 4  | Cross-entity problems come from **`checkReferences`, extracted from `validate.ts`** by pure mechanical move | ~40 referential rules exist once. A second, editor-owned rule set drifts into "the editor said it was fine, publish disagrees". |
| 5  | Notes are edited as **blocks over the same markdown string** | `NoteView`'s grammar is the contract and already renders every construct. Untouched blocks keep their raw source, so opening and closing a note produces no diff (§4). |
| 6  | "Boxes" are **named callouts, prose only** — `> [!note\|tip\|warning\|example] Title` | Blockquote syntax degrades to readable prose on an app build older than the change; `::: note` degrades to three stray paragraphs. Flat, so `parseChunk` stays linear. |
| 7  | Note images are a **block figure with caption**, `[img:stem]`, fully validated | The asset pipeline shipped 2026-07-30; `getAssetUrl` already resolves private→remote→bundled. What is missing is syntax, validation and the delete guard — all three, or a deleted asset silently breaks a note for every learner. |
| 8  | A lexicon link stores **`*word*` only**; the picker confirms what it resolves to and offers **+ add a new entry** | Zero new grammar, renders on every existing client. `resolveToken` can silently resolve to the *wrong* entry (`lookup.ts:72`), which nobody can currently see — the readout is the fix. |
| 9  | **Edit / Preview / Diff are modes on the same three screens**, plus a "What changed" index | With in-place editing, "new" is already what you are looking at; Preview earns its place only by rendering *validated* content with playable tasks. Without the index you must walk the Book to find your own edits. |
| 10 | Diff's base is **what publishing would replace** | Maintain: `record.published`. Propose: `StoredProposal.baseVersion`. Never published: `emptyDocFor(kind)`. Private Books get Edit + Preview only — they have no "before". |
| 11 | **Every Book owns its own lexicon**, and the domain is never named in the UI | design.md:51 already pins `Domain` as invisible plumbing; the editor was the one place that broke it. Verified to need no migration (§7). Accepted cost: a word in two Books gets two SRS states — the cost design.md already records for private Books. |
| 12 | A shared lexicon is **not offered; read-only if encountered** | The rarest path gets the simplest safe behaviour instead of a partial-publish mechanism nobody will exercise. Not made a validation error: not foreclosed, just not built. |
| 13 | The question screen's `✎` opens a **scoped sheet** holding only the tapped item or task | Preserves design.md:115 (session hidden, never unmounted) without mounting a whole navigable editor over a live session. |
| 14 | The Exercises page **offers only what is constructible** | `TASK_ALLOWED_ITEM_KINDS`, `TASK_REQUIRED_ASSET` and `TASK_NEEDS_DISTRACTORS` are exhaustive tables; validator classes (e)/(f)/(o) do the rest. Fold them and invalid tasks become unreachable rather than explained. |
| 15 | Sliced **visible-first**: the note block editor ships inside the existing form editor before any architecture moves | Slices 1–3 deliver most of the visible vision at zero architectural risk, verifiable through the private-Book path that is already browser-verified end to end. |

---

## Design

### 1. Why a draft cannot render through `validateContent`

`validateContent` returns `{ content } | { errors }` — there is no partial result — and `EditScreen`'s own header comment already records that a draft mid-edit may be invalid. Running it against realistic drafts confirms this is not an edge case:

**The very first click.** `BookEditor.tsx:318` creates `{ id, kind, payload: {}, sourceRef: "" }`:

```
ky-i1: payload.text: expected string, received undefined;
       payload.translation: expected string, received undefined;
       sourceRef: must be a valid slug
```

Every item is invalid the instant it exists, before a keystroke. `+ New unit` gives `unit has zero tasks`; `+ New lesson` the same shape.

**Typing a reference before its target exists:** `ky-i1: dangling sourceRef "manas-primer"`. **Renaming an item a task points at:** `ky-t1: dangling item reference "ky-i9" in itemIds`. **A note added but not yet wired:** `ky-u1: dangling note reference "ky-note-n1" in noteIds`.

And these arrive in **waves**: `validate.ts:254` returns after the zod phase, so the first example's errors mask the other three entirely, and `validate.ts:303` returns again after the uniqueness phase.

So the editor gets a second, non-failing path.

```ts
// packages/engine/src/draftContent.ts  (new)
export interface ParsedSet {
  book: Book; lessons: Lesson[]; units: Unit[];
  items: Item[];        // book-owned ONLY — see below
  tasks: Task[]; resources: Resource[]; notes: { id: string; stem: string }[];
  domain: Domain; entries: Item[]; families: Family[];
}

export function draftContent(
  book: BookDocument,
  domain: DomainDocument,
): { content: Content; parsed: ParsedSet };
```

It constructs rather than parses, so it cannot fail: `str(v)` returns `""` for a non-string, `ids(v)` filters an array to its string members, `obj(v)` yields `{}` for a non-object. Item payloads are filled per `kind` (the discriminator the editor always sets from a select), optional slug fields are dropped rather than coerced. Roughly 70 lines.

**Two return shapes, not one, and this is load-bearing.** `Content.items` is post-merge — `validate.ts:902` returns `[...items, ...referencedEntries]` — while the `${book.code}-` prefix check at `validate.ts:320-324` iterates the *unmerged* `items`. Handing `Content` to the reference checker would report every lexicon entry as wrongly prefixed. Today that is invisible because the seed's Book code and lexicon code are both `dx`; it fires the moment they differ, which decision 11 makes routine. `content` renders; `parsed` is checked.

`draftContent` also replicates the merge at `validate.ts:892-902` (book items plus the entries this Book's units actually reference), or the Vocabulary page is empty in edit mode.

### 2. Extracting `checkReferences`

A pure mechanical move: everything in `validateContent` after the uniqueness phase becomes an exported function, and `validateContent` calls it. Parameters mirror the local bindings at `validate.ts:305-317` — `book, lessons, units, items, tasks, resources, notes, domain, entries, families` — **not** `Content`, per §1.

```ts
export function checkReferences(parsed: ParsedSet): string[];
```

Zero behaviour change; existing tests unchanged. The uniqueness early return at `validate.ts:303` stays *inside* the extracted function — the by-id maps below it are genuinely ill-defined when ids collide, and with generated UUIDs that case is vanishingly rare.

The editor then gets both waves at once, with no rule duplicated:

```
draftContent(book, domain) ─┬─→ content  → render
                            └─→ parsed   → checkReferences → markers
```

### 3. Problem markers

Two sources, neither of them a new rule set:

- **Field-level** — run the entity's own zod schema per entity (`itemSchema.safeParse(entity)`); `issue.path` anchors the marker to the exact field. No changes to anything.
- **Entity-level** — `checkReferences` output, split on its leading `<id>: ` prefix and attached to that entity's card.

A marker is a quiet triangle plus one line, not an error dialog. The publish panel keeps its list, but by then it should be empty.

### 4. The note block editor

`NoteView`'s parser moves to `apps/web/src/content/noteBlocks.ts` (pure, DOM-free, beside the existing `noteTitle.ts`) and is exported for both `NoteView` and the editor. `Block` gains one field:

```ts
type Block = ({ kind: "paragraph"; text: string } | …) & { raw: string };
```

**`raw` is what makes the feature safe.** Real notes are hand-wrapped, and `parseBody` joins wrapped lines with `" "`. A naive parse→serialise round trip turns a four-line paragraph into one long line — identical rendering, enormous textual diff, and every note the author merely *opened* shows up in Diff. Serialisation emits `raw` verbatim for any block the author did not touch.

Editing controls per block kind, all plain form elements: heading → `<input>`; paragraph → `<textarea>`; list → one `<input>` per item with add/remove/reorder; table → a grid of `<input>`s with add row/column; callout → variant dropdown plus a `<textarea>`; figure → thumbnail plus caption `<input>`.

The selection toolbar acts on the focused control via `selectionStart`/`selectionEnd`: **B** wraps `**…**`, the lexicon button wraps `*…*` (§6), and an icon button inserts `[icon:name]`. Block-level buttons below the list add each block kind.

### 5. Callouts and figures

Two additions to the grammar. Neither bumps `CONTENT_SCHEMA_VERSION` — a note is a `markdown` string, and `z.string()` accepts anything — so there is no republish and no old client rejecting content. An app build older than the change renders the new syntax as literal text, which is why both forms are chosen to degrade readably.

**Callout** — `parseChunk` gains a case for a run of `>` lines:

```
> [!warning] Watch out
> *Салам* is informal — use *Саламатсызбы* with elders.
```

Variants `note | tip | warning | example`, each with a tint and a glyph from the app's existing `art/icons` set. The title is optional. Contents are inline runs only — flat, so the parser stays linear and the editor needs no nested block list.

**Figure** — `[img:stem]` as a block, with the rest of the line as its caption. Mirrors the existing `[icon:name]` form. `getAssetUrl(bookId, "img", stem)` already resolves through the private, remote and bundled overlays, so rendering is one case. What is missing is everything around it:

- `ValidateContentInput` gains `noteImageRefs: string[]`, checked against `imageStems` exactly as item `imageRef`s already are. One call site (`documentSource.ts:195`), so this is cheap.
- `assetReferences()` (`AssetsManager.tsx:35`) scans note markdown as well as item payloads, so deleting an image a note uses is blocked and names the note.
- **Both of those scans call one exported `noteImageStems(markdown): string[]` in `content/noteBlocks.ts`.** Two independent regexes over the same syntax drift, and the failure is silent in both directions: publish passes while the delete guard reports no references, or the guard blocks a deletion nothing uses. Same reasoning as `checkReferences` in §2 — the rule exists once.
- The `+ image` button opens the document's uploaded assets as thumbnails (`AssetView[]`, already built by the shell) with an upload action. **A stem is never typed.**
- `scripts/export-content.ts` needs **no change** — checked while specifying slice 2. `downloadSeedAssets` enumerates every object under a document's Storage prefix and writes all of them; it never scans content for references, so a note figure in the onboarding Book is already downloaded.

### 6. Lexicon links

`*word*` stays exactly as it is: `NoteView` calls `onTap(text)`, `EntryPopup` runs `resolveToken`. No new grammar, so every existing client renders authored content unchanged.

What is new is that the author can see what they authored. `resolveToken` matches exactly, then falls back to the longest entry ≥3 chars that prefixes the token (`lookup.ts:72`), with ties broken by lowest id — so a star can resolve to a *different* word than intended, silently. The picker shows the outcome:

```
→ ✓ Рахмат · thanks              (exact)
→ Салам · hello                  (prefix match, not exact)
→ ⚠ no entry
```

…alongside a search over the lexicon and **+ add a new entry**, which reuses `AddWordForm` widened with `makeId`/`sourceRef` props — the same pattern `AddEntityForm` already uses. Today it hardcodes `newUserEntryId()` (a `user-` prefixed, localStorage-only id) and `sourceRef: "user"`, neither of which is right for authored content.

Note the grammar has **no plain italic**: `*…*` is the lexicon marker. Adding `_italic_` would mean new syntax, a new `parseInline` case and underscores on old builds, for emphasis `**bold**` already covers. Not added.

**Add-entry is staged.** Creating a lexicon entry writes the *domain* document. Only `PrivateEditScreen` holds both documents today; `MaintainEditScreen` fetches `domainEntries` read-only and `ProposeEditScreen` has no domain path at all. Building a domain write for maintain mode before `EditSession` exists means a second local draft, sync, publish and schema-skew guard built ad hoc and rewritten in slice 5. So slice 3 ships the readout and search everywhere and the add row **disabled with a reason** outside private Books — it becomes live when §8 lands, with no further work.

### 7. The Book and its lexicon are one thing

design.md:51 already says `Domain` keeps its name as *"invisible plumbing"*. The editor was the one place that broke that. From this plan on:

- The words "domain" and "lexicon document" do not appear in any editing UI.
- One editing session holds **both** working documents — the shape `PrivateEditScreen` already proves — and routes an edit to whichever owns the entity. A Vocabulary row is just editable.
- One `Publish` covers both.
- **Creating a Book creates the pair.** This also fixes something currently broken: long-tail spec §4 lets any signed-in user create a Book, but domains were documented as admin-created — so today you would create a Book pointing at a lexicon you cannot create.

Creation needs **no migration**, verified against `supabase/migrations/20260719000000_content_backend.sql`:

```sql
grant insert (id, kind, draft, schema_version, created_by) on public.documents to authenticated;
create policy documents_insert on public.documents
  for insert to authenticated with check (created_by = auth.uid());
```

`kind` is in the grant and unrestricted by the policy (the table's own check constraint allows `'topic'` and `'domain'`), and `documents_creator_maintainer` fires on any insert with `created_by not null`. "Domains stay admin-created" was a product choice, not a backend constraint.

**Derive the lexicon's `code` from the generated document id, not from a user-chosen Book slug.** `validateContentSet` enforces globally unique *domain* codes but never checks Book codes — so a slug-derived lexicon code can collide where a duplicate Book code would not.

**The shared case.** Nothing creates or reveals one. If a Book points at a lexicon the signed-in user does not maintain, its words render read-only in edit mode behind one plain line — *"these words come from somewhere else — you can use them, but not change them"* — and `+ add a new entry` is hidden. `Publish` stays all-or-nothing and always the user's own. This is deliberately not a validation error: the state is not foreclosed, just not built for.

### 8. `EditSession` and routing

`screen: "edit"` is removed. Edit mode becomes a flag on the existing `book` / `lesson` / `unit` routes, so navigating between them keeps it and entering it never moves you.

`EditSession` mounts on enter and unmounts on exit, owning everything `MaintainEditScreen` owns today, for **both** documents: load, debounced localStorage autosave, the `beforeunload`/unmount flush, Sync, Publish, discard draft, the read-only schema-skew guard, open proposals, assets, feedback. The three existing shells collapse into it, keeping their distinct lifecycles as branches on `mode` (`maintain` | `propose` | `private`) rather than as separate components: `editModeFor(docId)` already resolves this per document and is unchanged.

`ProposalReview` and `AssetsManager` move under `EditSession` unchanged.

Everything with no in-place home lives in a `[⋮]` menu available from all three screens: Publish / Suggest changes, What changed (§10), Sync, Discard draft, Assets, open proposals, Feedback.

**Who may enter** is one predicate, unchanged from today's six call sites (`App.tsx:1564, 1603, 1666, 1793, 1880, 1950`): `isAuthor || isPrivateBook(bookId)`. The name misleads and is worth restating — `isAuthor` means *signed in at all*, not *maintainer*: it flips once `listMyDocuments()` settles, deliberately, because propose mode exists for everyone else. A private Book has no account behind it, hence the second clause.

**Leaving edit mode with an unsynced draft currently leaves it invisible** — the learner screens render published content and nothing says a draft exists. The Book card and the Book screen gain a marker.

### 9. Exercises and Sources

One edit-only page on the Unit trail, one edit-only section on the Book screen, and one scoped sheet. (**Amended while specifying slice 8**: `resources` is a field of `BookDocument`, shared across every unit, so Sources belongs on the Book screen rather than the Unit trail.)

**Exercises.** `+ add an exercise` lists only the task types this unit can support, pre-filled with the eligible items — one tap makes a valid task. The list is a fold over tables that already exist: `TASK_ALLOWED_ITEM_KINDS` (`entities.ts:408`), `TASK_REQUIRED_ASSET` (`:426`), `TASK_NEEDS_DISTRACTORS` (`:445`), plus validator classes (e) no-mixed-kinds, (f) items-owned-by-the-unit and (o) type/kind match. Types that cannot be built are shown greyed with the reason ("needs audio", "no pairs in this unit"). Editing an existing exercise is a type dropdown and an item picker filtered to that type's kinds. Invalid tasks become unreachable rather than explained.

**Sources**, on the Book screen. `resources`, each item's `sourceRef`, **and each item's `audioRef`/`imageRef`** — the last is the only surface that can set them once the form editor is deleted, so without it the four asset-backed exercise types become permanently unreachable. Note the two asset pools: a book item's refs validate against the Book's stems, a lexicon entry's against the lexicon's. `sourceRef` is required on every item and its pool is the Book's `resources` — empty on a new Book, which is why `fields.tsx:306`'s `freeTextWhenEmpty` escape hatch exists and why every new item currently starts with a `dangling sourceRef` error. **Book creation seeds one resource (the Book itself), and new items default `sourceRef` to it.** That deletes the hatch and error wave 1 together.

**The question screen's `✎`** opens a sheet over the running session holding only the tapped item or task, using the same field controls the Unit page uses. The session stays mounted underneath, exactly as design.md:115 requires; the sheet closes back into the question.

### 10. Preview, Diff, and what changed

A mode switch in the header of all three screens.

**Preview** builds a real `createDocumentContentSource(draftBooks, draftDomains, assets)` and renders the learner screens against it with a no-op in-memory `ProgressStore`, so tasks play and nothing is recorded. If the draft does not validate, the errors render instead — preview of an invalid draft is undefined.

**Preview unlocks everything.** `attemptedTaskIds` is an App-level prop (`App.tsx:1542`), not read from the store inside the screens, so preview passes a full set — every lesson and unit reachable in one tap. Preview's job is inspecting content, not simulating a learner; checking unit 12 should not cost eleven skip-ahead confirms. A bad unlock chain is caught structurally anyway: cycles by validator class (l), dangling gate refs by the reference checker. (Moot today — no content sets `unlocksAfter*` at all, and the editor has never had a form for it. This plan gives those fields their first learner surface, so authors will start setting them.)

Two consequences of that full set, both to be handled in the same slice: `nextUnit` returns `null` and `dueUnits` returns nothing against a no-op store, so the Book screen's **Play** card would show the trophy "Book complete" and **Daily Review** would be permanently disabled. Both are progress-derived affordances with no meaning in preview — hide them. **Practice** stays: it shuffles over unlocked lessons, which is exactly what preview wants.

One trap: `registerRemoteAssets` populates the asset overlay from *cached* documents at boot, so an asset uploaded for an unpublished draft is not in it and preview would report a dangling ref for a file that exists in Storage. The shell already holds the live list from `listDocumentAssets`; those stems must be threaded into the `AssetStems` argument deliberately.

**Diff** renders **union content**: a `Content` containing both the base and the draft, plus a per-entity classification.

```ts
// packages/engine/src/diffContent.ts  (new)
export function diffContent(base: BookDocument, draft: BookDocument): {
  content: Content;                                    // union — base ∪ draft
  status: Map<string, "added" | "removed" | "changed" | "unchanged">;
  before: Map<string, unknown>;                        // for changed entities
};
```

The union is what makes deletions visible: a removed entity is not in the draft, so without it there is no row to tint red. Changed entities render old (`.diff-old`, light red) directly above new (`.diff-new`, light green); added renders green only, removed red only.

For notes, `documentDiff`'s existing per-field comparison is useless — a note's whole `markdown` is one field, so a one-word edit reads as "entire note changed". Note diffing is block-level: split both versions into blocks, classify by content-set membership, no move detection. About fifteen lines, and correct enough for backgrounds.

**Diff's base** is what publishing would replace: `record.published` in maintain mode, the catalog version at `StoredProposal.baseVersion` in propose mode (already stored, and already driving `ProposalReview`'s stale-base banner), `emptyDocFor(kind)` for a never-published Book. **Private Books get Edit and Preview only** — there is no "before" to compare against.

**The Diff tab appears only on a screen that has changes** — Book: its own fields or `lessonIds`; Lesson: its own fields or `unitIds`; Unit: its own fields or any item, task or note it owns. All of those are one predicate over `diffContent`'s `status` map, which is computed Book-wide regardless. The tab's presence is then itself a signal, and there is no empty state to word. Two things follow: the header must reserve the control's width so it does not jump as you navigate between a changed and an unchanged screen, and the What-changed index cannot live behind the Diff tab, since the tab is absent exactly where you most need to find the changes.

**What changed** therefore lives in the `[⋮]` menu, always reachable, with the count as a badge — which doubles as the answer to "is there anything to review?". It is a per-Book index of every touched entity, grouped by lesson, each row deep-linking to the screen that owns it, already in Diff mode. Without it, answering "what am I about to publish?" means walking the Book — which matters most in propose mode, where a maintainer judges the whole submission. No collapsing until real content demands it: the only Book measurable in-repo is the demo seed (1 lesson, 3 units, 3 items, 13 tasks).

### 11. Ids, and why publish errors must deep-link

Ids disappear from the UI. `EntityPicker` shows them today for a reason: validation errors name ids, and spec 0018 made ids generated UUIDs precisely so authors stop hand-typing slugs. Hide them without a replacement and `checkReferences` output becomes unlocatable.

The replacement is deep-linking: an error's leading id maps through the existing `EditTarget` / `initialView` machinery to the screen that owns that entity, opened in Diff or Edit mode. Every error line in the publish panel is a link. Ids remain in the underlying data, in exported files and in the JSON tooling (`scripts/pull-book.ts`) — they are hidden, not removed.

### 12. What gets deleted, and when

Deleted outright, 1271 lines: `BookEditor.tsx` (563), `fields.tsx` (438), `DomainEditor.tsx` (203), `EditScreen.tsx`'s dispatcher (67). Replaced rather than removed, 1355 lines: `MaintainEditScreen.tsx` (557), `ProposeEditScreen.tsx` (399), `PrivateEditScreen.tsx` (399), whose three lifecycles collapse into `EditSession` as branches on `mode` — expect a meaningful part of that to reappear there, since it is real I/O, not duplication. `ProposalReview` (205) and `AssetsManager` (239) survive unchanged, rehomed.

**Deletion is the last slice.** Every slice before it ships with the form editor still present and reachable, which means both editors coexist for most of this plan. That is the end state decision 2 rejects, and it is fine as a transition — but an implementer who deletes early strands every surface that has not been rebuilt yet. Nothing before slice 11 removes a form.

---

## Schema changes (`packages/schema`)

- `ValidateContentInput` gains `noteImageRefs: string[]`, checked against `imageStems` (§5). One call site.
- `checkReferences` extracted and exported from `validate.ts` (§2). Pure move, no behaviour change.
- `CONTENT_SCHEMA_VERSION` is **not** bumped.

## Engine changes (`packages/engine`)

- `draftContent.ts` (new) — the non-failing adapter, returning `{ content, parsed }` (§1).
- `diffContent.ts` (new) — union content plus per-entity status, and block-level note diffing (§10).
- `noteBlocks.ts` (new) — `NoteView`'s parser extracted, `raw` per block, a serialiser, and (slice 2) `noteImageStems`. **Engine, not `apps/web`**: the layering rule puts pure functions over core types here, and `documentSource.ts` must call `noteImageStems` to feed the validator — engine cannot import from `apps/web`.
- `documentDiff.ts` unchanged and still used by `ProposalReview`.

## Web changes (`apps/web`)

- `content/noteIcons.ts` (new) — the `[icon:name]` name list, pinned to `public/art/icons/` by a test. Stays in `apps/web`: it is that app's own asset set.
- `NoteView.tsx` — callout and figure rendering; parser imported rather than local.
- `components/NoteEditor.tsx` (new) — the block editor and selection toolbar.
- `components/AddWordForm.tsx` — widened with `makeId` / `sourceRef`.
- `screens/edit/EditSession.tsx` (new) — the shell for both documents, all three modes (§8).
- `BookScreen` / `LessonScreen` / `UnitScreen` — an `editing` prop, a mode switch, edit-only Unit pages, diff tints. `UnitScreen` also gains `noteMarkdown?: (stem) => string | undefined`, defaulting to today's `getNoteMarkdown` global, so edit mode can read the draft's own note text.
- `App.tsx` — `screen: "edit"` removed; edit mode becomes a flag on `book`/`lesson`/`unit`.
- `screens/edit/AssetsManager.tsx` — `assetReferences` scans note markdown.
- Deleted at slice 11: `EditScreen.tsx`, `edit/BookEditor.tsx`, `edit/DomainEditor.tsx`, `edit/fields.tsx`, `edit/MaintainEditScreen.tsx`, `edit/ProposeEditScreen.tsx`, `edit/PrivateEditScreen.tsx`.

## Docs

- `docs/design.md` — new decision rows for 1–15; the "Content backend & in-app editing" paragraph amended (form-based screens → in-place editing).
- `docs/STATUS.md` — this plan's row; handoff-backlog item 3 (`0012-editor-long-tail`) narrows: its §2 (draft preview) is superseded here, §1's remaining forms are absorbed, §4–§6 (topic creation, admin listing, rollback) stay open.
- `docs/specs/` — one spec per slice below.

## Implementation order

Visible first, foundation second (decision 15). Each slice is delegable and leaves `pnpm check` green.

| # | Slice | Notes |
|---|-------|-------|
| 0 | Land the uncommitted `App.tsx` / `MyBooksScreen` / `StartScreen` / `styles.css` / `LegalLinks` / `ImpressumScreen` work | Slices 5+ rewrite `App.tsx` routing |
| 1 | Note blocks core — parser extraction with `raw`, serialiser, block editor, selection toolbar. **Spec: [0021-1-note-blocks](../specs/0021-1-note-blocks.md)** | Drops into `BookEditor.tsx:197-204`, replacing the `<textarea>`. Touches no architecture. **`NoteEditor`'s interface is pinned as `(markdown: string, onChange: (markdown: string) => void)`** — a bare string, never `BookEditor`'s `doc` / `setNote(doc, stem, md)` shape. It mounts inside a file slice 11 deletes and remounts on the Unit screen at slice 6; the wrong interface makes that a rewrite instead of a prop change |
| 2 | Callouts and figures — grammar, `NoteView` rendering, `noteImageRefs`, `assetReferences`, asset picker. **Spec: [0021-2-callouts-and-figures](../specs/0021-2-callouts-and-figures.md)** | |
| 3 | Lexicon picker — resolution readout, search, `+ add a new entry`. **Spec: [0021-3-lexicon-picker](../specs/0021-3-lexicon-picker.md)** | **Visible vision complete.** `+ add a new entry` ships **private-mode only**: it writes the domain document, and only `PrivateEditScreen` can today (§6). The add row is disabled-with-a-reason elsewhere and lights up when slice 5 lands, with no change to slice 3's code |
| 4 | `draftContent` + `checkReferences` extraction + problem markers. **Spec: [0021-4-draft-content-and-problems](../specs/0021-4-draft-content-and-problems.md)** | Pure and unit-testable; no UI |
| 5 | `EditSession` + routing. **Spec: [0021-5-edit-session](../specs/0021-5-edit-session.md)** | The riskiest slice; nothing visible changes. ~1500 lines of reading — at the top of the budget |
| 6 | In-place Unit. **Spec: [0021-6-in-place-unit](../specs/0021-6-in-place-unit.md)** | Where the vision first becomes visible |
| 7 | In-place Book / Lesson. **Spec: [0021-7-in-place-book-lesson](../specs/0021-7-in-place-book-lesson.md)** | Repeats slice 6's pattern; smaller |
| 8 | Exercises + Sources. **Spec: [0021-8-exercises-and-sources](../specs/0021-8-exercises-and-sources.md)** | Exercises on the Unit trail; **Sources on the Book screen**, since `resources` is Book-owned |
| 9 | Preview / Diff / What-changed index. **Spec: [0021-9-preview-diff](../specs/0021-9-preview-diff.md)** | Needs a real account — private Books have no Diff |
| 10 | Book+lexicon creation, seeded resource, publish-error deep-linking. **Spec: [0021-10-creation-and-error-links](../specs/0021-10-creation-and-error-links.md)** | Verified: needs no migration |
| 11 | Delete the form editor. **Spec: [0021-11-delete-form-editor](../specs/0021-11-delete-form-editor.md)** | Gated on 1–10 landed **and** browser-verified. Also builds decision 13's scoped sheet, without which `EditScreen` cannot go |

Slices 1 and 2 were each measured against design.md:145's budget when their specs were written: ~1000 and ~1150 lines of required reading respectively, both comfortably inside it, so neither splits. Later slices are unmeasured — measure before delegating, do not assume.

## Done-criteria

- An author edits a unit's title, goal, vocabulary, concepts and examples without leaving the unit, and never sees an id.
- A note is edited as blocks; tables, callouts and figures are added by button; bold and lexicon links by selection.
- A word starred in a note shows which lexicon entry it will open, and a missing one can be added without leaving the note.
- Exercises are created from a list of what the unit supports; no publish error can be produced by the Exercises page.
- Preview plays the draft's tasks for real and records nothing.
- Diff shows added, removed and changed content in place, red for old and green for new, with a per-Book index.
- One `Publish` covers the Book and its lexicon; the word "domain" appears nowhere.
- Creating a Book yields a Book, its lexicon and one seeded resource, and its first item is valid on creation.
- `EditScreen.tsx` and its form tree are gone.

## Verification

Per slice, in a real browser. The private-Book path needs no accounts and is already browser-verified end to end (see STATUS.md, "Editor split + cycle gate") — it is the cheapest harness for slices 1–9. Slices 10 and 11 additionally need a signed-in maintainer, and propose mode needs two real accounts, which is the same outstanding gap the 0012 proposal-flow entry already records.

End-to-end target: create a Book → author a lesson, unit, words and a note with a table, a callout and an image → add exercises → Preview and play them → Diff against nothing → publish → edit a word, Diff, publish again, and see only that word tinted.

## Open questions

None outstanding. The five raised at design time were resolved on 2026-07-31 and folded into the sections above:

1. **Diff tab visibility** → §10: the tab appears only where that screen has changes; the What-changed index moves to `[⋮]` so it stays reachable, and the header reserves the control's width.
2. **What-changed index scale** → §10: grouped by lesson, no collapsing, revisit when content demands it (the only in-repo Book is the 1-lesson demo seed).
3. **Preview and unlock gates** → §10: preview passes a full attempted-task set, so everything is open; Play and Daily Review are hidden as meaningless there.
4. **Edit-mode gating** → §8: unchanged, `isAuthor || isPrivateBook(bookId)`, six call sites collapsing to one.
5. **Superseded long-tail sections** → struck in place inside `specs/0012-editor-long-tail.md`, each pointing at the 0021 section that replaces it; §4–§6 stay live there.
