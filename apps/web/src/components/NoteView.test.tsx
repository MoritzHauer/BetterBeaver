import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Item } from "@betterbeaver/schema";
import { NoteView } from "./NoteView";
import type { TapLookup } from "./TappableText";

// A figure's `getAssetUrl(bookId, "img", stem)` call (spec 0021-2 §2c) is
// stubbed rather than resolved against real bundled content, so a test
// controls resolving vs. dangling deterministically.
vi.mock("../content/bundled", () => ({
  getAssetUrl: (_bookId: string, _kind: string, stem: string) =>
    stem === "t-photo-resolves" ? "blob:mock-resolved-url" : undefined,
}));

// No global `afterEach(cleanup)` is wired (vitest.config.ts has no
// `test.globals`), so without this, renders across `it()`s in this file pile
// up in the same `document.body` — harmless until two tests' queries can
// both match, which the callout test below now can (`screen.getByRole`
// isn't scoped to its own render). Same fix NoteEditor.test.tsx already
// applies.
afterEach(() => {
  cleanup();
});

const entry: Item = {
  id: "t-item-salam",
  kind: "lexeme",
  sourceRef: "t-resource-manual",
  payload: { script: "Салам", gloss: "Hi", transliteration: "salam" },
};

/** Only `domainContent.entries` is read by the paths under test; the stores
 * are reached from the popup, which these cases never open. */
const lookup = {
  domainContent: {
    domain: { id: "t", code: "t", kind: "language", title: "T" },
    entries: [entry],
    families: [],
    linksByEntryId: new Map(),
  },
} as unknown as TapLookup;

describe("NoteView", () => {
  it("renders a pipe table, dropping the alignment row", () => {
    render(
      <NoteView
        markdown={
          "# T\n\n| Owner | Ending |\n| --- | --- |\n| Менин | -ым |\n| Сенин | -ың |"
        }
        lookup={lookup}
        bookId="t"
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("cell", { name: "-ың" })).toBeTruthy();
    expect(screen.queryByText("---")).toBeNull();
  });

  it("keeps a starred span in a table cell tappable", () => {
    render(
      <NoteView
        markdown={"# T\n\n| Word | Meaning |\n| --- | --- |\n| *Салам* | Hi |"}
        lookup={lookup}
        bookId="t"
      />,
    );

    expect(screen.getByRole("button", { name: "Салам" })).toBeTruthy();
  });

  it("splits a `## ` heading out of the chunk it shares with its body", () => {
    render(
      <NoteView
        markdown={"# T\n\n## Коштошуу\nBody line."}
        lookup={lookup}
        bookId="t"
      />,
    );

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "Коштошуу",
    );
    expect(screen.getByText("Body line.")).toBeTruthy();
  });

  it("renders `[icon:name]` as an app icon glyph", () => {
    const { container } = render(
      <NoteView
        markdown={"# T\n\nMountains [icon:yurt] here."}
        lookup={lookup}
        bookId="t"
      />,
    );

    const img = container.querySelector("img.icon-glyph");
    expect(img?.getAttribute("src")).toContain("art/icons/yurt.png");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("renders a callout's glyph, title, and a tappable body span (spec 0021-2 §1b)", () => {
    const { container } = render(
      <NoteView
        markdown={"# T\n\n> [!warning] Watch out\n> *Салам* is informal.\n\n"}
        lookup={lookup}
        bookId="t"
      />,
    );

    const aside = container.querySelector("aside.note-callout.warning");
    expect(aside).toBeTruthy();
    expect(aside?.querySelector("strong")?.textContent).toBe("Watch out");
    const glyph = aside?.querySelector("img.icon-glyph");
    expect(glyph?.getAttribute("src")).toContain("art/icons/stop_sign.png");
    expect(screen.getByRole("button", { name: "Салам" })).toBeTruthy();
  });

  it("renders a figure as a `<figure>`/`<figcaption>`", () => {
    const { container } = render(
      <NoteView
        markdown={"# T\n\n[img:t-photo-resolves] A beaver lodge.\n\n"}
        lookup={lookup}
        bookId="t"
      />,
    );

    const figure = container.querySelector("figure.note-figure");
    expect(figure).toBeTruthy();
    expect(figure?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:mock-resolved-url",
    );
    expect(figure?.querySelector("figcaption")?.textContent).toBe(
      "A beaver lodge.",
    );
  });

  it("renders only the caption, no `<img>`, for an unresolvable figure stem", () => {
    const { container } = render(
      <NoteView
        markdown={"# T\n\n[img:t-photo-missing] Gone.\n\n"}
        lookup={lookup}
        bookId="t"
      />,
    );

    const figure = container.querySelector("figure.note-figure");
    expect(figure?.querySelector("img")).toBeNull();
    expect(figure?.querySelector("figcaption")?.textContent).toBe("Gone.");
  });
});
