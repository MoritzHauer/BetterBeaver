# Spec 0021-1: Note block editor (core)

Slice 1 of [plan 0021](../plans/0021-in-place-editing.md) (§4). Self-contained per the `/delegate` convention; **make no new design choices** — where this spec is silent, preserve existing behaviour exactly.

This slice replaces the note `<textarea>` inside the _existing_ form editor with a block editor. It touches no architecture: no `draftContent`, no `checkReferences`, no `EditSession`, no routing. Those are slices 4–5 and must not be anticipated here.

## Context (read first)

- `apps/web/src/components/NoteView.tsx` (262 lines) — **the whole file.** Its parser is the contract this slice extracts and must not change the meaning of.
- `apps/web/src/components/NoteView.test.tsx` (76) — four cases that must pass **unmodified** at the end.
- `apps/web/src/screens/edit/BookEditor.tsx` — only the `view.v === "note"` branch, lines 190–216.
- `apps/web/src/content/noteTitle.ts` (19) — a pure note helper that stays exactly where it is. **Do not change or absorb it**: it is used by the entity pickers.
- `packages/engine/src/documentEdit.ts` — `setNote` only (lines 97–108) — and `packages/engine/src/index.ts` (13), the barrel the new module is exported from.
- `apps/web/src/styles.css` — targeted ranges only: `.note` / `.note-table` (323–334), `.field` (1228–1246), `.editor-list` / `.editor-row-actions` / `.editor-add` (1247–1291). Do not read the whole file.
- `content/demo/notes/how-to-study.md` and `make-your-own.md` — the only two real notes in the repo. They are the round-trip fixtures.

## Not in this slice

Do not build, and do not leave hooks for: callouts (`> [!note]`), figures (`[img:stem]`), the lexicon picker, drag-and-drop reordering, nested blocks, or any change to `ValidateContentInput` / `assetReferences` / `NoteView`'s rendered output.

---

## 1. `packages/engine/src/noteBlocks.ts` (new)

Move `NoteView`'s `parseBody` / `parseChunk` / `isTableRule` / `tableCells` here, reshaped per below, and delete them from `NoteView.tsx`. `parseInline` and `InlineRun` **stay in `NoteView.tsx`** — they render React and this module is DOM-free.

Export it from `packages/engine/src/index.ts` alongside the existing `export *` lines.

**It lives in `packages/engine`, not `apps/web`**, for two reasons. The layering rule (architecture.md, from plan 0001) puts any pure function over core types there. More concretely, slice 2 adds a `noteImageStems` extractor to this module and calls it from `packages/engine/src/documentSource.ts:195` to feed the validator — and engine cannot import from `apps/web`. Putting it in `apps/web/src/content/` beside `noteTitle.ts` would read as the obvious home and force a move one slice later. (`noteTitle.ts` itself stays exactly where it is — do not move or absorb it; it is used by the entity pickers.)

```ts
export type NoteBlock =
  | { kind: "title"; text: string; raw: string }
  | { kind: "heading"; text: string; raw: string }
  | { kind: "paragraph"; text: string; raw: string }
  | { kind: "list"; items: string[]; raw: string }
  | { kind: "table"; rows: string[][]; raw: string };

export function parseNoteBlocks(markdown: string): NoteBlock[];
export function renderNoteBlock(block: NoteBlock): string;
export function serializeNoteBlocks(blocks: NoteBlock[]): string;
```

### 1a. `raw` is a partition, not a split

**This is the load-bearing rule of the slice.** `raw` holds the verbatim source lines that produced the block, _including the blank lines that follow it_, so that:

```ts
serializeNoteBlocks(parseNoteBlocks(md)) === md; // for ANY md, exactly
```

`serializeNoteBlocks` is therefore `blocks.map((b) => b.raw).join("")` — nothing else. Concatenation, not joining with separators.

Why this matters: real notes are hand-wrapped, and the parser joins a wrapped list item's continuation lines with `" "`. Without `raw`, opening a note and saving it without changing anything rewrites four lines into one — identical rendering, enormous diff, and every note the author merely _looked at_ shows up in slice 9's Diff. `how-to-study.md:10-12` is exactly this case and is a required fixture.

### 1b. Editing regenerates `raw` — there is no dirty flag

Every mutation recomputes `raw` from the structured fields:

```ts
const edited = { ...block, text: next };
update({ ...edited, raw: renderNoteBlock(edited) });
```

Untouched blocks are never re-rendered, because nothing calls `renderNoteBlock` on them. Do **not** add an `isDirty` boolean — the block _is_ its `raw`, and a flag is a second source of truth that will drift.

`renderNoteBlock` emits canonical form, each with a trailing blank line:

| kind        | output                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| `title`     | `# ${text}\n\n`                                                                           |
| `heading`   | `## ${text}\n\n`                                                                          |
| `paragraph` | `${text}\n\n`                                                                             |
| `list`      | `- ${item}\n` per item, then `\n`                                                         |
| `table`     | `\| a \| b \|\n` per row, with `\| --- \| --- \|` inserted after the first row, then `\n` |

The table rule row is re-emitted because it is standard markdown and the parser drops it (§1c rule 4). An untouched table round-trips through `raw`; an edited one gets the canonical rule row back.

### 1b-bis. Trailing separators

`renderNoteBlock` always ending in `\n\n` creates one hazard, because a note's markdown need not end in a newline — `"# T\n\nBody."` is legal and is what the current textarea produces if the author doesn't press return. Its last block's `raw` is `"Body."`, with no separator. Two consequences:

- **Glue (a real bug).** Append a block after it and concatenation yields `"Body.New paragraph\n\n"` — two blocks fused into one. Invalid output.
- **Growth (cosmetic).** Edit that last block and its `raw` becomes `"Body.\n\n"`; the note gains two newlines it never had.

One shared helper, run by every mutation (edit, insert, delete, move) immediately before serializing, fixes the first:

```ts
/** Every block but the last must self-terminate, or concatenation fuses two blocks. */
const normalizeSeparators = (blocks: NoteBlock[]): NoteBlock[] =>
  blocks.map((b, i) =>
    i === blocks.length - 1 || b.raw.endsWith("\n")
      ? b
      : { ...b, raw: renderNoteBlock(b) },
  );
```

The second is **accepted, not fixed**: it happens once, only inside an edit the author actually made, it is idempotent, and slice 9 diffs notes by block _content_, so trailing whitespace on the last block never surfaces. Do not add per-block separator memory to avoid it — that is a second source of truth for the same information `raw` already holds.

Note this leaves §1a's guarantee literally exact: `parseNoteBlocks` normalizes nothing, so `serializeNoteBlocks(parseNoteBlocks(md)) === md` holds for any `md` including one with no trailing newline. Normalization lives only on the mutation path.

### 1c. Behaviour that must not change

Today's parser splits on `/\n\s*\n/`, then trims and drops empty lines within each chunk, then classifies. `raw` needs source positions, so this becomes a single line-oriented pass. That pass must reproduce today's classification exactly:

1. **Classify on the trimmed line, keep the untrimmed line in `raw`.** `  - foo` is a list item (today's trim makes it one).
2. **A blank line is any line whose trim is empty** — it ends the current block.
3. **`## `, `|`, `- ` each interrupt an open paragraph** and start their own block, with no blank line required. (`NoteView.test.tsx:53` covers the `## ` case.)
4. **A table drops rows matching `/^:?-{3,}:?$/` in every cell** from `rows`. They stay in `raw`.
5. **A plain line while a list is open appends to the last item, space-separated**, but only if no paragraph is open in that block run.
6. **Only the first `# ` line becomes a `title` block.** A later `# ` line falls through to `paragraph`, which is what renders today (there is no `# ` case in `parseChunk`) — so it still shows literally.

Anything before the first `# ` line becomes ordinary blocks. This is a change from today, where `parseBody` discards it — see §2 for how `NoteView` keeps its current output.

### 1d. `NOTE_ICONS` — `apps/web/src/content/noteIcons.ts` (new)

`[icon:name]` is existing grammar rendering `art/icons/${name}.png`. The picker needs the names, and `apps/web/public/art/icons/` is served statically, so `import.meta.glob` cannot see it (and globbing it would duplicate every file into the bundle).

This one **stays in `apps/web`**, unlike §1's module: it is a list of that app's own public assets, not a fact about note syntax, and `packages/engine` has no business knowing the web app's icon set.

```ts
export const NOTE_ICONS: readonly string[];
```

Hardcode the array — all 73 basenames without `.png`, sorted — with a comment naming the directory it mirrors, and **pin it with a test** (§6) that reads the directory and asserts equality. That is what stops it drifting. Do not add a build step or a generator script.

`BOOK_ICONS` in `packages/schema` is unrelated: it is emoji for the Book card, not this PNG set. Do not reuse it.

---

## 2. `NoteView.tsx`

Import `parseNoteBlocks`; delete the local parser. **Rendered output must be byte-identical to today.** Two points to get right:

- The `title` block renders as the `<h2>` it does today. Keep rendering it outside/before the body blocks, or render it in the loop — either is fine as long as the DOM matches.
- **Drop every block before the first `title` block.** One `.slice()`. Today `parseBody` discards pre-title lines; §1c makes the parser preserve them so the editor can round-trip them, but `NoteView` must keep discarding them so no learner-visible rendering changes.

`NoteView.test.tsx` is the check: all four cases pass with **zero edits to the test file**. If a case needs changing, the extraction is wrong.

---

## 3. `apps/web/src/components/NoteEditor.tsx` (new)

```ts
export function NoteEditor({
  markdown,
  onChange,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
}): JSX.Element;
```

**This interface is pinned and must not take `doc`, `stem`, or `setNote`.** `NoteEditor` mounts inside `BookEditor` here, and remounts on the Unit screen at slice 6 — after slice 11 deletes `BookEditor`. A bare string in, a bare string out, makes slice 6 a prop change instead of a rewrite.

Parse `markdown` into blocks on each render; **do not hold blocks in state** — the markdown prop is the single source of truth, and a parallel blocks state goes stale the moment anything else writes the note. Every mutation rebuilds the array, re-renders the touched block's `raw`, runs `normalizeSeparators` (§1b-bis), and calls `onChange(serializeNoteBlocks(next))`.

Mark the re-parse deliberately, in the repo's existing idiom, so nobody "optimises" it into stale state later:

```ts
// ponytail: re-parses the whole note per keystroke — ~8 blocks on the longest
// real note. Memoize on `markdown` only if a note ever gets large enough to feel it.
```

Controls per kind — all plain form elements, **no `contenteditable`**:

| kind        | control                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `title`     | `<input>`                                                                    |
| `heading`   | `<input>`                                                                    |
| `paragraph` | `<textarea>`, auto-growing or a sensible fixed `rows`                        |
| `list`      | one `<input>` per item, plus add-item / remove-item / move-item              |
| `table`     | a grid of `<input>`s, plus add-row / add-column / delete-row / delete-column |

Each block gets a `RowActions` row (import from `screens/edit/fields.tsx`) for move-up / move-down / delete — it already exists and already carries the 44px hit targets the 2026-07-19 UI audit required. Do not write a second one.

Below the block list, one add-button per kind (`+ ¶`, `+ H`, `+ list`, `+ table`). **New blocks append at the end**; reordering covers the rest. Do not build insert-at-position.

**Table edge case**: rows may be ragged (the parser does not pad). On any table edit, pad every row to the widest with `""` before re-rendering, so the grid is rectangular and `renderNoteBlock` emits a valid table.

**Empty note**: `markdown === ""` parses to zero blocks. Render just the add-buttons. `BookEditor`'s "New note" seeds `"# New note\n\n"`, so this is mainly the delete-everything case.

---

## 4. The selection toolbar

Above the block list: **B**, **Аү** (lexicon), **icon**.

- **B** wraps the selection in `**…**`.
- **Аү** wraps the selection in `*…*`. In this slice it _only wraps_ — the resolution readout and lexicon search are slice 3. This is exactly what an author can do today by typing asterisks.
- **icon** opens a small picker over `NOTE_ICONS` (with a search box — there are 73) and inserts `[icon:name]` at the caret.

Mechanics, and these are the parts that go wrong if left unspecified:

1. Track the focused control in a ref via `onFocus`; the toolbar acts on it. With nothing focused, the buttons are disabled.
2. Read `selectionStart` / `selectionEnd`, splice the markers into the value, and call that block's change handler.
3. **Restore the selection afterwards** with `setSelectionRange`, in a `useEffect` or `requestAnimationFrame` after the controlled re-render. Without this the caret jumps to the end of the field after every button press — the single most likely bug in this slice, and it must be covered by a test.
4. **Empty selection**: insert both markers and place the caret between them.
5. No toggle-off. Selecting already-wrapped text and pressing **B** again produces `****text****`; that is acceptable for this slice and cheaper than a correct unwrap. Do not build unwrapping.

---

## 5. `BookEditor.tsx`

Replace lines 197–204 (the `<label className="field">Markdown<textarea …/></label>`) with:

```tsx
<NoteEditor
  markdown={note.markdown}
  onChange={(markdown) => onChange(setNote(doc, note.stem, markdown))}
/>
```

Everything else in the `view.v === "note"` branch — the `<h2>` heading, the "Delete this note" button — is unchanged.

---

## 6. Tests

**`packages/engine/src/noteBlocks.test.ts` (new)** — everything except the icon-manifest case, which cannot live here (engine must not reach into the web app's assets) and goes in **`apps/web/src/content/noteIcons.test.ts` (new)**.

Resolve every filesystem path the way the repo already does — `fileURLToPath(new URL("../relative/path", import.meta.url))`, as in `packages/schema/src/content.test.ts:12` and three sibling tests. A bare relative path resolves against the working directory, not the test file, and will go red in CI.

- **Editing a block leaves its siblings' `raw` untouched** — **the one test that must exist even if others are trimmed.** Parse `how-to-study.md`, edit one paragraph, serialize, and assert every other block's source text is byte-identical. This is the whole point of `raw`.
- **Round-trip**: `serializeNoteBlocks(parseNoteBlocks(md)) === md` for both real demo notes (read from disk) plus fixtures covering: a wrapped list item; a table with an alignment row; a `## ` heading sharing a chunk with its body; trailing whitespace-only lines; `\n\n\n` between blocks; content before the first `# `; a second `# ` line; **a document with no trailing newline**; an empty string.
- **Separator normalization** (§1b-bis), over `"# T\n\nBody."`: appending a block produces valid markdown with the two blocks separated, not fused; editing the last block is idempotent (edit twice, no further growth).
- **Classification**: explicit expected `NoteBlock[]` for a fixture exercising all five kinds, asserting each `raw` and each structured field — this is what pins §1c.
- **`renderNoteBlock`**: canonical output per kind, including the re-emitted table rule row.
- **`NOTE_ICONS` matches the directory**: read `apps/web/public/art/icons/`, strip `.png`, sort, compare. Fails loudly when someone adds an icon.

**`apps/web/src/components/NoteEditor.test.tsx` (new)**

- Typing in a paragraph emits markdown with that paragraph changed and everything else identical.
- **B** over a selection wraps it **and leaves the selection covering the same text** (assert `selectionStart` / `selectionEnd`).
- **B** with an empty selection inserts `****` and puts the caret between the markers.
- Add row / add column / delete row on a table produces a rectangular, valid table.
- Move-up on a block reorders the serialized output.
- A ragged table is padded on edit.

**`NoteView.test.tsx`**: unchanged, still green.

---

## Verification

`corepack pnpm check` green (format, lint, `lint:types-fire`, `lint:cycles`, typecheck, tests).

Watch `lint:cycles` specifically: `noteBlocks.ts` imports nothing from `apps/web` — it is engine code, and the dependency runs one way only.

In a real browser, via the private-Book path — it needs no account and no backend, and is the route STATUS.md records as already browser-verified (see the `apps/web:verify` skill for the launch recipe):

1. My Books → Create a Book → ✎ → New lesson → New unit → New note.
2. The note opens as blocks, not a textarea.
3. Add a paragraph, a heading, a bullet list and a table; type into each.
4. Select a word, press **B**; confirm it renders bold **and the caret stays where it was**.
5. Insert an icon; confirm it renders as a glyph.
6. Leave the note and return: everything is still there.
7. **The round-trip check by hand**: open `how-to-study.md`'s equivalent in a Book, change nothing, navigate away and back, and confirm the markdown is unchanged. (In this slice the easiest way to see the stored markdown is the Settings export.)
8. Zero console errors throughout.

## Done-criteria

- `NoteView.tsx` has no parser of its own and renders identically; its four tests pass unmodified.
- `serializeNoteBlocks(parseNoteBlocks(md)) === md` holds for both real notes and every fixture, including one with no trailing newline.
- Editing one block leaves every other block's source byte-identical.
- Appending after a note that ends without a newline produces separated blocks, not fused ones.
- The note form in `BookEditor` is a block editor; no `<textarea rows={14}>` remains.
- `NoteEditor`'s props are `{ markdown, onChange }` and nothing else.
- No callout, figure, image, or lexicon-picker code exists.
