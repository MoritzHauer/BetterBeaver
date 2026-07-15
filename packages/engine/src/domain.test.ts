import { describe, it, expect } from "vitest";
import type { Item, Link } from "@betterbeaver/schema";
import { symmetricLinks } from "./domain.js";

/** Lexeme fixture: id/script derive from `n`; `links` authored as given. */
function lexeme(n: number, links?: Link[]): Item {
  return {
    id: `t-entry-${n}`,
    kind: "lexeme",
    payload: {
      script: `скрипт${n}`,
      transliteration: `script${n}`,
      gloss: `gloss ${n}`,
      links,
    },
    sourceRef: "t-resource-1",
  };
}

describe("symmetricLinks", () => {
  it("derives the reverse direction for a one-side-authored link", () => {
    const entries = [
      lexeme(1, [{ type: "synonym", entryId: "t-entry-2" }]),
      lexeme(2),
    ];

    const map = symmetricLinks(entries);

    expect(map.get("t-entry-1")).toEqual([
      { type: "synonym", entryId: "t-entry-2" },
    ]);
    expect(map.get("t-entry-2")).toEqual([
      { type: "synonym", entryId: "t-entry-1" },
    ]);
  });

  it("returns no entry for an unlinked item", () => {
    const entries = [lexeme(1)];

    const map = symmetricLinks(entries);

    expect(map.get("t-entry-1")).toBeUndefined();
  });

  it("accumulates multiple links pointing at the same entry", () => {
    const entries = [
      lexeme(1, [{ type: "synonym", entryId: "t-entry-3" }]),
      lexeme(2, [{ type: "antonym", entryId: "t-entry-3" }]),
      lexeme(3),
    ];

    const map = symmetricLinks(entries);

    expect(map.get("t-entry-3")).toEqual(
      expect.arrayContaining([
        { type: "synonym", entryId: "t-entry-1" },
        { type: "antonym", entryId: "t-entry-2" },
      ]),
    );
    expect(map.get("t-entry-3")).toHaveLength(2);
  });
});
