import { useState } from "react";
import { type NoteBlock, parseNoteBlocks } from "@betterbeaver/engine";
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

/** Splits a note's raw markdown into its display title and body blocks,
 * via the shared `parseNoteBlocks` (engine, spec 0021-1 §1). Unlike the
 * editor, which keeps every block for round-tripping, the renderer drops
 * everything before the first `title` block — a learner never saw that
 * content before this slice, and rendering it now would be a visible
 * behaviour change this slice must not make (§2). No title block at all
 * (an untitled note) keeps every block instead of dropping the lot. */
function parseBody(markdown: string): { title: string; blocks: NoteBlock[] } {
  const blocks = parseNoteBlocks(markdown);
  const titleIndex = blocks.findIndex((block) => block.kind === "title");
  if (titleIndex === -1) {
    return { title: "", blocks };
  }
  const title = blocks[titleIndex];
  return {
    title: title?.kind === "title" ? title.text : "",
    blocks: blocks.slice(titleIndex + 1),
  };
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
