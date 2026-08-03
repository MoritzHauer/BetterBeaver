import { describe, expect, it } from "vitest";
import { type BookDocument, type DomainDocument } from "@betterbeaver/schema";
import { assetReferences } from "./AssetsManager";

function emptyBook(overrides: Partial<BookDocument> = {}): BookDocument {
  return {
    topic: {},
    lessons: [],
    units: [],
    items: [],
    tasks: [],
    resources: [],
    notes: [],
    ...overrides,
  };
}

function emptyDomain(): DomainDocument {
  return { domain: {}, entries: [], families: [] };
}

describe("assetReferences", () => {
  it("returns a note's title when a note figure uses the stem (spec 0021-2 §2e)", () => {
    const book = emptyBook({
      notes: [
        {
          stem: "intro",
          markdown: "# How to study\n\n[img:dx-3f9a2c4b] A beaver lodge.\n",
        },
      ],
    });

    const refs = assetReferences(book, emptyDomain(), "dx-3f9a2c4b");

    expect(refs).toEqual(["How to study"]);
  });

  it("returns nothing for a stem no note figure uses", () => {
    const book = emptyBook({
      notes: [
        { stem: "intro", markdown: "# How to study\n\nNo figures here.\n" },
      ],
    });

    const refs = assetReferences(book, emptyDomain(), "dx-unused");

    expect(refs).toEqual([]);
  });
});
