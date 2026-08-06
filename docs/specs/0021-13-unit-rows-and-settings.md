# Spec 0021-13: Unit rows that look like the table they edit

Slice 13 of [plan 0021](../plans/0021-in-place-editing.md) (§14). Depends on **slice 12** — it uses that slice's icons, settings sheet and undo toast, and adds none of its own. Self-contained per the `/delegate` convention; **make no new design choices**.

Slice 6 made the Unit trail editable. This makes it legible: the learner's two-column table stops becoming two narrow inputs that clip after twelve characters.

## Context (read first)

- `apps/web/src/screens/UnitScreen.tsx` (1725) — **the pages only**: `RowExtras` (130–215), the row/card renderers (240–360), and the Vocabulary / Concepts / Examples / Exercises page bodies (roughly 1140–1560). Skip the learner-only trail, swipe and Practice-bar machinery; this slice does not touch them.
- `apps/web/src/screens/edit/fields.tsx` (329) — `RowActions`, `AssetRefPicker`, `EntityPicker`.
- `apps/web/src/screens/edit/inPlace.tsx` (611) — `UnitEditOps`, `ProblemMarker`. The mutations already exist; this slice re-presents them and adds none.
- `apps/web/src/screens/edit/SessionEditSheet.tsx` (203) — the question screen's `✎`, which shares the row controls and must follow them.
- Slice 12's `SettingsSheet`, `UndoToast` and icon set.

~1500 lines of the 1725-line file plus ~1150 elsewhere. `UnitScreen.tsx` is read in named ranges rather than whole; if that proves impossible in practice, **stop and split this slice by page** (Vocabulary+Concepts, then Examples+Exercises) rather than reading past the budget — design.md's delegation policy, and 0018's near-miss, are why.

## Not in this slice

The Theory page (slice 12). Book and Lesson screens (slice 14). Any change to what `UnitEditOps` writes, to `documentEdit`, or to validation.

---

## 1. A row is a table row

Today each cell is a bordered, rounded, fixed-width `<input>` inside a flex row, so a definition shows about twelve characters and the actions wrap onto a second line. Replace with the learner layout, made editable in place:

- The page keeps its `.vocab-table` — same columns, same header, same rhythm.
- Each cell holds a **borderless** control that fills the cell and inherits the table's type: transparent background, no border, no radius, until it is hovered (faint border) or focused (`--primary` border). The row reads as a table row; the caret is the only thing that says it is editable.
- A field whose learner rendering wraps — `definition`, `translation`, `contrast` — is an **auto-growing** `<textarea>`, not an `<input>`. Clipping the text you are writing is the specific complaint.
- Actions collapse to a trailing action column: `⚙` and `−`, plus `↑ ↓` where order is content. No wrapped second line.

**The header row here is _not_ content**, unlike a note table's. `<th>Term</th>` / `<th>Definition</th>` are hardcoded in `UnitScreen.tsx` — screen furniture naming what the columns hold. Leave them as static text. Slice 12's note table follows the opposite rule for the opposite reason; getting these two backwards is the likeliest mistake in this slice.

## 2. `More` becomes `⚙`

`RowExtras` — Source, the example prose, `audioRef`, `imageRef` — moves from an inline expansion into slice 12's `SettingsSheet`, opened by the row's `⚙`.

Its **contents are unchanged**: the same fields, the same pools, the same `withPayload` clearing rule that deletes the key rather than writing `""`. Only where they are shown changes. Do not take the opportunity to reorganise them.

The sheet's title is the row's own text — the term, the script, the first words of the sentence — so it is obvious which row you opened. Never the id.

Why a sheet rather than the current expansion: expanding row four pushes rows five and below down the page, and the author loses their place in exactly the list they were working through.

## 3. Exercises

The Exercises page's cards get the same treatment: the type dropdown and the instructions move behind the card's `⚙`; the item list keeps its rows with `−` per item; `+ add an exercise` keeps its words.

`SessionEditSheet` renders `ExerciseCard` and `RowExtras` too — it inherits all of this for free, and **must not** grow a second layout. Check it after changing them.

## 4. Deleting

Every `−` on these pages routes through slice 12's undo toast, and the label says which of the two things happened — `"Word unlinked · Undo"` for a lexicon entry, `"Concept deleted · Undo"` for a book item.

**Exercises are excepted — amended 2026-08-06, owner decision.** Deleting an exercise keeps its existing `ConfirmSheet` ("Delete this exercise?" / "Keep it" / "Delete") and does **not** get a toast. This section as first written contradicted §6: `UnitScreen.exercises.test.tsx:514` asserts the confirm-then-delete flow as a behavioural contract predating this slice, and §6 says stop rather than edit such an assertion. A confirm is also the stronger of the two protections, on the one delete that strips `taskIds`. The cost is two delete models on one screen, accepted knowingly. Note for anyone revisiting: `removeWithUndo` is the wrong shape for a task anyway — `isBookItem(taskId)` is always false (it indexes `book.items`, never `book.tasks`), so reusing it would mislabel the toast and call `removeRow`, which cannot delete a task.

That distinction is the one slice 6 §2d exists to protect: a lexicon row **unlinks** (the entry survives), a book-owned row **deletes**. Making both a bare `−` is precisely why the toast has to name the action. Do not merge the two.

## 5. The propose-mode gap, stated

The Vocabulary page in propose mode currently renders a header, no rows, no `+ word`, and no explanation — because the lexicon is read-only there (plan §6's staging gap, still open outside private Books).

Say so, in the same words the note editor's `Аү` sheet already uses: _"these words come from somewhere else — you can use them, but not change them."_ One line where the rows would be. A silent empty table reads as a bug in the app rather than a limit on this mode.

## 6. Tests

`UnitScreen.edit.test.tsx` and `UnitScreen.exercises.test.tsx` stay green. Slice 6's assertions — which document each edit writes, unlink vs. delete, markers on their own field — are the regression guard, and none of them should need changing. **If one does, stop**: this slice is presentation, and a changed behavioural assertion means something moved that should not have.

New:

- A concept row renders inside the page's `<table>`, one `<tr>` per row.
- The definition control is a `<textarea>` and grows past one line.
- `Term` / `Definition` headings are **not** editable — the counterpart to slice 12's header-row test, and the pair only means something together.
- `⚙` opens a sheet containing Source and the asset pickers; those fields are absent from the row itself.
- Deleting a lexicon row shows an **unlink** toast, a book item a **delete** toast, and Undo restores the document to its exact prior state in both cases.
- Propose mode renders the read-only line instead of an empty table.

## Verification

`corepack pnpm check` green.

Browser, private-Book path: a unit with several words, concepts and examples. Confirm every row reads as a table row and long definitions are fully visible and editable. Open `⚙` on a row, set a source, close, confirm the page did not scroll. Delete a word, undo, confirm it returns in the same position with the same fields.

Then maintain mode with a real account, and the question screen's `✎` on the same content, to confirm the sheet inherited the new controls rather than keeping the old ones.

## Done-criteria

- Vocabulary, Concepts and Examples rows are table rows; nothing clips.
- Nothing on these pages says `More`, `Less`, or `Delete` in red.
- Every destructive action is undoable once, and its toast names unlink vs. delete correctly.
- The Concepts headings stay fixed while a note table's header row stays editable.
- Propose mode explains its empty Vocabulary page.
