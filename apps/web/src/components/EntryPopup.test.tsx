import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Item } from "@betterbeaver/schema";
import { EntryPopup } from "./EntryPopup";
import type { TapLookup } from "./TappableText";

/**
 * Plan 0023 §6's breakdown. The assertion that carries the design is the
 * dangling-link one: before this slice the popup guessed each part's target
 * with `resolveToken`, whose prefix matching silently resolves to a
 * *different* word (plan 0021 §6), so "not a button" is the whole point —
 * an unlinked part must navigate nowhere at all.
 */
const ROOT: Item = {
  id: "ky-oku",
  kind: "lexeme",
  sourceRef: "src",
  payload: { script: "оку", transliteration: "oku", gloss: "study" },
};

const WORD: Item = {
  id: "ky-okumushtuu",
  kind: "lexeme",
  sourceRef: "src",
  payload: {
    script: "окумуштуу",
    transliteration: "okumushtuu",
    gloss: "scholar",
    components: [
      { text: "оку", gloss: "study", entryId: "ky-oku" },
      { text: "муш", gloss: "agent noun", entryId: "ky-gone" },
      { text: "туу", gloss: "having" },
    ],
  },
};

function renderPopup(entries: Item[], entryId: string) {
  const lookup = {
    domainContent: {
      domain: { id: "ky", code: "ky", readAloudLang: "ky" },
      entries,
      families: [],
      linksByEntryId: new Map(),
    },
    listStore: {} as TapLookup["listStore"],
    userEntryStore: {} as TapLookup["userEntryStore"],
  } as unknown as TapLookup;
  return render(
    <EntryPopup
      token=""
      entryId={entryId}
      lookup={lookup}
      onClose={() => {}}
    />,
  );
}

describe("EntryPopup's morpheme breakdown", () => {
  afterEach(cleanup);

  it("renders every part's text and gloss, in reading order", () => {
    renderPopup([WORD, ROOT], WORD.id);
    const parts = document.querySelectorAll(".entry-breakdown .chip");
    expect([...parts].map((part) => part.textContent)).toEqual([
      "окуstudy",
      "мушagent noun",
      "тууhaving",
    ]);
  });

  it("opens the linked entry in place when a linked part is tapped", () => {
    renderPopup([WORD, ROOT], WORD.id);
    fireEvent.click(screen.getByRole("button", { name: "окуstudy" }));
    // The same local state swap the link chips use — the popup is now the
    // root's, gloss and all.
    expect(screen.getByRole("heading", { name: /оку/ })).toBeTruthy();
    expect(screen.getByText("study")).toBeTruthy();
  });

  it("leaves an unlinked part and a dangling entryId as inert text, not buttons", () => {
    renderPopup([WORD, ROOT], WORD.id);
    // `ky-gone` is not in the pool; `туу` names no entry at all. Neither may
    // fall back to a text match.
    expect(screen.queryByRole("button", { name: "мушagent noun" })).toBeNull();
    expect(screen.queryByRole("button", { name: "тууhaving" })).toBeNull();
    expect(screen.getByText("agent noun").closest("span")).toBeTruthy();
  });

  it("renders the same breakdown for a concept, with no language-specific code", () => {
    const cardio: Item = {
      id: "med-cardio",
      kind: "concept",
      sourceRef: "src",
      payload: { term: "cardio-", definition: "heart" },
    };
    const disease: Item = {
      id: "med-cardiomyopathy",
      kind: "concept",
      sourceRef: "src",
      payload: {
        term: "cardiomyopathy",
        definition: "disease of the heart muscle",
        components: [
          { text: "cardio", gloss: "heart", entryId: "med-cardio" },
          { text: "myo", gloss: "muscle" },
          { text: "pathy", gloss: "disease" },
        ],
      },
    };
    renderPopup([disease, cardio], disease.id);

    expect(document.querySelectorAll(".entry-breakdown .chip")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "cardioheart" }));
    expect(screen.getByRole("heading", { name: /cardio-/ })).toBeTruthy();
  });
});
