import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Item } from "@betterbeaver/schema";
import { NoteView } from "./NoteView";
import type { TapLookup } from "./TappableText";

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
      />,
    );

    expect(screen.getByRole("button", { name: "Салам" })).toBeTruthy();
  });

  it("splits a `## ` heading out of the chunk it shares with its body", () => {
    render(
      <NoteView markdown={"# T\n\n## Коштошуу\nBody line."} lookup={lookup} />,
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
      />,
    );

    const img = container.querySelector("img.icon-glyph");
    expect(img?.getAttribute("src")).toContain("art/icons/yurt.png");
    expect(img?.getAttribute("alt")).toBe("");
  });
});
