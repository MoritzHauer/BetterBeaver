import { describe, it, expect } from "vitest";
import { validateContentSet } from "./documents.js";

describe("validateContentSet", () => {
  const kyrgyz = {
    id: "ky",
    code: "ky",
    entryIds: ["ky-lex-salam", "ky-lex-rakhmat"],
  };
  const demo = { id: "demo-domain", code: "demo", entryIds: ["demo-con-arch"] };

  it("accepts a set with distinct codes and item ids", () => {
    expect(
      validateContentSet(
        [
          // A book's validated pool includes its domain's entries — that
          // overlap is expected and must not count as a duplicate.
          {
            id: "kyrgyz",
            domainId: "ky",
            itemIds: ["ky-sent-1", "ky-lex-salam"],
          },
          { id: "demo", domainId: "demo-domain", itemIds: ["demo-con-arch"] },
        ],
        [kyrgyz, demo],
      ),
    ).toEqual([]);
  });

  it("reports duplicate domain codes", () => {
    expect(validateContentSet([], [kyrgyz, { ...demo, code: "ky" }])).toEqual([
      "ky: duplicate domain code id across the content set",
    ]);
  });

  it("reports an item id shared by two books", () => {
    const errors = validateContentSet(
      [
        { id: "a", domainId: "ky", itemIds: ["shared-sent"] },
        { id: "b", domainId: "ky", itemIds: ["shared-sent"] },
      ],
      [kyrgyz],
    );
    expect(errors).toEqual([
      "shared-sent: duplicate item id across the content set",
    ]);
  });

  it("reports a book-owned item colliding with another domain's entry", () => {
    const errors = validateContentSet(
      // The book belongs to ky, so demo's entry ids are NOT filtered from
      // its pool — a collision with them is a real global-SRS-key clash.
      [{ id: "kyrgyz", domainId: "ky", itemIds: ["demo-con-arch"] }],
      [kyrgyz, demo],
    );
    expect(errors).toEqual([
      "demo-con-arch: duplicate item id across the content set",
    ]);
  });
});
