# Spec 0021-12: Edit chrome, and the note that looks like a note

Slice 12 of [plan 0021](../plans/0021-in-place-editing.md) (§14). Depends on **slices 1–11**, all landed. Self-contained per the `/delegate` convention; **make no new design choices**.

The first of three slices that make edit mode look like the page it edits. This one ships the shared vocabulary — icon affordances, an undo toast, a settings sheet — and applies all three to the Theory page, which is where they are most needed and where they can be judged.

## The finding this exists for

`NoteEditor.tsx` emits ten class names: `.note-editor`, `.note-editor-toolbar`, `.note-editor-block`, `.note-editor-list-block`, `.note-editor-callout-block`, `.note-editor-figure-block`, `.note-editor-table-block`, `.note-editor-table-row`, `.note-editor-icon-picker`, `.note-editor-image-picker`.

**None of the ten exists in `styles.css`.** The block editor shipped unstyled. An 11×2 table therefore renders as 22 stacked full-width inputs — `input[type="text"] { width: 100% }` (`styles.css:779`) has nothing overriding it — with a red "Delete row" between every pair. That is the single largest cause of the complaint, and it is CSS, not architecture.

## Context (read first)

- `apps/web/src/components/NoteEditor.tsx` (1134) — **the whole file.** Every block kind changes shape.
- `apps/web/src/components/NoteView.tsx` (227) — **the whole file.** It is the target: the editor must render _through the same markup_ when idle (§2). Note `rowIndex === 0 → <th>` at line 170.
- `apps/web/src/styles.css` — the token block (lines 1–160), `.note` / `.note-table` / `.note-callout` / `.note-figure` (335–400), `.vocab-table` (1146–1157), the `Sheet` rules (1195–1260), and the editor block (1393–1560). Do not read the other ~1100 lines.
- `apps/web/src/components/Sheet.tsx` (160) — the app's only dialog surface. §4's settings sheet is built on it, not on a new portal.
- `apps/web/src/screens/edit/fields.tsx` (329) — `RowActions`, which §3 replaces with icons everywhere it is used.
- `packages/engine/src/noteBlocks.ts` (331) — the `NoteBlock` union and `renderNoteBlock`. Read the types; do not change them.

~2200 lines. `styles.css` is read in named ranges rather than whole, which is what keeps this inside the delegation budget (design.md's ~40k / ~1500-lines-per-file rule).

## Not in this slice

The Unit trail's Vocabulary / Concepts / Examples / Exercises rows (slice 13). Book and Lesson screens (slice 14). Any change to the note grammar, the parser, the serialiser or `CONTENT_SCHEMA_VERSION`. Any change to what is stored.

---

## 1. The icon vocabulary

Six marks, used identically in this slice and the two after it. Add them as one small inline-SVG component set in `apps/web/src/components/icons.tsx`, which already exists.

| mark              | means                      | replaces today                        |
| ----------------- | -------------------------- | ------------------------------------- |
| `+` plus          | add a row, block, item     | `+ row`, `+ item`, `+ ¶`, `+ table`…  |
| `−` minus         | remove **this** row/block  | `Delete row`, `Delete block`          |
| `↑` / `↓`         | move up / down             | the `arrow_N` / `arrow_S` beaver PNGs |
| `⚙` gear          | open this thing's settings | `More` / `Less`                       |
| `⋮` vertical dots | the screen's own menu      | unchanged (`EditMenu`)                |

**Inline SVG at `currentColor`, not PNG art.** `public/art/icons/` ships `config.png` but has no plus, minus or trash, and the existing `arrow_N.png` cannot take a theme colour — a light-on-dark rail needs the stroke to follow `--fg`. The three arrow PNGs stay where they are used outside editing.

Hit targets stay **44px minimum** (the 2026-07-19 UI audit's repo-wide rule, already encoded in `.editor-row-actions .plain`). A 30px visual glyph inside a 44px button is fine; a 30px button is not.

Every icon button carries an `aria-label` spelling out the action _and its subject_ — `"Delete row"`, not `"Delete"`; `"Settings for А а"`, not `"Settings"`. Losing the word loses the only label a screen reader had.

## 2. Blocks render when idle, edit on tap

The core change, and the reason no `contenteditable` is needed. **Prose blocks only** — `title`, `heading`, `paragraph`, and a `callout`'s body.

- **Idle**: the block renders exactly as `NoteView` renders it, through the same code path. Extract `NoteView`'s per-block rendering into a component both files call rather than reimplementing it — two renderers of one grammar drift, and the drift is invisible until an author sees different text in the two modes.
- **Tapped**: that one block becomes a `<textarea>` carrying the raw source, with the markers visible (`**bold**`, `*word*`, `[icon:name]`) — that is precisely when the author is editing them.
- **Blurred**: it renders again.

State is **one number**: which block index has focus. Not a per-block boolean, not a map.

The textarea must **auto-grow** to its content on mount and on every input — `rows={3}` is why a four-line paragraph currently shows one and a half. Set `height: auto` then `height: scrollHeight` on the element; do not guess from character count.

The idle block is keyboard-reachable: `tabIndex={0}` and `role="button"` with an `aria-label` of `"Edit this text"`, activating on Enter and Space. A block only mouse users can reach is not an accessibility detail to defer.

**Tables, lists, figure captions and callout titles stay plain inputs at all times.** They hold no inline markup worth hiding, and a cell that changes into a different element on focus makes tabbing across a row jump.

## 3. Blocks look like blocks

Style the ten class names. The reference is the learner's Theory page — same fonts, same sizes, same rhythm — so the CSS derives from `.note` / `.note-callout` / `.vocab-table`, never from new values.

- **`.note-editor`** wraps in the same `.note` treatment: the 3px `--primary` left rule, `padding-left: 1rem`. Edit mode must not lose the page's spine.
- **`.note-editor-block`** is the hover/focus row: a faint `--primary` wash and a right-hand control rail holding `↑ ↓ −` (and `⚙` where the block has settings). The rail is invisible until the block is hovered or holds focus, and permanently visible at `@media (hover: none)` — a rail that only appears on hover does not exist on a phone.
- **`.note-editor-table-block`** renders a **real table**: `<table class="vocab-table">`-equivalent, `border-collapse`, one `<input>` per cell filling its own cell, a bottom border per row, and one `−` in a narrow trailing action column.
  - **The first row is content.** `NoteBlock.rows[0]` is the header — `NoteView.tsx:170` renders `rowIndex === 0` as `<th>` — so it is editable like every other row, rendered bold, with its own `−`. Deleting it promotes the next row to header, which is what the grammar already does. Do **not** freeze it as a label; that is the one thing the prototype got wrong.
  - `+ row` is a single `+` below the table. **`+ column` and `− column` move behind the block's `⚙`** — they are rare, and on screen they compete with the per-row `−` for the same glance.
- **`.note-editor-list-block`** keeps one input per item with `↑ ↓ −` per item and a `+` below.
- **`.note-editor-callout-block`** renders in its variant's real tint (`.note-callout.note|tip|warning|example`), with the glyph. The variant dropdown and the optional title move behind the block's `⚙`; the body is a prose block per §2.
- **`.note-editor-figure-block`** shows the image at `.note-figure` size with the caption input beneath it.
- **`.note-editor-toolbar`** is `B`, the lexicon link and the icon inserter as icons, in the page header rather than floating above the first block.
- The block-add bar keeps words next to its `+` marks — `+ Text`, `+ Heading`, `+ List`, `+ Table`, `+ Box`, `+ Image`. Six unlabelled icons in a row is a puzzle; these are the one place a label earns its width.

## 4. The settings sheet

One new component, `apps/web/src/components/SettingsSheet.tsx`, over the existing `Sheet`. It takes a title and children, and renders a "Done" button that dismisses. Nothing more — the caller supplies the fields.

It is a **sheet, not an inline expansion**, so the page underneath never reflows: tapping `⚙` on the fourth block must not move the fourth block.

In this slice it carries the table's column controls and the callout's variant + title. Slices 13 and 14 reuse it unchanged.

## 5. The undo toast

A second small component, `apps/web/src/components/UndoToast.tsx`, plus one hook holding **a single previous snapshot** — not a stack.

`−` deletes immediately and shows `"<Thing> deleted · Undo"` for ~6 seconds. Undo restores the snapshot and dismisses. A second delete replaces the pending snapshot; there is no multi-step history, and none is wanted (the ceiling is a `ponytail:` comment, and the upgrade path is a stack if the one step ever proves too few).

The draft is already a plain object in `EditSession` state, so the snapshot is that object. Take it **before** the mutation.

`role="status"`, `aria-live="polite"`. Do not trap focus and do not steal it: the author is still typing.

The toast is positioned inside the screen, above the edit bar, and must not overlap it. It replaces no existing confirm — nothing in edit mode currently confirms a delete, which is exactly why this is needed.

## 6. Tests

`NoteEditor.test.tsx` and `NoteView.test.tsx` stay green — this slice changes presentation, not the markdown that goes in or comes out. That is the regression guard for the whole slice, and it is a strong one: every existing round-trip assertion still has to hold.

New, in `apps/web/src/components/NoteEditor.test.tsx`:

- A table block renders one `<table>` with one row per `rows` entry — not N stacked inputs. Assert on the row count, which is what actually regressed.
- **The header row's cells are editable**, and typing in one changes `rows[0]` in the emitted markdown.
- Deleting the header row leaves the next row as `rows[0]`.
- Tapping a paragraph swaps it for a `<textarea>` whose value is the block's raw source, markers included; blurring restores rendered markup. Assert the raw `**` is present in the textarea and absent from the idle rendering.
- Deleting a block emits the shortened markdown, and Undo restores markdown **byte-identical** to before — not merely equivalent. `raw` is what makes that possible and this is the test that protects it.
- Column add/remove is reachable only through the block's settings sheet.

## Verification

`corepack pnpm check` green.

Browser, private-Book path (needs no account): create a Book → lesson → unit → a note. Add a table, type in its header row and its body, delete a row, undo it. Add a callout and change its variant through `⚙`. Tap a paragraph, add `**bold**`, tap away and see it bold. Confirm the page reads like the Theory page beside it — then open the same unit in learner mode and confirm nothing moved.

On a real phone, or at `@media (hover: none)`: confirm every rail is visible without hovering and every target is thumb-sized.

## Done-criteria

- A note table renders and edits as a table, header row included.
- Prose renders as prose until tapped, and the markers appear only in the block being edited.
- No red word anywhere in the note editor; `+ − ↑ ↓ ⚙` do that work.
- Deleting anything can be undone once, immediately.
- `styles.css` has a rule for each of the ten class names.
- The markdown a note round-trips through the editor is unchanged by this slice.
