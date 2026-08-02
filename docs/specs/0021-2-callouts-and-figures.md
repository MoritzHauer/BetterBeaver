# Spec 0021-2: Callouts and figures

Slice 2 of [plan 0021](../plans/0021-in-place-editing.md) (§5). Depends on **slice 1** ([0021-1-note-blocks](0021-1-note-blocks.md)) being landed. Self-contained per the `/delegate` convention; **make no new design choices**.

Two constructs are added to note markdown. Neither bumps `CONTENT_SCHEMA_VERSION` — a note is a `markdown` string and `z.string()` accepts anything — so there is no republish and no old client rejecting content. An app build older than this change renders the new syntax as literal text, which is why both forms are shaped to degrade readably.

## Context (read first)

- `packages/engine/src/noteBlocks.ts` — slice 1's parser. Two new block kinds go here.
- `apps/web/src/components/NoteView.tsx` — two new render cases, one new prop.
- `apps/web/src/components/NoteEditor.tsx` — slice 1's editor. Two new block controls, two new add-buttons, one new optional prop pair.
- `apps/web/src/screens/edit/AssetsManager.tsx` (239) — `assetReferences` (lines 35–60) is extended; `AssetView` is the shape the picker consumes.
- `packages/schema/src/validate.ts` — **two ranges only**: `ValidateContentInput` (lines 43–61) and the `audioRef`/`imageRef` check (lines 599–630). Do not read the whole file.
- `packages/engine/src/documentSource.ts` — **one range**: the `validateContent` call at lines 195–210.
- `apps/web/src/content/bundled.ts` — `getAssetUrl` only (lines 250–280).
- `apps/web/src/screens/edit/MaintainEditScreen.tsx` — how `assetViews` is built (lines 264–286).
- `apps/web/src/screens/UnitScreen.tsx:151–182` (`NoteCard`) and `apps/web/src/screens/SessionScreen.tsx:257–290` (`NoteReview`) — the only two `NoteView` call sites. Neither has a bare book id in scope; see §2c.

**Budget note.** Plan 0021 flagged this slice as likely needing a split. Measured against the actual files it is ~1150 lines of required reading, comparable to slice 1 and well inside the design.md budget, so it ships whole. One item the plan listed has also been checked and dropped — see "Already covered" below.

## Not in this slice

Nested blocks inside a callout (prose only, §1). Inline images. The lexicon picker (slice 3). Anything touching `draftContent`, `checkReferences`, `EditSession` or routing.

## Already covered — do not build

Plan 0021 §5 says `scripts/export-content.ts` must pull figure assets into the seed. **It already does.** `downloadSeedAssets` (lines 118–139) enumerates every object under the document's Storage prefix and writes all of them; it never scans content for references. A note figure in the onboarding Book is downloaded today. Leave the script alone.

---

## 1. Callouts

### 1a. Syntax and parsing

A run of lines whose trim starts with `>` is one callout block.

```
> [!warning] Watch out
> *Салам* is informal — use *Саламатсызбы* with elders.
```

```ts
export const CALLOUT_VARIANTS = ["note", "tip", "warning", "example"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

// added to NoteBlock
| { kind: "callout"; variant: CalloutVariant; title: string; text: string; raw: string }
```

Rules, in the same line-oriented pass slice 1 built:

1. A `>` line starts a callout and interrupts an open paragraph, exactly as `## `, `|` and `- ` already do (slice 1 §1c rule 3).
2. Strip the leading `>` and one optional following space from each line to get its content.
3. **First line only**: if its content matches `/^\[!(note|tip|warning|example)\]\s*(.*)$/`, that is the variant and the title (title may be empty). Otherwise `variant = "note"`, `title = ""`, and the content is body text — so a plain `> quoted line` is a note-variant callout with no title.
4. **An unrecognised variant is not a variant.** `> [!danger] Careful` has `variant = "note"` and body text `[!danger] Careful`, rendered literally. The author sees their typo instead of it silently becoming a note.
5. Remaining lines' content joins the body space-separated, the same wrapped-line rule paragraphs use.
6. `raw` is verbatim and covers the whole run plus its trailing blank lines, per slice 1 §1a. The round-trip guarantee is unchanged and must still hold.

`renderNoteBlock`:

```
> [!${variant}] ${title}\n     (or "> [!${variant}]\n" when title is empty)
> ${text}\n
\n
```

### 1b. Rendering

```tsx
<aside className={`note-callout ${variant}`}>
  <img
    className="icon-glyph"
    src={`${import.meta.env.BASE_URL}art/icons/${CALLOUT_ICON[variant]}.png`}
    alt=""
  />
  {title !== "" && <strong>{title}</strong>}
  <p>
    <InlineRun text={text} onTap={setTappedSpan} />
  </p>
</aside>
```

Body text goes through `InlineRun`, so `**bold**`, `*lexicon*` and `[icon:name]` all work inside a callout. That is the whole reason the block is prose-only and flat.

`CALLOUT_ICON` maps to glyphs that already exist in `apps/web/public/art/icons/` — verify each before using: `note` → `book_front`, `tip` → `lightbulb`, `warning` → `stop_sign`, `example` → `beaver_pencil`.

### 1c. Editing

A callout block renders as: a variant `<select>` over `CALLOUT_VARIANTS`, a title `<input>`, and a body `<textarea>`. Add-button label `+ box`, matching the vision's wording. Slice 1's `RowActions` row and the selection toolbar apply unchanged — the toolbar must work in the body textarea like any other.

### 1d. Styles

`.note-callout` in `styles.css`: a tinted panel with the glyph leading the title row. One accent per variant. Use the existing CSS custom properties rather than raw hex — check how `.card.correct` / `.card.incorrect` (lines 351–362) get their tints and follow that pattern so light/dark both work.

---

## 2. Figures

### 2a. Syntax and parsing

A line whose trim matches `/^\[img:([a-z0-9]+(?:-[a-z0-9]+)*)\]\s*(.*)$/` is a figure block; the remainder of the line is its caption.

```
[img:dx-3f9a2c4b] A beaver lodge in winter.
```

```ts
// added to NoteBlock
| { kind: "figure"; stem: string; caption: string; raw: string }
```

The stem pattern is `slugPattern` from `entities.ts` — asset stems are `${code}-${uuid}`. The form deliberately mirrors the existing `[icon:name]`, and the different prefix keeps `parseInline`'s icon regex from matching it. **Figures are blocks, not inline runs**: do not touch `parseInline`.

`renderNoteBlock`: `[img:${stem}]${caption === "" ? "" : ` ${caption}`}\n\n`

### 2b. `noteImageStems` — one extractor, called from two places

```ts
export function noteImageStems(markdown: string): string[];
```

In `noteBlocks.ts`, beside the parser. Both consumers below call **this function and no other**: two independent regexes over the same syntax drift, and the failure is silent in both directions — publish passes while the delete guard reports no references, or the guard blocks a deletion nothing uses. Same reasoning as `checkReferences` in the plan's §2.

Return stems in document order; duplicates are fine (both consumers set-ify).

### 2c. Rendering

```tsx
<figure className="note-figure">
  <img src={getAssetUrl(bookId, "img", stem)} alt={caption} />
  {caption !== "" && <figcaption>{caption}</figcaption>}
</figure>
```

`NoteView` gains a required `bookId: string` prop — the bare Book id `getAssetUrl` expects, **not** a `topic:`-prefixed document id.

Neither call site has it in scope today; each needs one prop hop, and each has a trap:

- **`UnitScreen.tsx:168`**, inside `NoteCard`. Its nearest thing is `bookDocId`, which is `` `topic:${content.topic.id}` `` — the _document_ id. Do not pass that through: `getAssetUrl` takes the book directory. Add a `bookId` prop fed from `content.topic.id`, or unwrap with `contentIdOf`. Passing `bookDocId` compiles and silently resolves nothing.
- **`SessionScreen.tsx:286`**, inside `NoteReview`, whose props are `{markdown, fallbackStem, lookup, unitId, applySelf, advance}` — no `bookId`. It _is_ available at the call site (line 827 already calls `getNoteMarkdown(bookId, question.stem)`), so add a `bookId` prop to `NoteReview` and pass it down. The `getAssetUrl(bookId, …)` calls at lines 94 and 110 are `AudioPlayer` and `ImageDisplay`, different components — do not mistake them for `NoteReview` already having it.

A stem that does not resolve yields `undefined` from `getAssetUrl`. Render the `<figure>` with the caption and no image rather than an `<img src="undefined">` — the caption is the useful part and a broken-image icon tells a learner nothing.

### 2d. Validation

`ValidateContentInput` gains:

```ts
/** Figure refs found in note markdown, per note, so a dangling one can name its note. */
noteImageRefs: {
  noteStem: string;
  stem: string;
}
[];
```

Checked in the same loop as item `imageRef`s (`validate.ts:599–630`), against the same `imageStemSet`:

```
${book.code}-note-${noteStem}: dangling imageRef "${stem}"
```

The id form matches how notes are already identified (`validate.ts:259`: `id: \`${book.code}-note-${stem}\``), which is what lets slice 10's error deep-linking resolve it later.

One call site to update — `documentSource.ts:195`:

```ts
noteImageRefs: doc.notes.flatMap((note) =>
  noteImageStems(note.markdown).map((stem) => ({ noteStem: note.stem, stem })),
),
```

Existing `validate.test.ts` cases construct `ValidateContentInput` literals and will not compile without the new field. Add `noteImageRefs: []` to each; do not make the field optional to avoid the edit — an optional field means a caller can silently skip the check.

### 2e. Delete guard

`assetReferences(book, domain, stem)` (`AssetsManager.tsx:35`) currently scans item and entry payloads. Extend it to scan `book.notes`, using `noteImageStems`, and return the note's `noteTitle(markdown, stem)` for a match.

That returns a human title where item matches return raw ids. The inconsistency is **accepted here**: item ids have been UUIDs since spec 0018 and are already unhelpful in this confirm, and fixing that generally is slice 10's error-deep-linking work. Do not fix it in this slice, and do not make notes return ids for symmetry.

### 2f. The picker

`NoteEditor` gains two optional props. `markdown` and `onChange` stay exactly as slice 1 pinned them:

```ts
export interface NoteAsset {
  stem: string;
  name: string;
  url: string;
}

export function NoteEditor({
  markdown,
  onChange,
  assets = [],
  onUploadAsset,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  /** Images available to this document. Empty disables `+ image`. */
  assets?: NoteAsset[];
  /** Absent means uploads are unavailable in this mode. */
  onUploadAsset?: (file: File) => Promise<void>;
}): JSX.Element;
```

`NoteAsset` is a deliberate subset of `AssetView`, not a re-export — it keeps `NoteEditor` from depending on the assets manager.

`+ image` opens a grid of thumbnails (`url`) labelled by `name`, plus an upload control when `onUploadAsset` is given. Picking one inserts a figure block with that stem and an empty caption. **A stem is never typed** — there is no text input for it anywhere.

Threading, per mode — `BookEditor` passes both props straight through to `NoteEditor`:

| mode     | `assets`                                                                                                                   | `onUploadAsset`            |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| maintain | from `assetViews` (`MaintainEditScreen.tsx:264–273`)                                                                       | `handleAssetAdd`           |
| private  | from the record's `assets: Record<string, Blob>`, mapped to object URLs the same way `AssetsManager` already receives them | the existing write-through |
| propose  | `[]`                                                                                                                       | omitted                    |

`ProposeEditScreen` has no `AssetsManager` at all — Storage RLS is maintainer-only, so a proposer cannot upload. With `assets` empty, `+ image` is **disabled with a one-line reason**, not hidden: a proposer should understand why the button is inert rather than wonder where it went.

### 2g. The editor renders figures from the picker, not from `getAssetUrl`

In the **editor**, a figure block's thumbnail uses the `url` from `assets`. In **`NoteView`** it uses `getAssetUrl`. This is not an inconsistency to clean up — it is the fix for a real trap.

`registerRemoteAssets` populates the resolution overlay from _cached_ documents at boot. In maintain mode an asset uploaded moments ago is in Storage and in the picker's list, but not in the overlay — so `getAssetUrl` returns `undefined` and the figure would render broken in the editor immediately after inserting it. Rendering from the picker's own `url` makes the editor always show what the author just chose. (Private mode does not have this problem: `private-assets.ts` registers object URLs from the record, so `getAssetUrl` resolves at once. Do the same thing in both modes anyway — one code path.)

The same trap bites Preview in slice 9, which is why plan 0021 §10 calls for threading `listDocumentAssets`'s stems in there. Out of scope here.

---

## 3. Tests

- **`packages/engine/src/noteBlocks.test.ts`** — extend slice 1's suite:
  - Round-trip still exact with callouts and figures present, including a callout whose body wraps across lines and one with no title.
  - `> [!danger] x` parses as a `note` callout with body `[!danger] x` (rule 4).
  - A bare `> quoted line` parses as a `note` callout with an empty title.
  - A `>` line directly after paragraph text starts a callout without a blank line.
  - `[img:stem]` with and without a caption; a line that merely _contains_ `[img:…]` mid-sentence is **not** a figure (blocks only).
  - `noteImageStems` finds every figure in document order and returns `[]` for a note with none.
  - Editing a callout or figure leaves sibling blocks' `raw` byte-identical — slice 1's must-have test, extended.
- **`packages/schema/src/validate.test.ts`** — a dangling `noteImageRefs` entry produces `<code>-note-<stem>: dangling imageRef "<stem>"`; a resolving one produces nothing.
- **`apps/web/src/components/NoteView.test.tsx`** — a callout renders its glyph, title and tappable body span; a figure renders `<figure>`/`<figcaption>`; an unresolvable stem renders the caption and no `<img>`. Slice 1's four original cases stay green (they gain the new `bookId` prop — that is the one edit permitted to this file).
- **`apps/web/src/components/NoteEditor.test.tsx`** — picking an asset inserts `[img:stem]`; `+ image` is disabled with `assets = []`; changing a callout's variant rewrites only that block.
- **`AssetsManager`** — `assetReferences` returns a note's title when a note figure uses the stem.

## Verification

`corepack pnpm check` green. Watch `lint:cycles`: `noteBlocks.ts` still imports nothing from `apps/web`.

In a real browser via the private-Book path (no account, no backend; see the `apps/web:verify` skill):

1. Create a private Book → lesson → unit → note.
2. Add a callout; switch its variant through all four and confirm each tint and glyph.
3. Put `**bold**` and a `*starred*` word in the callout body; confirm the star is tappable in the rendered note.
4. Upload an image through the assets manager, then insert it as a figure from `+ image`; confirm the thumbnail shows **immediately** in the editor and the figure renders in the note.
5. Add a caption; confirm `<figcaption>`.
6. Try to delete that image in the assets manager; confirm the guard names the note by its title.
7. Delete the figure block, publish-check the Book, and confirm no dangling-imageRef error remains.
8. Zero console errors throughout.

## Done-criteria

- `> [!warning] …` renders as a tinted callout with a glyph; an unknown variant renders literally.
- `[img:stem]` renders as a figure with optional caption; an unresolvable stem renders the caption alone.
- One `noteImageStems` function feeds both the validator and the delete guard.
- A dangling note figure is a publish error naming its note.
- Deleting an image a note uses is blocked and names the note.
- `+ image` picks from uploaded assets; no stem is ever typed; it is disabled with a reason in propose mode.
- A freshly uploaded image shows in the editor immediately.
- `scripts/export-content.ts` is unchanged.
