import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type NoteBlock, parseNoteBlocks } from "@betterbeaver/engine";
import { NoteEditor } from "./NoteEditor";

// Indirection matters: Vite's dev-server plugin rewrites a literal
// `new URL("...", import.meta.url)` into an `@fs/...` asset URL, which
// `fileURLToPath` then rejects ("must be of scheme file"). Reading
// `import.meta.url` into a variable first keeps this a plain path
// resolution — see apps/web/src/content/noteIcons.test.ts for the same fix.
const here = import.meta.url;
const HOW_TO_STUDY = fileURLToPath(
  new URL("../../../../content/demo/notes/how-to-study.md", here),
);

afterEach(() => {
  cleanup();
});

/**
 * `NoteEditor` is controlled (spec 0021-1 §3: markdown in, markdown out, no
 * internal blocks state) — this harness plays the role `BookEditor` plays
 * in the app, feeding each `onChange` back in as the next `markdown` prop
 * so edits actually re-render, while a spy captures every value emitted so
 * assertions can read the final markdown without reaching into React state.
 */
function renderEditor(initial: string) {
  const onChange = vi.fn<(markdown: string) => void>();
  function Harness() {
    const [markdown, setMarkdown] = useState(initial);
    return (
      <NoteEditor
        markdown={markdown}
        onChange={(next) => {
          onChange(next);
          setMarkdown(next);
        }}
      />
    );
  }
  render(<Harness />);
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { onChange, last };
}

function tableBlock(md: string): NoteBlock & { kind: "table" } {
  const block = parseNoteBlocks(md).find((b) => b.kind === "table");
  if (block === undefined || block.kind !== "table") {
    throw new Error("expected a table block");
  }
  return block;
}

describe("NoteEditor", () => {
  it("typing in a paragraph emits markdown with only that paragraph changed", () => {
    const initial = "# T\n\nFirst paragraph.\n\nSecond paragraph.\n\n";
    const { last } = renderEditor(initial);

    const textareas = screen
      .getAllByRole("textbox")
      .filter((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement[];
    fireEvent.change(textareas[0]!, { target: { value: "Edited paragraph." } });

    expect(last()).toBe("# T\n\nEdited paragraph.\n\nSecond paragraph.\n\n");
  });

  it("B wraps the selection and leaves it covering the same text", () => {
    const initial = "# T\n\nHello world.\n\n";
    const { last } = renderEditor(initial);

    const textarea = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    textarea.setSelectionRange(0, 5); // "Hello"
    fireEvent.click(screen.getByRole("button", { name: "B" }));

    expect(last()).toBe("# T\n\n**Hello** world.\n\n");
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(7);
  });

  it("B with an empty selection inserts **** and puts the caret between the markers", () => {
    const initial = "# T\n\nHello.\n\n";
    const { last } = renderEditor(initial);

    const textarea = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    textarea.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "B" }));

    expect(last()).toBe("# T\n\n****Hello.\n\n");
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it("does not use a stale block array when a different block moves before B is pressed", () => {
    // Regression test for the focus ref: it must store coordinates, not a
    // closure over the `blocks` array captured at focus time, or a
    // structural change to a *different* block made after focusing (but
    // before pressing a toolbar button) would be silently undone by the
    // stale closure's own re-serialization.
    const initial = "# T\n\nAlpha.\n\nBeta.\n\nGamma.\n\n";
    const { last } = renderEditor(initial);

    const textareas = screen
      .getAllByRole("textbox")
      .filter((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement[];
    const alpha = textareas[0]!; // "Alpha."
    fireEvent.focus(alpha);
    alpha.setSelectionRange(0, 5); // "Alpha"

    // Move Gamma (the last block) up one — this swaps Gamma and Beta and
    // does not shift Alpha's index, so any breakage here is about staleness
    // of content, not index drift.
    const upButtons = screen.getAllByLabelText("Move up");
    fireEvent.click(upButtons[upButtons.length - 1]!);

    fireEvent.click(screen.getByRole("button", { name: "B" }));

    expect(last()).toBe("# T\n\n**Alpha**.\n\nGamma.\n\nBeta.\n\n");
  });

  it("move-up on a block reorders the serialized output", () => {
    const initial = "# T\n\nFirst.\n\nSecond.\n\n";
    const { last } = renderEditor(initial);

    const upButtons = screen.getAllByLabelText("Move up");
    fireEvent.click(upButtons[upButtons.length - 1]!); // "Second."'s move-up

    expect(last()).toBe("# T\n\nSecond.\n\nFirst.\n\n");
  });

  it("add row / add column / delete row keep a table rectangular and valid", () => {
    const initial = "# T\n\n| a | b |\n| --- | --- |\n| c | d |\n\n";
    const { last } = renderEditor(initial);

    fireEvent.click(screen.getByRole("button", { name: "+ row" }));
    fireEvent.click(screen.getByRole("button", { name: "+ column" }));
    const afterAdds = last();
    if (afterAdds === undefined) {
      throw new Error("expected onChange to have been called");
    }
    const addedTable = tableBlock(afterAdds);
    expect(new Set(addedTable.rows.map((r) => r.length)).size).toBe(1);
    expect(addedTable.rows).toHaveLength(3);
    expect(addedTable.rows[0]).toHaveLength(3);

    fireEvent.click(screen.getAllByRole("button", { name: "Delete row" })[0]!);
    const afterDelete = last();
    if (afterDelete === undefined) {
      throw new Error("expected onChange to have been called");
    }
    const finalTable = tableBlock(afterDelete);
    expect(finalTable.rows).toHaveLength(2);
    expect(new Set(finalTable.rows.map((r) => r.length)).size).toBe(1);
  });

  it("pads a ragged table on edit", () => {
    const initial = "# T\n\n| a | b | c |\n| --- | --- | --- |\n| d |\n\n";
    const { last } = renderEditor(initial);

    const cellInputs = screen
      .getAllByRole("textbox")
      .filter((el) => el.tagName === "INPUT") as HTMLInputElement[];
    const dInput = cellInputs.find((el) => el.value === "d");
    if (dInput === undefined) {
      throw new Error("expected to find the ragged row's single cell");
    }
    fireEvent.change(dInput, { target: { value: "d-edited" } });

    const next = last();
    if (next === undefined) {
      throw new Error("expected onChange to have been called");
    }
    const table = tableBlock(next);
    expect(table.rows[1]).toEqual(["d-edited", "", ""]);
  });

  it("adding a heading to a real note appends a block without touching the one before it", () => {
    // Regression test for the add-block seeding bug: an empty-text seed
    // either got absorbed as blank lines or had its `## `/`- ` marker
    // trimmed away and misclassified as a paragraph, so the button silently
    // did nothing (or worse, bled its marker into the previous block).
    // `how-to-study.md` is a real note, not a `\n\n`-ending fixture.
    const initial = readFileSync(HOW_TO_STUDY, "utf-8");
    const before = parseNoteBlocks(initial);
    const lastBefore = before[before.length - 1]!;
    const { last } = renderEditor(initial);

    fireEvent.click(screen.getByRole("button", { name: "+ H" }));

    const next = last();
    if (next === undefined) {
      throw new Error("expected onChange to have been called");
    }
    const after = parseNoteBlocks(next);
    expect(after).toHaveLength(before.length + 1);
    // Not `.toEqual(lastBefore)`: `raw` is allowed to grow trailing
    // newlines once this block stops being last (spec §1b-bis, "accepted,
    // not fixed") — only the structured content must survive untouched.
    expect(after[before.length - 1]).toMatchObject({
      kind: lastBefore.kind,
      text: (lastBefore as { text: string }).text,
    });
    expect(after[after.length - 1]!.kind).toBe("heading");
  });
});
