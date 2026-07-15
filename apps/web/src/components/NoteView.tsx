import { useState } from "react";
import type { TapLookup } from "./TappableText";
import { EntryPopup } from "./EntryPopup";

/** One inline run within a line of note markdown: `**bold**` is purely
 * visual, `*kyrgyz*` is the one tappable+italic unit (the plan 0006
 * note-rendering fix — see the task's "Concretely" section), everything else
 * is plain prose. */
interface InlineSegment {
  kind: "plain" | "bold" | "kyrgyz";
  text: string;
}

/** Splits a line of text into plain/bold/kyrgyz runs. Non-greedy per marker
 * (not whole-line), so mid-word bold like `Саламат**сыз**бы` still splits
 * correctly. */
function parseInline(text: string): InlineSegment[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return { kind: "bold", text: part.slice(2, -2) };
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return { kind: "kyrgyz", text: part.slice(1, -1) };
      }
      return { kind: "plain", text: part };
    });
}

type Block =
  { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/** Splits a note's raw markdown into its display title and body blocks:
 * blank-line-separated chunks (ported from the old `UnitScreen.parseNote`),
 * where a chunk whose first line starts with `- ` becomes a `list` block
 * (wrapped continuation lines join onto the preceding item) and everything
 * else becomes a `paragraph` block. */
function parseBody(markdown: string): { title: string; blocks: Block[] } {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("# "));
  const title =
    headingIndex === -1 ? "" : (lines[headingIndex] ?? "").slice(2).trim();
  const bodyLines = headingIndex === -1 ? lines : lines.slice(headingIndex + 1);

  const chunks = bodyLines
    .join("\n")
    .split(/\n\s*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((chunkLines) => chunkLines.length > 0);

  const blocks: Block[] = chunks.map((chunkLines) => {
    if (chunkLines[0]?.startsWith("- ")) {
      const items: string[] = [];
      for (const line of chunkLines) {
        if (line.startsWith("- ")) {
          items.push(line.slice(2).trim());
        } else {
          items[items.length - 1] += ` ${line}`;
        }
      }
      return { kind: "list", items };
    }
    return { kind: "paragraph", text: chunkLines.join(" ") };
  });

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
          case "plain":
            return segment.text;
        }
      })}
    </>
  );
}

/**
 * Renders a unit note's raw markdown (plan 0006 note-rendering fix): the
 * `# ` line as a plain `<h2>` title, blank-line-separated paragraphs and `- `
 * bullet lists as `<p>`/`<ul><li>`, and within each, `*kyrgyz*` inline spans
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
      {blocks.map((block, index) =>
        block.kind === "list" ? (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineRun text={item} onTap={setTappedSpan} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <InlineRun text={block.text} onTap={setTappedSpan} />
          </p>
        ),
      )}
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
