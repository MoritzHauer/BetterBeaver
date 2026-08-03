/**
 * A unit note's markdown, parsed into editable blocks (plan 0021 §4, spec
 * 0021-1). This is the DOM-free half of what `NoteView.tsx` used to do
 * alone: that component still owns inline rendering (`parseInline`,
 * `InlineRun`), but block-level parsing/rendering lives here so the block
 * editor (`apps/web/src/components/NoteEditor.tsx`) and the renderer share
 * one parser instead of drifting apart.
 *
 * `raw` is a partition of the source, not a re-derived string: every block's
 * `raw` holds the verbatim lines that produced it, including the blank
 * lines that follow, so `serializeNoteBlocks(parseNoteBlocks(md)) === md`
 * for any `md` that produces at least one block. An untouched block is
 * never re-rendered — only `renderNoteBlock` regenerates canonical
 * markdown, and only the mutation path (an editor's onChange) ever calls
 * it. See `normalizeSeparators` below for the one hazard that comes with a
 * `raw` that doesn't end in `\n\n`.
 *
 * One documented exception: a non-empty but whitespace-only `md` (e.g.
 * `"\n\n"`) round-trips to `""`, because every line is blank and
 * `pendingPrefix` accumulates them but is never flushed — nothing ever
 * pushes a block for it to attach to. Not fixed, on purpose: no real note
 * is whitespace-only, nothing an author wrote is at risk, and giving this
 * case a block would make `NoteView` render an empty paragraph where it
 * renders nothing today.
 */
export type NoteBlock =
  | { kind: "title"; text: string; raw: string }
  | { kind: "heading"; text: string; raw: string }
  | { kind: "paragraph"; text: string; raw: string }
  | { kind: "list"; items: string[]; raw: string }
  | { kind: "table"; rows: string[][]; raw: string };

/** A `| --- | :--- |` alignment row, which carries no content. */
function isTableRule(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** `| a | b |` → `["a", "b"]` (the empty runs outside the outer pipes drop). */
function tableCells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Splits markdown into lines with their original terminator attached, so
 * concatenating them reproduces the source exactly — including a final
 * line with no trailing `\n` and (via an empty match array) the empty
 * string producing zero lines. */
function splitLines(markdown: string): string[] {
  return markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * Parses a note's raw markdown into blocks: one pass over every line
 * (blank lines included), classifying on the trimmed line while keeping the
 * untrimmed line for `raw`. Reproduces today's `NoteView` classification
 * exactly (see spec 0021-1 §1c) plus one change: content before the first
 * `# ` line becomes ordinary blocks instead of being discarded —
 * `NoteView` is the one that keeps discarding it (see its `.slice()`).
 */
export function parseNoteBlocks(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  /** The block eligible for extension by the *next* line — reset to `null`
   * by any blank line (rule 2: a blank line always ends the current
   * block), unlike `blocks[blocks.length - 1]`, which keeps whatever was
   * last pushed so a blank line has something to attach its `raw` to. */
  let last: NoteBlock | null = null;
  let titleSeen = false;
  /** Blank lines before the very first block have no block to attach to
   * yet; buffered here and prepended to whichever block is produced
   * first. */
  let pendingPrefix = "";

  for (const raw of splitLines(markdown)) {
    const trimmed = raw.trim();

    if (trimmed === "") {
      const prev = blocks[blocks.length - 1];
      if (prev === undefined) {
        pendingPrefix += raw;
      } else {
        prev.raw += raw;
      }
      last = null;
      continue;
    }

    if (!titleSeen && trimmed.startsWith("# ")) {
      titleSeen = true;
      const block: NoteBlock = {
        kind: "title",
        text: trimmed.slice(2).trim(),
        raw: pendingPrefix + raw,
      };
      pendingPrefix = "";
      blocks.push(block);
      last = block;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      const block: NoteBlock = {
        kind: "heading",
        text: trimmed.slice(3).trim(),
        raw: pendingPrefix + raw,
      };
      pendingPrefix = "";
      blocks.push(block);
      last = block;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const cells = tableCells(trimmed);
      if (last !== null && last.kind === "table") {
        if (!isTableRule(cells)) {
          last.rows.push(cells);
        }
        last.raw += raw;
      } else {
        const block: NoteBlock = {
          kind: "table",
          rows: [cells],
          raw: pendingPrefix + raw,
        };
        pendingPrefix = "";
        blocks.push(block);
        last = block;
      }
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (last !== null && last.kind === "list") {
        last.items.push(trimmed.slice(2).trim());
        last.raw += raw;
      } else {
        const block: NoteBlock = {
          kind: "list",
          items: [trimmed.slice(2).trim()],
          raw: pendingPrefix + raw,
        };
        pendingPrefix = "";
        blocks.push(block);
        last = block;
      }
      continue;
    }

    // A continuation of whatever is open: a wrapped list item stays with
    // its bullet, an open paragraph keeps growing, anything else starts a
    // new paragraph.
    if (last !== null && last.kind === "list") {
      const lastIndex = last.items.length - 1;
      last.items[lastIndex] = `${last.items[lastIndex] ?? ""} ${trimmed}`;
      last.raw += raw;
      continue;
    }
    if (last !== null && last.kind === "paragraph") {
      last.text += ` ${trimmed}`;
      last.raw += raw;
      continue;
    }
    const block: NoteBlock = {
      kind: "paragraph",
      text: trimmed,
      raw: pendingPrefix + raw,
    };
    pendingPrefix = "";
    blocks.push(block);
    last = block;
  }

  return blocks;
}

/** Renders one block's canonical markdown — always ending in a trailing
 * blank line. Used only on the mutation path (an edited block's new
 * `raw`); untouched blocks keep their original `raw` verbatim. */
export function renderNoteBlock(block: NoteBlock): string {
  switch (block.kind) {
    case "title":
      return `# ${block.text}\n\n`;
    case "heading":
      return `## ${block.text}\n\n`;
    case "paragraph":
      return `${block.text}\n\n`;
    case "list":
      return block.items.map((item) => `- ${item}\n`).join("") + "\n";
    case "table": {
      const [firstRow, ...restRows] = block.rows;
      const rows =
        firstRow === undefined
          ? []
          : [firstRow, firstRow.map(() => "---"), ...restRows];
      return rows.map((row) => `| ${row.join(" | ")} |\n`).join("") + "\n";
    }
  }
}

/**
 * Every block but the last must self-terminate with a full blank-line
 * separator (its `raw` must end in `\n\n`), or concatenating a block after
 * it fuses the two into one (spec 0021-1 §1b-bis). Run by every mutation —
 * edit, insert, delete, move — immediately before serializing.
 * `parseNoteBlocks` itself normalizes nothing, so the round-trip guarantee
 * holds for any markdown that produces at least one block, including one
 * with no trailing newline.
 *
 * A blank line between blocks is absorbed into the *preceding* block's
 * `raw`, so in a real note every non-last block already ends in `\n\n`.
 * The block that ends in a single `\n` is the **last** one — its own line
 * terminator, with no following blank line. The hazard therefore appears
 * only when the last block stops being last: an append, or a move that
 * pushes it up. `endsWith("\n")`, as the originally pinned spec snippet
 * checked, is satisfied by that single `\n` and never fires; the ex-last
 * block then concatenates straight onto the next block's first line, and
 * the two fuse if that line is paragraph-continuable (a `- `, `|`, or
 * `## ` marker still starts a fresh block, which is why a single reorder
 * step can survive before a second one fuses). Appends the missing
 * newline(s) to the existing verbatim `raw` rather than re-rendering via
 * `renderNoteBlock`, which would collapse a hand-wrapped multi-line block
 * onto one line — exactly the diff-explosion `raw` exists to avoid (§1a).
 * Deliberate deviation from the spec's pinned snippet, reviewed and
 * confirmed necessary.
 */
export const normalizeSeparators = (blocks: NoteBlock[]): NoteBlock[] =>
  blocks.map((b, i) =>
    i === blocks.length - 1 || b.raw.endsWith("\n\n")
      ? b
      : { ...b, raw: b.raw + (b.raw.endsWith("\n") ? "\n" : "\n\n") },
  );

/** `raw` is a partition: concatenation, not joining with separators. */
export function serializeNoteBlocks(blocks: NoteBlock[]): string {
  return blocks.map((b) => b.raw).join("");
}
