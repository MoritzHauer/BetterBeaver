# Spec 0021-6: In-place editing on the Unit screen

Slice 6 of [plan 0021](../plans/0021-in-place-editing.md) (§1, §3). Depends on **slices 4–5**; uses slices 1–3's `NoteEditor` if landed. Self-contained per the `/delegate` convention; **make no new design choices**.

This is where the vision first becomes visible: the Unit screen's five pages stop being read-only.

## Context (read first)

- `apps/web/src/screens/UnitScreen.tsx` (651) — **the whole file.** Every page gains an editing branch.
- `apps/web/src/screens/edit/EditSession.tsx` — slice 5's context and `useEditSession()`.
- `packages/engine/src/draftContent.ts` and `documentProblems.ts` — slice 4.
- `packages/engine/src/documentEdit.ts` (181) — `upsertEntity`, `removeEntity`, `setNote`, `removeNote`, `upsertDomainEntry`, `moveId`. **Every mutation goes through these**; never splice a document array in the view layer.
- `apps/web/src/screens/edit/BookEditor.tsx` — lines 60–115 and 283–305 only, for the book-item-vs-lexicon-entry distinction this slice must preserve.
- `apps/web/src/content/entity-ids.ts` (13) — `newEntityId`.

~1000 lines. Inside budget.

## Not in this slice

Exercises and Sources pages (slice 8). Book or Lesson screens (slice 7). Preview or Diff (slice 9). Anything deleted (slice 11).

---

## 1. Shape

`UnitScreen` keeps one implementation. `useEditSession()` returns `null` in learner mode and the session in edit mode; every editable surface is `session === null ? <text> : <input>`.

**Do not fork the component.** A parallel `UnitEditView` mirroring the layout is the duplication the whole plan exists to remove.

The trail, swipe and keyboard navigation are unchanged. The sticky Practice bar is **hidden in edit mode** — practising a draft is what Preview is for (slice 9), and a Practice button that starts a session over half-typed content is a trap.

---

## 2. Per page

### 2a. Overview

`unit.title` → `<input>`; `unit.goal` → `<textarea>`. Both write via `upsertEntity(book, "units", next)`.

Two structural controls appear here in edit mode, because this is where the entity lives even though their learner surface is elsewhere:

- **Unlocks after** — single-select over the Book's other units, **by title, grouped by lesson**. Its learner surface is the lock icon on the Lesson screen. Clearing it must **delete the key**, not set `undefined`: `zod`'s `optional()` expects the key absent, and an `undefined` value survives in memory while vanishing across the JSON round-trip to localStorage, leaving the live document and its persisted copy disagreeing. `BookEditor.tsx:263–269` already documents this exact trap — carry the comment.
- **Remember** — the `recallUnitIds` list, which already renders as "Remember: …" cards. In edit mode each card gains a remove control, plus an add picker over other units. A unit must not reference itself (validator class (l)); simply do not offer it.

### 2b. Theory

Each note renders through `NoteEditor` (slices 1–3) instead of `NoteView`, wired to `setNote(book, stem, markdown)`.

`+ note` seeds `"# New note\n\n"` and appends the derived id to `unit.noteIds` — the same two-step `BookEditor.tsx:377–403` does. The heading seed matters: without it every list labels the note by its stem, which is a UUID.

Delete removes the note **and** strips its id from `noteIds`; `removeNote` already does both.

The pin control is hidden in edit mode — pinning a draft note into your own review queue is meaningless.

### 2c. Vocabulary, Concepts, Examples

Table rows and cards become inputs:

| page                  | fields                                                       |
| --------------------- | ------------------------------------------------------------ |
| Vocabulary (`lexeme`) | `script`, `gloss`; `transliteration` behind the row's expand |
| Concepts (`concept`)  | `term`, `definition`                                         |
| Examples (`sentence`) | `text`, `translation`                                        |
| Examples (`pair`)     | `a.script`, `b.script`, `contrast`                           |

The audio speaker stays a speaker. Setting `audioRef` / `imageRef` is **slice 8 §2c**, in the same expanded row as the source control — not this slice. If a row has no `audioRef`, show nothing rather than an empty control.

### 2d. The distinction that must not be lost

A row on these pages is **either** a book-owned item **or** a lexicon entry the unit merely references. `Content.items` is the merged pool (slice 4 §2c), so both appear side by side.

- **book-owned** (`book.items` has the id) → edits write the Book document; the remove action is **Delete**.
- **lexicon entry** (`domain.entries` has the id) → edits write the Domain document; the remove action is **Unlink**, which removes the id from `unit.itemIds` and leaves the entry alone.

This is exactly the rule `BookEditor.tsx:289–297` implements today. Getting it backwards deletes a word out of the shared lexicon when the author meant to take it out of one unit.

When `canEditLexicon` is false (slice 5 §4), lexicon rows render read-only with one plain line — _"these words come from somewhere else — you can use them, but not change them"_ — and `+ word` is hidden. Book-owned rows on the same page stay editable.

### 2e. Adding

One add control per page, appending to `unit.itemIds` and creating the entity in the same change:

| page       | creates                                     | id                        | writes     |
| ---------- | ------------------------------------------- | ------------------------- | ---------- |
| Vocabulary | a lexicon entry of the domain's kind        | `newEntityId(domainCode)` | Domain doc |
| Concepts   | a book item, `kind: "concept"`              | `newEntityId(bookCode)`   | Book doc   |
| Examples   | a book item, `kind: "sentence"` or `"pair"` | `newEntityId(bookCode)`   | Book doc   |

An entry id must start with `<domain.code>-` and a book entity id with `<book.code>-` (`validate.ts` classes (c)/(u)); a bare UUID fails validation.

New rows are created empty and will carry problem markers immediately — that is the designed behaviour, not a bug to pre-empt.

---

## 3. Problem markers

`documentProblems` (slice 4) is on the session. Render:

- **field-level** — a quiet triangle on the offending input plus one line beneath it. Match by `entityId` + `path`.
- **entity-level** — one line on the row or card. Match by `entityId` with no `path`.
- **unit-level** — problems naming this unit's id and nothing narrower (`unit has zero tasks`) render once on Overview.

A marker is not an error dialog and never blocks typing. No `aria-invalid` on a field the author is still filling in — it is not invalid, it is unfinished.

---

## 4. Reordering and removing

`unit.itemIds` order is display order, so reordering is real content editing. Reuse `RowActions` from `screens/edit/fields.tsx` — it exists, and its 44px hit targets came out of the 2026-07-19 UI audit. Reorder via `moveId` from engine.

Deleting a book item uses `removeEntity`, which strips every reference to it across the document. Do not remove it from `unit.itemIds` by hand and leave the entity orphaned.

---

## 5. Tests

`UnitScreen.trail-end.test.tsx` and `BookScreen.skip-ahead.test.tsx` stay green.

New, in `apps/web/src/screens/UnitScreen.edit.test.tsx`:

- Learner mode renders exactly as before — no inputs anywhere. This is the regression guard for the whole slice.
- Typing in a vocabulary row's gloss writes the **Domain** document; typing in an example writes the **Book** document.
- Remove on a lexicon row **unlinks** (the entry survives in `domain.entries`); remove on a book item **deletes**.
- `+ word` creates an entry whose id starts with the domain code.
- Clearing "Unlocks after" removes the key entirely — assert with `"unlocksAfterUnitId" in unit === false`, not `=== undefined`, or the test passes on the bug.
- A field problem renders on its own field, not on the card.
- With `canEditLexicon: false`, vocabulary rows are read-only and book items on the same page are not.
- The Practice bar is absent in edit mode.

## Verification

`corepack pnpm check` green.

Browser, private-Book path: create a Book → lesson → unit; add a word, a concept, an example and a note; type in each; reorder two rows; confirm each shows a marker while incomplete and loses it when filled; leave the unit and come back and confirm everything persisted; reload the page and confirm the same.

Then the same in maintain mode with a real account, specifically checking that a vocabulary edit lands in the lexicon document and survives Sync.

## Done-criteria

- All five Unit pages edit in place; the screen never navigates away to edit.
- No entity id is visible anywhere on the screen.
- Lexicon rows and book items are distinguishable by their remove action, and each writes the right document.
- Problems render on the field they belong to.
- Learner mode is byte-identical to before.
