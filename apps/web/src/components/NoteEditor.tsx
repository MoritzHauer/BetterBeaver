import { useEffect, useRef, useState } from "react";
import {
  type NoteBlock,
  normalizeSeparators,
  parseNoteBlocks,
  renderNoteBlock,
  serializeNoteBlocks,
} from "@betterbeaver/engine";
import { NOTE_ICONS } from "../content/noteIcons";
import { RowActions } from "../screens/edit/fields";

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

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
      block.kind !== "paragraph"
    ) {
      return null;
    }
    return (next) =>
      updateAt(blocks, target.blockIndex, (b) =>
        b.kind === "title" || b.kind === "heading" || b.kind === "paragraph"
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
}: {
  markdown: string;
  onChange: (markdown: string) => void;
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

  const addBlock = (kind: "paragraph" | "heading" | "list" | "table") => {
    // Seeds must be non-empty: `renderNoteBlock` on an empty paragraph is
    // just "\n\n" (no block for the next parse to find — it gets absorbed
    // as blank lines onto whatever came before), and an empty heading/list
    // marker ("## ", "- ") loses its trailing space to `trim()` on
    // re-parse and stops being recognized as a marker at all. Non-empty
    // placeholder text round-trips correctly, same idea as `"# New
    // note\n\n"` for a brand-new note. A 1x1 table has real content in
    // neither sense — an empty cell already round-trips fine — so it's the
    // one kind that can stay empty.
    const fresh: NoteBlock =
      kind === "paragraph"
        ? { kind: "paragraph", text: "New paragraph", raw: "" }
        : kind === "heading"
          ? { kind: "heading", text: "New heading", raw: "" }
          : kind === "list"
            ? { kind: "list", items: ["New item"], raw: "" }
            : { kind: "table", rows: [[""]], raw: "" };
    commitEdit([...blocks, fresh], blocks.length);
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
   * (spec §4 mechanics 2–3). */
  const wrapSelection = (before: string, after: string) => {
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
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + before + selected + after + value.slice(end);
    pendingSelectionRef.current = {
      element,
      start: start + before.length,
      end: start + before.length + selected.length,
    };
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
          onClick={() => wrapSelection("*", "*")}
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
        {blocks.map((block, index) => (
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
        ))}
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
      </div>
    </div>
  );
}
