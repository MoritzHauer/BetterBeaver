import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type NoteBlock, parseNoteBlocks } from "@betterbeaver/engine";
import type { Domain, Item } from "@betterbeaver/schema";
import { NoteEditor, type LexiconAccess, type NoteAsset } from "./NoteEditor";

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
 * internal blocks state) — this harness plays the role the Theory page plays
 * in the app, feeding each `onChange` back in as the next `markdown` prop
 * so edits actually re-render, while a spy captures every value emitted so
 * assertions can read the final markdown without reaching into React state.
 */
function renderEditor(
  initial: string,
  options: {
    assets?: NoteAsset[];
    onUploadAsset?: (file: File) => Promise<void>;
    lexicon?: LexiconAccess;
  } = {},
) {
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
        assets={options.assets}
        onUploadAsset={options.onUploadAsset}
        lexicon={options.lexicon}
      />
    );
  }
  render(<Harness />);
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { onChange, last };
}

const testDomain: Domain = {
  id: "ky",
  code: "ky",
  kind: "language",
  title: "Kyrgyz",
  glossLanguage: "en",
};

const rahmatEntry: Item = {
  id: "ky-1",
  kind: "lexeme",
  sourceRef: "ky-book-1",
  payload: { script: "Рахмат", transliteration: "Rahmat", gloss: "thanks" },
};

const salamEntry: Item = {
  id: "ky-2",
  kind: "lexeme",
  sourceRef: "ky-book-1",
  payload: { script: "Салам", transliteration: "Salam", gloss: "hello" },
};

/** Builds a `LexiconAccess` for a test, `entries`/`onAddEntry` the only
 * things any given test varies. */
function lexiconAccess(
  entries: unknown[],
  onAddEntry?: (entry: Item) => void,
): LexiconAccess {
  return {
    entries,
    domain: testDomain,
    domainCode: "ky",
    sourceRef: "ky-book-1",
    onAddEntry,
  };
}

/** Selects `text` inside `textarea`, assuming it appears exactly once. */
function selectText(textarea: HTMLTextAreaElement, text: string) {
  const start = textarea.value.indexOf(text);
  if (start === -1) {
    throw new Error(`expected to find ${JSON.stringify(text)} in the note`);
  }
  fireEvent.focus(textarea);
  textarea.setSelectionRange(start, start + text.length);
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

describe("NoteEditor - callouts and figures (spec 0021-2)", () => {
  it("changing a callout's variant rewrites only that block", () => {
    const initial = "# T\n\nIntro.\n\n> [!note]\n> Body.\n\n";
    const { last } = renderEditor(initial);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "warning" },
    });

    expect(last()).toBe("# T\n\nIntro.\n\n> [!warning]\n> Body.\n\n");
  });

  it("+ image is disabled with assets = []", () => {
    renderEditor("# T\n\nBody.\n\n");

    const button = screen.getByRole("button", { name: "+ image" });

    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("picking an asset inserts a figure block with that stem and an empty caption — never a typed stem", () => {
    const asset: NoteAsset = {
      stem: "t-photo-1",
      name: "Lodge",
      url: "blob:mock-1",
    };
    const { last } = renderEditor("# T\n\nBody.\n\n", { assets: [asset] });

    fireEvent.click(screen.getByRole("button", { name: "+ image" }));
    fireEvent.click(screen.getByRole("button", { name: "Lodge" }));

    expect(last()).toBe("# T\n\nBody.\n\n[img:t-photo-1]\n\n");
  });

  it("the toolbar goes inert while a callout title is focused, instead of writing into another block", () => {
    // Regression test: a callout's title `<input>` registers no
    // `FocusTarget`, so without an explicit reset the toolbar stayed enabled
    // and spliced its markers into whichever block was focused *before* —
    // silently corrupting a block the author is not looking at.
    const initial = "# T\n\nIntro paragraph.\n\n> [!note] MyTitle\n> Body.\n\n";
    const { onChange } = renderEditor(initial);

    const paragraph = screen
      .getAllByRole("textbox")
      .find(
        (el) =>
          el.tagName === "TEXTAREA" &&
          (el as HTMLTextAreaElement).value === "Intro paragraph.",
      ) as HTMLTextAreaElement;
    fireEvent.focus(paragraph);
    paragraph.setSelectionRange(0, 5);

    fireEvent.focus(screen.getByPlaceholderText("Title (optional)"));

    const bold = screen.getByRole("button", { name: "B" });
    expect(bold.hasAttribute("disabled")).toBe(true);

    fireEvent.click(bold);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the toolbar goes inert while a figure caption is focused", () => {
    const initial = "# T\n\nIntro paragraph.\n\n[img:a-1] MyCaption\n\n";
    const { onChange } = renderEditor(initial, {
      assets: [{ stem: "a-1", name: "Photo", url: "blob:mock-1" }],
    });

    const paragraph = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
    fireEvent.focus(paragraph);
    paragraph.setSelectionRange(0, 5);

    fireEvent.focus(screen.getByPlaceholderText("Caption (optional)"));

    const bold = screen.getByRole("button", { name: "B" });
    expect(bold.hasAttribute("disabled")).toBe(true);

    fireEvent.click(bold);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NoteEditor - lexicon sheet (spec 0021-3)", () => {
  function paragraphTextarea() {
    return screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
  }

  it("Аү over a non-empty selection wraps and opens the sheet", () => {
    const initial = "# T\n\nСалам world.\n\n";
    const { last } = renderEditor(initial, {
      lexicon: lexiconAccess([]),
    });

    selectText(paragraphTextarea(), "Салам");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    expect(last()).toBe("# T\n\n*Салам* world.\n\n");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Аү over an empty selection wraps and opens nothing", () => {
    const initial = "# T\n\nHello.\n\n";
    const { last } = renderEditor(initial, {
      lexicon: lexiconAccess([]),
    });

    const textarea = paragraphTextarea();
    fireEvent.focus(textarea);
    textarea.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    expect(last()).toBe("# T\n\n**Hello.\n\n");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with lexicon absent, Аү still wraps and no sheet opens", () => {
    const initial = "# T\n\nСалам world.\n\n";
    const { last } = renderEditor(initial);

    selectText(paragraphTextarea(), "Салам");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    expect(last()).toBe("# T\n\n*Салам* world.\n\n");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("readout: exact match", () => {
    const initial = "# T\n\nРахмат.\n\n";
    renderEditor(initial, { lexicon: lexiconAccess([rahmatEntry]) });

    selectText(paragraphTextarea(), "Рахмат");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    expect(screen.getByText("✓ Рахмат · thanks")).toBeTruthy();
  });

  it("readout: prefix match, not exact — the case this slice exists for", () => {
    // `resolveToken` falls back to the longest entry >= 3 chars that
    // prefixes the token (lookup.ts:72): "Салам" prefixes "Саламдашуу", so
    // it binds there even though the author typed a different word.
    const initial = "# T\n\nСаламдашуу.\n\n";
    renderEditor(initial, { lexicon: lexiconAccess([salamEntry]) });

    selectText(paragraphTextarea(), "Саламдашуу");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    // Default normalizer: HTML collapses runs of whitespace, so asserting
    // the source's literal double space would pin something no reader can
    // see. What must not regress is the "not exact" wording itself — that
    // is the whole point of the slice.
    expect(
      screen.getByText("→ Салам · hello (prefix match, not exact)"),
    ).toBeTruthy();
  });

  it("readout: no match", () => {
    const initial = "# T\n\nBartholomew.\n\n";
    renderEditor(initial, { lexicon: lexiconAccess([]) });

    selectText(paragraphTextarea(), "Bartholomew");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    expect(screen.getByText("⚠ no entry for this word")).toBeTruthy();
  });

  it("a half-typed entry (missing gloss) is excluded from the pool and does not crash the readout", () => {
    const halfTyped = {
      id: "ky-3",
      kind: "lexeme",
      sourceRef: "ky-book-1",
      payload: { script: "Дос", transliteration: "Dos" },
    };
    const initial = "# T\n\nДос.\n\n";
    renderEditor(initial, { lexicon: lexiconAccess([halfTyped]) });

    selectText(paragraphTextarea(), "Дос");
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Аү" })),
    ).not.toThrow();

    expect(screen.getByText("⚠ no entry for this word")).toBeTruthy();
  });

  it("tapping a search row replaces the wrapped text with that entry's script and leaves the rest of the note byte-identical", () => {
    const initial = "# T\n\nСаламдашуу world.\n\n";
    const { last } = renderEditor(initial, {
      lexicon: lexiconAccess([salamEntry]),
    });

    selectText(paragraphTextarea(), "Саламдашуу");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    // Typed first, then tapped — proves the row tap works with the search
    // input focused (spec 0021-3 §3), which is also what makes the
    // deliberate absence of `blurToolbar` on that input a tested behaviour
    // rather than an unverified claim: focusing it must not clear the
    // `focusRef` the tap below depends on.
    fireEvent.change(screen.getByPlaceholderText("Search the lexicon…"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Салам · hello" }));

    expect(last()).toBe("# T\n\n*Салам* world.\n\n");
    expect(screen.getByText("✓ Салам · hello")).toBeTruthy();
  });

  it("with onAddEntry absent, the add row is present, disabled, and carries a reason", () => {
    const initial = "# T\n\nЖаңы.\n\n";
    renderEditor(initial, { lexicon: lexiconAccess([]) });

    selectText(paragraphTextarea(), "Жаңы");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));

    const addButton = screen.getByRole("button", {
      name: '⊕ add "Жаңы" as new',
    });
    expect(addButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/can't add lexicon entries/i)).toBeTruthy();
  });

  it("with onAddEntry present, submitting the form calls it with an id prefixed by domainCode", () => {
    const onAddEntry = vi.fn<(entry: Item) => void>();
    const initial = "# T\n\nЖаңы.\n\n";
    renderEditor(initial, { lexicon: lexiconAccess([], onAddEntry) });

    selectText(paragraphTextarea(), "Жаңы");
    fireEvent.click(screen.getByRole("button", { name: "Аү" }));
    fireEvent.click(
      screen.getByRole("button", { name: '⊕ add "Жаңы" as new' }),
    );

    fireEvent.change(screen.getByPlaceholderText("Transliteration"), {
      target: { value: "Zhany" },
    });
    fireEvent.change(screen.getByPlaceholderText("Gloss (meaning)"), {
      target: { value: "new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));

    expect(onAddEntry).toHaveBeenCalledTimes(1);
    const item = onAddEntry.mock.calls[0]![0];
    expect(item.id.startsWith("ky-")).toBe(true);
    // Proves `sourceRef` is actually wired through to `AddWordForm`, not
    // shadowed by its old hardcoded local (spec 0021-3 §4a/§4b).
    expect(item.sourceRef).toBe("ky-book-1");
  });
});
