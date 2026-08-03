import { useEffect, useRef, useState } from "react";
import {
  CALLOUT_VARIANTS,
  type CalloutVariant,
  type NoteBlock,
  normalizeSeparators,
  normalizeToken,
  parseNoteBlocks,
  renderNoteBlock,
  resolveToken,
  serializeNoteBlocks,
} from "@betterbeaver/engine";
import {
  type Domain,
  type Item,
  itemDisplayText,
  itemSchema,
} from "@betterbeaver/schema";
import { newEntityId } from "../content/entity-ids";
import { NOTE_ICONS } from "../content/noteIcons";
import { RowActions } from "../screens/edit/fields";
import { AddWordForm } from "./AddWordForm";
import { Sheet } from "./Sheet";

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

/** A deliberate subset of `AssetView` (`apps/web/src/screens/edit/AssetsManager.tsx`),
 * not a re-export — keeps this component from depending on the assets
 * manager (spec 0021-2 §2f). */
export interface NoteAsset {
  stem: string;
  name: string;
  url: string;
}

/**
 * What the `Аү` toolbar button needs to resolve, search and grow the
 * domain's lexicon from inside a note (spec 0021-3 §5). One optional prop
 * group on `NoteEditor` — absent entirely (`lexicon === undefined`) means
 * this mounting has no lexicon in hand: the button still wraps the
 * selection, no sheet opens.
 */
export interface LexiconAccess {
  /** Raw draft entries; parsed inside (§2) — a half-typed draft fails
   * `itemSchema` and simply isn't in the pool yet, not a crash. */
  entries: unknown[];
  domain: Domain;
  /** The prefix for generated entry ids — the Domain's own `code`. */
  domainCode: string;
  /** Default sourceRef for a new entry; "" when the Book has no resources. */
  sourceRef: string;
  /** Absent means this mode cannot write the lexicon (§0: maintain and
   * propose, until plan 0021 slice 5 gives them a domain draft/publish
   * path of their own). */
  onAddEntry?: (entry: Item) => void;
}

/** An entry's dictionary-form text, the same field `resolveToken`
 * (`packages/engine/src/lookup.ts`) matches against. That file's own
 * `entryText` isn't exported — it's a one-line field read, not the matching
 * rule spec 0021-3 §2 says never to reimplement, so duplicating it here
 * beats widening engine's public surface for it. Returns `undefined` for a
 * `sentence`/`pair` item, which a domain's entries never legitimately hold
 * but a raw, untrusted draft could — callers must check this before calling
 * `itemDisplayText` on the same item, which throws on `pair`. */
function lexiconEntryText(item: Item): string | undefined {
  switch (item.kind) {
    case "lexeme":
      return item.payload.script;
    case "concept":
      return item.payload.term;
    default:
      return undefined;
  }
}

/**
 * Where the selection toolbar (spec 0021-1 §4) acts: which block, and for a
 * `list`/`table` block which item/cell within it, plus the live DOM node to
 * read the current selection from. Coordinates only — never the block or
 * the `blocks` array itself — because `onFocus` fires once and does not
 * re-fire on every render; a captured block/array would go stale the
 * moment a *different* block moves or is deleted before the toolbar button
 * is pressed. `wrapSelection`/`insertAtCaret` below are re-created every
 * render and resolve these coordinates against that render's fresh
 * `blocks`, so they always see the latest structure. `element.value` is
 * already correct (the input is controlled), so no value needs storing.
 */
type FocusTarget =
  | { element: FieldElement; kind: "text"; blockIndex: number }
  | {
      element: FieldElement;
      kind: "item";
      blockIndex: number;
      itemIndex: number;
    }
  | {
      element: FieldElement;
      kind: "cell";
      blockIndex: number;
      row: number;
      col: number;
    };

function updateAt<T>(arr: T[], index: number, fn: (item: T) => T): T[] {
  return arr.map((item, i) => (i === index ? fn(item) : item));
}

/** Every table mutation pads ragged rows to the widest with `""` first
 * (spec 0021-1 §3 "Table edge case"), so the grid stays rectangular and
 * `renderNoteBlock` always emits a valid table. */
function padRows(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
}

/** Resolves a `FocusTarget`'s coordinates against the current `blocks`
 * array into a function that rewrites just that field, or `null` if the
 * target no longer names a field of the matching shape (the block it
 * pointed at was deleted or changed kind out from under it). */
function resolveApply(
  blocks: NoteBlock[],
  target: FocusTarget,
): ((next: string) => NoteBlock[]) | null {
  const block = blocks[target.blockIndex];
  if (block === undefined) {
    return null;
  }
  if (target.kind === "text") {
    if (
      block.kind !== "title" &&
      block.kind !== "heading" &&
      block.kind !== "paragraph" &&
      block.kind !== "callout"
    ) {
      return null;
    }
    return (next) =>
      updateAt(blocks, target.blockIndex, (b) =>
        b.kind === "title" ||
        b.kind === "heading" ||
        b.kind === "paragraph" ||
        b.kind === "callout"
          ? { ...b, text: next }
          : b,
      );
  }
  if (target.kind === "item") {
    if (block.kind !== "list") {
      return null;
    }
    return (next) =>
      updateAt(blocks, target.blockIndex, (b) =>
        b.kind === "list"
          ? { ...b, items: updateAt(b.items, target.itemIndex, () => next) }
          : b,
      );
  }
  if (block.kind !== "table") {
    return null;
  }
  return (next) =>
    updateAt(blocks, target.blockIndex, (b) =>
      b.kind === "table"
        ? {
            ...b,
            rows: padRows(
              updateAt(b.rows, target.row, (row) =>
                updateAt(row, target.col, () => next),
              ),
            ),
          }
        : b,
    );
}

/**
 * The block editor that replaces the note `<textarea>` inside `BookEditor`
 * (spec 0021-1 §3). Props are pinned to a bare markdown string in, a bare
 * markdown string out — no `doc`/`stem`/`setNote` — so mounting this
 * elsewhere later (plan 0021 slice 6) is a prop change, not a rewrite.
 */
export function NoteEditor({
  markdown,
  onChange,
  assets = [],
  onUploadAsset,
  lexicon,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  /** Images available to this document. Empty disables `+ image` (spec
   * 0021-2 §2f). */
  assets?: NoteAsset[];
  /** Absent means uploads are unavailable in this mode (propose, spec
   * 0021-2 §2f). */
  onUploadAsset?: (file: File) => Promise<void>;
  /** The `Аү` button's lexicon sheet (spec 0021-3). Absent: the button
   * still wraps, no sheet opens. */
  lexicon?: LexiconAccess;
}) {
  // ponytail: re-parses the whole note per keystroke — ~8 blocks on the
  // longest real note. Memoize on `markdown` only if a note ever gets large
  // enough to feel it.
  const blocks = parseNoteBlocks(markdown);

  const focusRef = useRef<FocusTarget | null>(null);
  const pendingSelectionRef = useRef<{
    element: FieldElement;
    start: number;
    end: number;
  } | null>(null);
  const [hasFocused, setHasFocused] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  // The lexicon sheet's own state (spec 0021-3 §1): `token` is the wrapped
  // word the readout/search resolve against, `search` the search box, and
  // `adding` toggles the add-row's `AddWordForm` in. One object rather than
  // three separate `useState`s so opening/dismissing the sheet (§1) resets
  // all three together — a stray `search`/`adding` left over from the last
  // word would otherwise survive the *component's* lifetime (only the
  // `<Sheet>` JSX unmounts on dismiss, not `NoteEditor` itself).
  const [lexiconSheet, setLexiconSheet] = useState<{
    token: string;
    search: string;
    adding: boolean;
  } | null>(null);

  // Restores the caret/selection a toolbar button spliced markers around,
  // after the controlled re-render that follows `onChange` — see
  // `FocusTarget`'s doc comment and spec 0021-1 §4 mechanic 3. Runs after
  // every render but only acts when a button press left something pending.
  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (pending !== null) {
      pending.element.focus();
      pending.element.setSelectionRange(pending.start, pending.end);
      pendingSelectionRef.current = null;
    }
  });

  const focus = (target: FocusTarget) => {
    focusRef.current = target;
    setHasFocused(true);
  };

  /** Fields the toolbar cannot act on (a callout's title, a figure's
   * caption) must clear the target rather than leave the previous one
   * standing — otherwise B/Аү/icon stay enabled and splice their markers
   * into whichever block was focused before, silently corrupting a block
   * the author is not looking at. Registering a `FocusTarget` instead would
   * be worse: `resolveApply` maps a callout to its `text`, so bolding in the
   * title would splice into the body. Spec 0021-1 §1c pins the toolbar to
   * the body textarea only. */
  const blurToolbar = () => {
    focusRef.current = null;
    setHasFocused(false);
  };

  /** A structured-field edit: regenerates the touched block's `raw` (spec
   * §1b — every mutation recomputes `raw`, there is no dirty flag), then
   * normalizes separators (§1b-bis) before handing markdown up. */
  const commitEdit = (nextBlocks: NoteBlock[], editedIndex: number) => {
    const rendered = updateAt(nextBlocks, editedIndex, (b) => ({
      ...b,
      raw: renderNoteBlock(b),
    }));
    onChange(serializeNoteBlocks(normalizeSeparators(rendered)));
  };

  /** A structural edit (whole-block move/delete): no block's structured
   * fields changed, so no `raw` is regenerated — every block's `raw` stays
   * verbatim, only reordered or dropped as a whole. */
  const commitStructural = (nextBlocks: NoteBlock[]) => {
    onChange(serializeNoteBlocks(normalizeSeparators(nextBlocks)));
  };

  const editField = (target: FocusTarget, next: string) => {
    const apply = resolveApply(blocks, target);
    if (apply === null) {
      return;
    }
    commitEdit(apply(next), target.blockIndex);
  };

  const moveBlock = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= blocks.length) {
      return;
    }
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item as NoteBlock);
    commitStructural(next);
  };

  const removeBlock = (index: number) => {
    commitStructural(blocks.filter((_, i) => i !== index));
  };

  const addBlock = (
    kind: "paragraph" | "heading" | "list" | "table" | "callout",
  ) => {
    // Seeds must be non-empty: `renderNoteBlock` on an empty paragraph is
    // just "\n\n" (no block for the next parse to find — it gets absorbed
    // as blank lines onto whatever came before), and an empty heading/list
    // marker ("## ", "- ") loses its trailing space to `trim()` on
    // re-parse and stops being recognized as a marker at all. Non-empty
    // placeholder text round-trips correctly, same idea as `"# New
    // note\n\n"` for a brand-new note. A 1x1 table has real content in
    // neither sense — an empty cell already round-trips fine — so it's the
    // one kind that can stay empty. A callout's marker line is its
    // `[!variant]` tag, which survives `trim()` regardless of body length,
    // so it doesn't strictly need this either — seeded anyway so a freshly
    // added box isn't just a blank aside.
    const fresh: NoteBlock =
      kind === "paragraph"
        ? { kind: "paragraph", text: "New paragraph", raw: "" }
        : kind === "heading"
          ? { kind: "heading", text: "New heading", raw: "" }
          : kind === "list"
            ? { kind: "list", items: ["New item"], raw: "" }
            : kind === "table"
              ? { kind: "table", rows: [[""]], raw: "" }
              : {
                  kind: "callout",
                  variant: "note",
                  title: "",
                  text: "New callout",
                  raw: "",
                };
    commitEdit([...blocks, fresh], blocks.length);
  };

  const editCalloutVariant = (index: number, variant: CalloutVariant) => {
    commitEdit(
      updateAt(blocks, index, (b) =>
        b.kind === "callout" ? { ...b, variant } : b,
      ),
      index,
    );
  };

  const editCalloutTitle = (index: number, title: string) => {
    commitEdit(
      updateAt(blocks, index, (b) =>
        b.kind === "callout" ? { ...b, title } : b,
      ),
      index,
    );
  };

  const editFigureCaption = (index: number, caption: string) => {
    commitEdit(
      updateAt(blocks, index, (b) =>
        b.kind === "figure" ? { ...b, caption } : b,
      ),
      index,
    );
  };

  /** `+ image` picks an already-uploaded asset (spec 0021-2 §2f) — a stem is
   * never typed. */
  const addImageBlock = (stem: string) => {
    commitEdit(
      [...blocks, { kind: "figure", stem, caption: "", raw: "" }],
      blocks.length,
    );
    setImagePickerOpen(false);
  };

  const moveItem = (blockIndex: number, itemIndex: number, delta: -1 | 1) => {
    const block = blocks[blockIndex];
    if (block === undefined || block.kind !== "list") {
      return;
    }
    const to = itemIndex + delta;
    if (to < 0 || to >= block.items.length) {
      return;
    }
    const items = [...block.items];
    const [item] = items.splice(itemIndex, 1);
    items.splice(to, 0, item as string);
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "list" ? { ...b, items } : b,
      ),
      blockIndex,
    );
  };

  const removeItem = (blockIndex: number, itemIndex: number) => {
    const block = blocks[blockIndex];
    // ponytail: keep at least one item — an empty list block round-trips
    // as a bare blank line (`renderNoteBlock`'s `[].join("") + "\n"`).
    if (
      block === undefined ||
      block.kind !== "list" ||
      block.items.length <= 1
    ) {
      return;
    }
    const items = block.items.filter((_, i) => i !== itemIndex);
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "list" ? { ...b, items } : b,
      ),
      blockIndex,
    );
  };

  const addItem = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (block === undefined || block.kind !== "list") {
      return;
    }
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "list" ? { ...b, items: [...b.items, ""] } : b,
      ),
      blockIndex,
    );
  };

  const addRow = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (block === undefined || block.kind !== "table") {
      return;
    }
    const width = Math.max(1, ...block.rows.map((r) => r.length));
    const rows = padRows([...block.rows, Array<string>(width).fill("")]);
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "table" ? { ...b, rows } : b,
      ),
      blockIndex,
    );
  };

  const addColumn = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (block === undefined || block.kind !== "table") {
      return;
    }
    const rows = padRows(block.rows.map((r) => [...r, ""]));
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "table" ? { ...b, rows } : b,
      ),
      blockIndex,
    );
  };

  const removeRow = (blockIndex: number, rowIndex: number) => {
    const block = blocks[blockIndex];
    // ponytail: keep at least one row, same reasoning as `removeItem`.
    if (
      block === undefined ||
      block.kind !== "table" ||
      block.rows.length <= 1
    ) {
      return;
    }
    const rows = padRows(block.rows.filter((_, i) => i !== rowIndex));
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "table" ? { ...b, rows } : b,
      ),
      blockIndex,
    );
  };

  /** Removes the last column. No per-column delete affordance exists (a
   * table has no natural per-column row to hang one off), so — mirroring
   * "new blocks append at the end; do not build insert-at-position" (§3) —
   * delete only ever shrinks from the end too. */
  const removeColumn = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (block === undefined || block.kind !== "table") {
      return;
    }
    const width = Math.max(0, ...block.rows.map((r) => r.length));
    if (width <= 1) {
      return;
    }
    const rows = padRows(block.rows.map((r) => r.slice(0, width - 1)));
    commitEdit(
      updateAt(blocks, blockIndex, (b) =>
        b.kind === "table" ? { ...b, rows } : b,
      ),
      blockIndex,
    );
  };

  /** Reads the current selection off the focused field, splices `before`
   * and `after` around it, and restores the selection over the same text
   * (spec §4 mechanics 2–3). Returns the text that was wrapped, or
   * `undefined` if there was no focused field to act on — spec 0021-3 §1
   * uses this to decide whether to open the lexicon sheet (only for a
   * non-empty selection); every other caller still just ignores it. */
  const wrapSelection = (before: string, after: string) => {
    const target = focusRef.current;
    if (target === null) {
      return undefined;
    }
    const apply = resolveApply(blocks, target);
    if (apply === null) {
      return undefined;
    }
    const { element } = target;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const value = element.value;
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + before + selected + after + value.slice(end);
    pendingSelectionRef.current = {
      element,
      start: start + before.length,
      end: start + before.length + selected.length,
    };
    commitEdit(apply(next), target.blockIndex);
    return selected;
  };

  /** Replaces the current selection outright with `text` — unlike
   * `wrapSelection`, nothing is spliced in around it, because the stars are
   * already in place from the wrap that opened the lexicon sheet. Used when
   * tapping a search row swaps the starred word for that entry's
   * dictionary form (spec 0021-3 §3): `*Саламдашуу*` -> `*Салам*`, the
   * stars untouched. Same restore-selection mechanic as `wrapSelection`. */
  const replaceSelection = (text: string) => {
    const target = focusRef.current;
    if (target === null) {
      return;
    }
    const apply = resolveApply(blocks, target);
    if (apply === null) {
      return;
    }
    const { element } = target;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const value = element.value;
    const next = value.slice(0, start) + text + value.slice(end);
    pendingSelectionRef.current = { element, start, end: start + text.length };
    commitEdit(apply(next), target.blockIndex);
  };

  /** Inserts `text` at the caret and places the (collapsed) caret after it
   * — used for `[icon:name]` insertion (§4). */
  const insertAtCaret = (text: string) => {
    const target = focusRef.current;
    if (target === null) {
      return;
    }
    const apply = resolveApply(blocks, target);
    if (apply === null) {
      return;
    }
    const { element } = target;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const value = element.value;
    const next = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    pendingSelectionRef.current = { element, start: caret, end: caret };
    commitEdit(apply(next), target.blockIndex);
  };

  const filteredIcons = NOTE_ICONS.filter((name) =>
    name.toLowerCase().includes(iconSearch.toLowerCase()),
  );

  // Parsed only while the sheet is actually open — `NoteEditor` re-renders
  // per keystroke (it's controlled), and a real domain's entries run into
  // the thousands, so `safeParse`-ing all of them on every render would be
  // wasted work the rest of the time. Still derived fresh from
  // `lexicon.entries` every time, never cached in local state — that's what
  // lets the readout flip to exact the instant `onAddEntry` lands a new
  // entry in the parent's props (spec 0021-3 §4c).
  //
  // `itemSchema.safeParse` also does the load-bearing part of §2's other
  // caveat: `domainEntries`/`entries` is raw, untrusted `unknown[]` — some
  // drafts are half-typed (e.g. a lexeme missing `gloss`) — so a failed
  // parse just drops that entry from the pool instead of crashing the
  // readout. Separately: at runtime the merged pool also carries
  // learner-created `user-` entries this editor never sees, but
  // `pickBest` (lookup.ts) prefers a non-`user-` entry whenever both
  // match, so an authored entry always wins when one exists — this readout
  // can only be over-pessimistic (⚠ no entry where a learner's own word
  // would actually resolve), never wrong about an entry the author
  // themself wrote.
  //
  // ponytail: re-parses the whole entry list per keystroke while the sheet is
  // open (search state lives on this controlled component). Gated on an open
  // sheet, so it costs nothing in the common case, but a lexicon with
  // thousands of entries would feel it while typing a search. Memoize on
  // `lexicon.entries` if that ever shows up in a real Book.
  const lexiconEntries: Item[] =
    lexicon !== undefined && lexiconSheet !== null
      ? lexicon.entries.flatMap((raw) => {
          const parsed = itemSchema.safeParse(raw);
          return parsed.success ? [parsed.data] : [];
        })
      : [];

  const lexiconResolved =
    lexiconSheet !== null
      ? resolveToken(lexiconSheet.token, lexiconEntries)
      : undefined;
  // Outcome is derived from the entry `resolveToken` actually returned, not
  // by re-running its exact/prefix rules (spec 0021-3 §2) — the whole point
  // is to report what the real function did, including the prefix-match
  // case where it silently bound to a *different* word than the token.
  const lexiconResolvedText =
    lexiconResolved !== undefined
      ? lexiconEntryText(lexiconResolved)
      : undefined;
  const lexiconExact =
    lexiconSheet !== null &&
    lexiconResolvedText !== undefined &&
    normalizeToken(lexiconResolvedText) === normalizeToken(lexiconSheet.token);

  const lexiconQuery = lexiconSheet?.search.trim().toLowerCase() ?? "";
  // `lexiconEntryText` returning `undefined` here also guards the
  // `itemDisplayText` call below it: that function throws on a `pair` item,
  // which a domain's entries never legitimately hold but a raw draft could
  // — this filter drops anything without a script/term before either read
  // reaches it, same guard the readout above gets from `resolveToken`
  // itself never returning a pair/sentence match.
  const lexiconMatches = lexiconEntries.filter((item) => {
    const text = lexiconEntryText(item);
    if (text === undefined) {
      return false;
    }
    return (
      lexiconQuery === "" ||
      text.toLowerCase().includes(lexiconQuery) ||
      itemDisplayText(item).toLowerCase().includes(lexiconQuery)
    );
  });
  // Capped the way `DomainEditor`'s own entry list is (spec 0021-3 §3).
  const lexiconVisible = lexiconMatches.slice(0, 50);
  const lexiconHidden = lexiconMatches.length - lexiconVisible.length;

  return (
    <div className="note-editor">
      <div className="note-editor-toolbar">
        <button
          type="button"
          disabled={!hasFocused}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrapSelection("**", "**")}
        >
          B
        </button>
        <button
          type="button"
          disabled={!hasFocused}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            // Wrapping happens first and unconditionally (spec 0021-3 §1):
            // the button always does its slice-1 job even when there's no
            // lexicon to open a sheet against, or the selection was empty
            // and there's no word to resolve.
            const selected = wrapSelection("*", "*");
            if (
              lexicon !== undefined &&
              selected !== undefined &&
              selected !== ""
            ) {
              setLexiconSheet({ token: selected, search: "", adding: false });
            }
          }}
        >
          Аү
        </button>
        <button
          type="button"
          disabled={!hasFocused}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIconPickerOpen((open) => !open)}
        >
          icon
        </button>
      </div>
      {iconPickerOpen && (
        <div className="note-editor-icon-picker">
          <input
            type="text"
            placeholder="Search…"
            value={iconSearch}
            onChange={(e) => setIconSearch(e.target.value)}
          />
          <ul className="editor-list">
            {filteredIcons.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="plain"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    insertAtCaret(`[icon:${name}]`);
                    setIconPickerOpen(false);
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="editor-list">
        {blocks.map((block, index) => {
          // Only read for a "figure" block, below — computed once here so
          // the JSX doesn't repeat the lookup (spec 0021-2 §2g: the editor
          // shows the picker's own `url`, never `getAssetUrl`).
          const figureAsset =
            block.kind === "figure"
              ? assets.find((a) => a.stem === block.stem)
              : undefined;
          return (
            // No stable id exists per block (the pinned `NoteBlock` type has
            // none, matching `NoteView`'s own `key={index}`) — index is fine
            // here since content always re-derives from `markdown`.
            <li key={index} className="note-editor-block">
              {block.kind === "title" || block.kind === "heading" ? (
                <input
                  type="text"
                  value={block.text}
                  onFocus={(e) =>
                    focus({
                      element: e.currentTarget,
                      kind: "text",
                      blockIndex: index,
                    })
                  }
                  onChange={(e) =>
                    editField(
                      {
                        element: e.currentTarget,
                        kind: "text",
                        blockIndex: index,
                      },
                      e.target.value,
                    )
                  }
                />
              ) : block.kind === "paragraph" ? (
                <textarea
                  rows={3}
                  value={block.text}
                  onFocus={(e) =>
                    focus({
                      element: e.currentTarget,
                      kind: "text",
                      blockIndex: index,
                    })
                  }
                  onChange={(e) =>
                    editField(
                      {
                        element: e.currentTarget,
                        kind: "text",
                        blockIndex: index,
                      },
                      e.target.value,
                    )
                  }
                />
              ) : block.kind === "list" ? (
                <div className="note-editor-list-block">
                  <ul className="editor-list">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        <input
                          type="text"
                          value={item}
                          onFocus={(e) =>
                            focus({
                              element: e.currentTarget,
                              kind: "item",
                              blockIndex: index,
                              itemIndex,
                            })
                          }
                          onChange={(e) =>
                            editField(
                              {
                                element: e.currentTarget,
                                kind: "item",
                                blockIndex: index,
                                itemIndex,
                              },
                              e.target.value,
                            )
                          }
                        />
                        <RowActions
                          onUp={
                            itemIndex > 0
                              ? () => moveItem(index, itemIndex, -1)
                              : undefined
                          }
                          onDown={
                            itemIndex < block.items.length - 1
                              ? () => moveItem(index, itemIndex, 1)
                              : undefined
                          }
                          onRemove={() => removeItem(index, itemIndex)}
                          removeLabel="Delete item"
                        />
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="editor-add"
                    onClick={() => addItem(index)}
                  >
                    + item
                  </button>
                </div>
              ) : block.kind === "callout" ? (
                <div className="note-editor-callout-block">
                  <select
                    value={block.variant}
                    onChange={(e) =>
                      editCalloutVariant(
                        index,
                        e.target.value as CalloutVariant,
                      )
                    }
                  >
                    {CALLOUT_VARIANTS.map((variant) => (
                      <option key={variant} value={variant}>
                        {variant}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Title (optional)"
                    value={block.title}
                    onFocus={blurToolbar}
                    onChange={(e) => editCalloutTitle(index, e.target.value)}
                  />
                  <textarea
                    rows={3}
                    value={block.text}
                    onFocus={(e) =>
                      focus({
                        element: e.currentTarget,
                        kind: "text",
                        blockIndex: index,
                      })
                    }
                    onChange={(e) =>
                      editField(
                        {
                          element: e.currentTarget,
                          kind: "text",
                          blockIndex: index,
                        },
                        e.target.value,
                      )
                    }
                  />
                </div>
              ) : block.kind === "figure" ? (
                <div className="note-editor-figure-block">
                  {figureAsset !== undefined ? (
                    <img className="asset-thumb" src={figureAsset.url} alt="" />
                  ) : (
                    <p className="status">Image not available: {block.stem}</p>
                  )}
                  <input
                    type="text"
                    placeholder="Caption (optional)"
                    value={block.caption}
                    onFocus={blurToolbar}
                    onChange={(e) => editFigureCaption(index, e.target.value)}
                  />
                </div>
              ) : (
                <div className="note-editor-table-block">
                  {block.rows.map((row, rowIndex) => (
                    <div className="note-editor-table-row" key={rowIndex}>
                      {row.map((cell, colIndex) => (
                        <input
                          key={colIndex}
                          type="text"
                          value={cell}
                          onFocus={(e) =>
                            focus({
                              element: e.currentTarget,
                              kind: "cell",
                              blockIndex: index,
                              row: rowIndex,
                              col: colIndex,
                            })
                          }
                          onChange={(e) =>
                            editField(
                              {
                                element: e.currentTarget,
                                kind: "cell",
                                blockIndex: index,
                                row: rowIndex,
                                col: colIndex,
                              },
                              e.target.value,
                            )
                          }
                        />
                      ))}
                      <RowActions
                        onRemove={() => removeRow(index, rowIndex)}
                        removeLabel="Delete row"
                      />
                    </div>
                  ))}
                  <div className="editor-add">
                    <button type="button" onClick={() => addRow(index)}>
                      + row
                    </button>
                    <button type="button" onClick={() => addColumn(index)}>
                      + column
                    </button>
                    <button type="button" onClick={() => removeColumn(index)}>
                      - column
                    </button>
                  </div>
                </div>
              )}
              <RowActions
                onUp={index > 0 ? () => moveBlock(index, -1) : undefined}
                onDown={
                  index < blocks.length - 1
                    ? () => moveBlock(index, 1)
                    : undefined
                }
                onRemove={() => removeBlock(index)}
                removeLabel="Delete block"
              />
            </li>
          );
        })}
      </ul>
      <div className="editor-add">
        <button type="button" onClick={() => addBlock("paragraph")}>
          + ¶
        </button>
        <button type="button" onClick={() => addBlock("heading")}>
          + H
        </button>
        <button type="button" onClick={() => addBlock("list")}>
          + list
        </button>
        <button type="button" onClick={() => addBlock("table")}>
          + table
        </button>
        <button type="button" onClick={() => addBlock("callout")}>
          + box
        </button>
        <button
          type="button"
          disabled={assets.length === 0}
          onClick={() => setImagePickerOpen((open) => !open)}
        >
          + image
        </button>
      </div>
      {/* No "add one in Assets" hint: propose mode has no assets manager at
          all (Storage RLS is maintainer-only), so pointing there would
          misdirect exactly the reader §2f's reason exists to inform. */}
      {assets.length === 0 && (
        <p className="status">No images available to insert.</p>
      )}
      {imagePickerOpen && (
        <div className="note-editor-image-picker">
          {onUploadAsset !== undefined && (
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file !== undefined) {
                  void onUploadAsset(file);
                }
              }}
            />
          )}
          <ul className="editor-list">
            {assets.map((asset) => (
              <li key={asset.stem}>
                <button
                  type="button"
                  className="plain"
                  onClick={() => addImageBlock(asset.stem)}
                >
                  <img className="asset-thumb" src={asset.url} alt="" />
                  {asset.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {lexicon !== undefined && lexiconSheet !== null && (
        <Sheet
          label={`Lexicon: ${lexiconSheet.token}`}
          onDismiss={() => setLexiconSheet(null)}
        >
          <button
            type="button"
            className="plain sheet-close"
            aria-label="Close"
            onClick={() => setLexiconSheet(null)}
          >
            &#10005;
          </button>
          <p className="status">
            {lexiconResolved === undefined
              ? "⚠ no entry for this word"
              : lexiconExact
                ? `✓ ${lexiconResolvedText} · ${itemDisplayText(lexiconResolved)}`
                : `→ ${lexiconResolvedText} · ${itemDisplayText(lexiconResolved)}  (prefix match, not exact)`}
          </p>
          {lexiconSheet.adding ? (
            <AddWordForm
              domain={lexicon.domain}
              prefill={lexiconSheet.token}
              makeId={() => newEntityId(lexicon.domainCode)}
              sourceRef={lexicon.sourceRef}
              onSubmit={(item) => {
                lexicon.onAddEntry?.(item);
                setLexiconSheet((s) =>
                  s === null ? s : { ...s, adding: false },
                );
              }}
              onCancel={() =>
                setLexiconSheet((s) =>
                  s === null ? s : { ...s, adding: false },
                )
              }
            />
          ) : (
            <>
              {/* Deliberately no `onFocus={blurToolbar}` here (compare the
                  callout-title/figure-caption inputs above): `Sheet` is a
                  modal `<dialog>`, so the toolbar is already unreachable
                  while this is open — the hazard `blurToolbar` guards
                  against can't occur. Wiring it anyway would actively
                  break `replaceSelection` below, which depends on
                  `focusRef.current` still naming the field this sheet was
                  opened for. */}
              <input
                type="text"
                placeholder="Search the lexicon…"
                value={lexiconSheet.search}
                onChange={(e) =>
                  setLexiconSheet((s) =>
                    s === null ? s : { ...s, search: e.target.value },
                  )
                }
              />
              <ul className="editor-list">
                {lexiconVisible.map((item) => {
                  const text = lexiconEntryText(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="plain"
                        onClick={() => {
                          if (text === undefined) {
                            return;
                          }
                          // Same splice-and-restore-selection mechanic
                          // `wrapSelection` uses (spec 0021-3 §3): only the
                          // inner word changes, the stars stay put.
                          replaceSelection(text);
                          setLexiconSheet((s) =>
                            s === null ? s : { ...s, token: text },
                          );
                        }}
                      >
                        {text} · {itemDisplayText(item)}
                      </button>
                    </li>
                  );
                })}
                {lexiconHidden > 0 && (
                  <li>…{lexiconHidden} more — search to narrow</li>
                )}
              </ul>
              {lexicon.onAddEntry !== undefined ? (
                <button
                  type="button"
                  className="editor-add"
                  onClick={() =>
                    setLexiconSheet((s) =>
                      s === null ? s : { ...s, adding: true },
                    )
                  }
                >
                  ⊕ add "{lexiconSheet.token}" as new
                </button>
              ) : (
                <>
                  <button type="button" className="editor-add" disabled>
                    ⊕ add "{lexiconSheet.token}" as new
                  </button>
                  {/* §0: a deliberate staging gap, not an oversight — say
                      why rather than just disabling. */}
                  <p className="status">
                    This mode can't add lexicon entries yet — open this Book
                    privately (no account) to add one.
                  </p>
                </>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
