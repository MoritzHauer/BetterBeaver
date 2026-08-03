import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type NoteBlock,
  normalizeSeparators,
  parseNoteBlocks,
  renderNoteBlock,
  serializeNoteBlocks,
} from "./noteBlocks.js";

const HOW_TO_STUDY = fileURLToPath(
  new URL("../../../content/demo/notes/how-to-study.md", import.meta.url),
);
const MAKE_YOUR_OWN = fileURLToPath(
  new URL("../../../content/demo/notes/make-your-own.md", import.meta.url),
);

function roundTrips(md: string): void {
  expect(serializeNoteBlocks(parseNoteBlocks(md))).toBe(md);
}

describe("parseNoteBlocks / serializeNoteBlocks round-trip", () => {
  it("round-trips how-to-study.md", () => {
    roundTrips(readFileSync(HOW_TO_STUDY, "utf-8"));
  });

  it("round-trips make-your-own.md", () => {
    roundTrips(readFileSync(MAKE_YOUR_OWN, "utf-8"));
  });

  it("round-trips a wrapped list item", () => {
    roundTrips(
      "# T\n\n- first line of an item\n  its wrapped continuation\n- second item\n",
    );
  });

  it("round-trips a table with an alignment row", () => {
    roundTrips("# T\n\n| a | b |\n| --- | --- |\n| c | d |\n");
  });

  it("round-trips a `## ` heading sharing a chunk with its body", () => {
    roundTrips("# T\n\n## Heading\nBody line, no blank line above.\n");
  });

  it("round-trips trailing whitespace-only lines", () => {
    roundTrips("# T\n\nBody.\n   \n");
  });

  it("round-trips `\\n\\n\\n` between blocks", () => {
    roundTrips("# T\n\n\nBody after two blank lines.\n\n");
  });

  it("round-trips content before the first `# `", () => {
    roundTrips("Intro before the title.\n\n# T\n\nBody.\n\n");
  });

  it("round-trips a second `# ` line (falls through to paragraph)", () => {
    roundTrips("# T\n\nBody.\n\n# Not a title\n\nMore body.\n\n");
  });

  it("round-trips a document with no trailing newline", () => {
    roundTrips("# T\n\nBody.");
  });

  it("round-trips an empty string", () => {
    roundTrips("");
  });
});

function isParagraph(
  block: NoteBlock | undefined,
): block is NoteBlock & { kind: "paragraph" } {
  return block !== undefined && block.kind === "paragraph";
}

describe("editing a block leaves siblings' raw untouched", () => {
  it("re-serializes an edited paragraph without touching other blocks' raw", () => {
    const md = readFileSync(HOW_TO_STUDY, "utf-8");
    const blocks = parseNoteBlocks(md);
    const editIndex = blocks.findIndex((b) => b.kind === "paragraph");
    const original = blocks[editIndex];
    if (!isParagraph(original)) {
      throw new Error("fixture must contain a paragraph block");
    }

    const edited: NoteBlock = {
      ...original,
      text: "A completely new paragraph.",
    };
    const rendered: NoteBlock = { ...edited, raw: renderNoteBlock(edited) };
    const next = normalizeSeparators(
      blocks.map((b, i) => (i === editIndex ? rendered : b)),
    );

    blocks.forEach((block, i) => {
      if (i === editIndex) {
        return;
      }
      expect(next[i]?.raw).toBe(block.raw);
    });
    expect(next[editIndex]?.raw).toBe("A completely new paragraph.\n\n");
    expect(serializeNoteBlocks(next)).not.toBe(md);
  });
});

describe("separator normalization (§1b-bis)", () => {
  const md = "# T\n\nBody.";

  it("appending a block after a note with no trailing newline separates them", () => {
    const blocks = parseNoteBlocks(md);
    const appended: NoteBlock = {
      kind: "paragraph",
      text: "New paragraph",
      raw: renderNoteBlock({
        kind: "paragraph",
        text: "New paragraph",
        raw: "",
      }),
    };
    const next = normalizeSeparators([...blocks, appended]);
    const serialized = serializeNoteBlocks(next);
    expect(serialized).toBe("# T\n\nBody.\n\nNew paragraph\n\n");
    // Re-parsing must see title + two distinct body blocks, not a fused one.
    expect(parseNoteBlocks(serialized)).toHaveLength(3);
  });

  it("editing the last block twice is idempotent", () => {
    const blocks = parseNoteBlocks(md);
    const lastIndex = blocks.length - 1;
    if (!isParagraph(blocks[lastIndex])) {
      throw new Error("fixture's last block must be a paragraph");
    }

    const editOnce = (input: NoteBlock[]): NoteBlock[] =>
      normalizeSeparators(
        input.map((b, i) => {
          if (i !== lastIndex || !isParagraph(b)) {
            return b;
          }
          const edited = { ...b, text: "Body." };
          return { ...edited, raw: renderNoteBlock(edited) };
        }),
      );
    const once = editOnce(blocks);
    const twice = editOnce(once);
    expect(serializeNoteBlocks(twice)).toBe(serializeNoteBlocks(once));
  });
});

describe("add-block regression (a real note, not a fixture ending in \\n\\n)", () => {
  // `how-to-study.md`'s last block ends in a single `\n` — like every real
  // note, and unlike the `"# T\n\nBody."`-style fixtures above, which all
  // happen to end in `\n\n` and so never exercised `normalizeSeparators`'s
  // append branch. Mirrors `NoteEditor.addBlock`'s pipeline exactly:
  // render the fresh block, append, normalize, serialize, then re-parse —
  // the re-parse is what a mount of `NoteEditor` after `onChange` actually
  // does, and is what surfaces both bugs (a swallowed block, or a marker
  // that loses its trailing space to `trim()` and stops being recognized).
  const md = readFileSync(HOW_TO_STUDY, "utf-8");
  const original = parseNoteBlocks(md);
  const originalLastIndex = original.length - 1;
  const originalLast = original[originalLastIndex];
  if (!isParagraph(originalLast)) {
    throw new Error("fixture's last block must be a paragraph");
  }

  const freshBlocks: NoteBlock[] = [
    { kind: "paragraph", text: "New paragraph", raw: "" },
    { kind: "heading", text: "New heading", raw: "" },
    { kind: "list", items: ["New item"], raw: "" },
    { kind: "table", rows: [[""]], raw: "" },
  ];

  it("adding any of the four addable kinds increases the block count by 1 and leaves the previously-last block's text intact", () => {
    for (const fresh of freshBlocks) {
      const withRaw = [
        ...parseNoteBlocks(md),
        { ...fresh, raw: renderNoteBlock(fresh) },
      ];
      const serialized = serializeNoteBlocks(normalizeSeparators(withRaw));
      const reparsed = parseNoteBlocks(serialized);

      expect(reparsed).toHaveLength(original.length + 1);
      const stillLast = reparsed[originalLastIndex];
      expect(stillLast?.kind).toBe("paragraph");
      expect(isParagraph(stillLast) ? stillLast.text : undefined).toBe(
        originalLast.text,
      );
      expect(reparsed[originalLastIndex + 1]?.kind).toBe(fresh.kind);
    }
  });
});

describe("move regression (a real note, not a fixture ending in \\n\\n)", () => {
  function moveUp(blocks: NoteBlock[], index: number): NoteBlock[] {
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(index - 1, 0, item as NoteBlock);
    return normalizeSeparators(next);
  }

  it("moving the last block up twice keeps 5 blocks and doesn't merge any text", () => {
    const md = readFileSync(HOW_TO_STUDY, "utf-8");
    const blocks = parseNoteBlocks(md);
    expect(blocks).toHaveLength(5);

    const once = moveUp(blocks, blocks.length - 1);
    const twice = moveUp(once, blocks.length - 2);
    const reparsed = parseNoteBlocks(serializeNoteBlocks(twice));

    expect(reparsed).toHaveLength(5);
    // Every original block's text/items/rows shows up exactly once, on
    // some block of the reparsed document — nothing fused two blocks'
    // content into one.
    const reparsedTexts = reparsed.map((b) =>
      b.kind === "list"
        ? b.items.join("|")
        : b.kind === "table"
          ? JSON.stringify(b.rows)
          : b.text,
    );
    const originalTexts = blocks.map((b) =>
      b.kind === "list"
        ? b.items.join("|")
        : b.kind === "table"
          ? JSON.stringify(b.rows)
          : b.text,
    );
    expect(new Set(reparsedTexts)).toEqual(new Set(originalTexts));
  });
});

describe("classification", () => {
  it("classifies a fixture exercising all five kinds", () => {
    const md =
      "# Title\n\n## Heading\n\nA paragraph.\n\n- item one\n- item two\n\n| a | b |\n| --- | --- |\n| c | d |\n";
    const blocks = parseNoteBlocks(md);
    expect(blocks).toEqual([
      { kind: "title", text: "Title", raw: "# Title\n\n" },
      { kind: "heading", text: "Heading", raw: "## Heading\n\n" },
      { kind: "paragraph", text: "A paragraph.", raw: "A paragraph.\n\n" },
      {
        kind: "list",
        items: ["item one", "item two"],
        raw: "- item one\n- item two\n\n",
      },
      {
        kind: "table",
        rows: [
          ["a", "b"],
          ["c", "d"],
        ],
        raw: "| a | b |\n| --- | --- |\n| c | d |\n",
      },
    ]);
  });
});

describe("renderNoteBlock", () => {
  it("renders canonical output per kind", () => {
    expect(renderNoteBlock({ kind: "title", text: "T", raw: "" })).toBe(
      "# T\n\n",
    );
    expect(renderNoteBlock({ kind: "heading", text: "H", raw: "" })).toBe(
      "## H\n\n",
    );
    expect(renderNoteBlock({ kind: "paragraph", text: "P", raw: "" })).toBe(
      "P\n\n",
    );
    expect(renderNoteBlock({ kind: "list", items: ["a", "b"], raw: "" })).toBe(
      "- a\n- b\n\n",
    );
    expect(
      renderNoteBlock({
        kind: "table",
        rows: [
          ["a", "b"],
          ["c", "d"],
        ],
        raw: "",
      }),
    ).toBe("| a | b |\n| --- | --- |\n| c | d |\n\n");
  });
});
