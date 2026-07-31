import { useState } from "react";
import type { TapLookup } from "./TappableText";
import { EntryPopup } from "./EntryPopup";

/** One inline run within a line of note markdown: `**bold**` is purely
 * visual, `*kyrgyz*` is the one tappable+italic unit (the plan 0006
 * note-rendering fix — see the task's "Concretely" section), `[icon:name]`
 * is one of the app's own `art/icons` glyphs, everything else is plain
 * prose. */
interface InlineSegment {
  kind: "plain" | "bold" | "kyrgyz" | "icon";
  text: string;
}

/** Splits a line of text into plain/bold/kyrgyz/icon runs. Non-greedy per
 * marker (not whole-line), so mid-word bold like `Саламат**сыз**бы` still
 * splits correctly. */
function parseInline(text: string): InlineSegment[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[icon:[a-z0-9_]+\])/)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return { kind: "bold", text: part.slice(2, -2) };
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return { kind: "kyrgyz", text: part.slice(1, -1) };
      }
      if (part.startsWith("[icon:")) {
        return { kind: "icon", text: part.slice(6, -1) };
      }
      return { kind: "plain", text: part };
    });
}

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; rows: string[][] };

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

/** Turns one blank-line-separated chunk into blocks: `## ` lines are their
 * own heading, runs of `| a | b |` lines a table, runs of `- ` lines a list
 * (wrapped continuation lines join onto the preceding item), and everything
 * between them a paragraph. A chunk can hold several of these — an author
 * writing a heading straight above its table gets both, not one run-on
 * paragraph. */
function parseChunk(chunkLines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (const line of chunkLines) {
    if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("|")) {
      const cells = tableCells(line);
      const last = blocks[blocks.length - 1];
      if (paragraph.length === 0 && last?.kind === "table") {
        if (!isTableRule(cells)) {
          last.rows.push(cells);
        }
        continue;
      }
      flush();
      blocks.push({ kind: "table", rows: [cells] });
      continue;
    }
    if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (paragraph.length === 0 && last?.kind === "list") {
        last.items.push(line.slice(2).trim());
        continue;
      }
      flush();
      blocks.push({ kind: "list", items: [line.slice(2).trim()] });
      continue;
    }
    // A continuation of whatever is open: a wrapped list item stays with its
    // bullet, anything else keeps building the current paragraph.
    const last = blocks[blocks.length - 1];
    if (paragraph.length === 0 && last?.kind === "list") {
      last.items[last.items.length - 1] += ` ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Splits a note's raw markdown into its display title and body blocks:
 * the `# ` line is the title, and each blank-line-separated chunk below it
 * (ported from the old `UnitScreen.parseNote`) becomes one or more blocks. */
function parseBody(markdown: string): { title: string; blocks: Block[] } {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("# "));
  const title =
    headingIndex === -1 ? "" : (lines[headingIndex] ?? "").slice(2).trim();
  const bodyLines = headingIndex === -1 ? lines : lines.slice(headingIndex + 1);

  const blocks = bodyLines
    .join("\n")
    .split(/\n\s*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((chunkLines) => chunkLines.length > 0)
    .flatMap(parseChunk);

  return { title, blocks };
}

/** Renders one line's inline segments: `**bold**` as plain `<strong>`,
 * `*kyrgyz*` as a single tappable `<em>` unit (never re-split word-by-word,
 * so multi-word spans like `*Менин атым ...*` exact-match the lexicon entry
 * via `resolveToken`), plain runs as-is. */
function InlineRun({
  text,
  onTap,
}: {
  text: string;
  onTap: (span: string) => void;
}) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        switch (segment.kind) {
          case "bold":
            return <strong key={index}>{segment.text}</strong>;
          case "kyrgyz":
            return (
              <button
                key={index}
                type="button"
                className="plain tappable-kyrgyz"
                onClick={() => onTap(segment.text)}
              >
                <em>{segment.text}</em>
              </button>
            );
          case "icon":
            return (
              <img
                key={index}
                className="icon-glyph"
                src={`${import.meta.env.BASE_URL}art/icons/${segment.text}.png`}
                alt=""
              />
            );
          case "plain":
            return segment.text;
        }
      })}
    </>
  );
}

/**
 * Renders a unit note's raw markdown (plan 0006 note-rendering fix): the
 * `# ` line as a plain `<h2>` title, `## ` lines as `<h3>`,
 * blank-line-separated paragraphs, `- ` bullet lists and `| a | b |` tables
 * as `<p>`/`<ul><li>`/`<table>`, and within each, `*kyrgyz*` inline spans
 * as the only tappable content (via a local `EntryPopup`, same
 * one-popup-at-a-time pattern as `TappableText` — not routed through
 * `TappableText` itself, since that re-tokenizes by whitespace, which would
 * wrongly re-split a multi-word starred span).
 */
export function NoteView({
  markdown,
  lookup,
}: {
  markdown: string;
  lookup: TapLookup;
}) {
  const [tappedSpan, setTappedSpan] = useState<string | null>(null);
  const { title, blocks } = parseBody(markdown);

  return (
    <>
      {title !== "" ? <h2>{title}</h2> : null}
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <h3 key={index}>
                <InlineRun text={block.text} onTap={setTappedSpan} />
              </h3>
            );
          case "list":
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineRun text={item} onTap={setTappedSpan} />
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={index} className="note-table">
                <table className="vocab-table">
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => {
                          const Cell = rowIndex === 0 ? "th" : "td";
                          return (
                            <Cell key={cellIndex}>
                              <InlineRun text={cell} onTap={setTappedSpan} />
                            </Cell>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "paragraph":
            return (
              <p key={index}>
                <InlineRun text={block.text} onTap={setTappedSpan} />
              </p>
            );
        }
      })}
      {tappedSpan !== null ? (
        <EntryPopup
          token={tappedSpan}
          lookup={lookup}
          onClose={() => setTappedSpan(null)}
        />
      ) : null}
    </>
  );
}
