import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DomainContent, MatchingQuestion } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";

/**
 * The session title is context and each card says what it asks; a matching
 * board whose answers are definitions stacks instead of splitting the width.
 */

const lookup: TapLookup = {
  domainContent: {
    domain: {
      id: "t-domain",
      code: "t",
      kind: "language",
      title: "Domain",
      glossLanguage: "en",
    },
    entries: [],
    families: [],
    linksByEntryId: new Map(),
  } satisfies DomainContent,
  listStore: {
    getLists: () => Promise.resolve([]),
    saveList: () => Promise.resolve(),
    deleteList: () => Promise.resolve(),
  },
  userEntryStore: {
    getEntries: () => Promise.resolve([]),
    saveEntry: () => Promise.resolve(),
    deleteEntry: () => Promise.resolve(),
  },
};

function board(answers: string[]): MatchingQuestion {
  return {
    kind: "matching",
    prompts: answers.map((_, i) => ({ text: `Term ${i}`, unitId: `u${i}` })),
    answers: answers.map((text, i) => ({ text, unitId: `u${i}` })),
  };
}

function renderBoard(answers: string[]) {
  render(
    <SessionScreen
      title="Softwareintensive Systeme"
      questions={[board(answers)]}
      bookId="t-topic"
      lookup={lookup}
      onGrade={() => Promise.resolve()}
      onFinished={() => {}}
      onExit={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("session instruction and matching layout", () => {
  it("keeps the title and adds an instruction for the card", () => {
    renderBoard(["one", "two"]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Softwareintensive Systeme",
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Match the pairs",
    );
  });

  it("keeps two columns for gloss-length answers", () => {
    renderBoard(["one", "two"]);

    expect(document.querySelector(".matching-board.stacked")).toBeNull();
  });

  it("stacks the board when an answer is definition-length", () => {
    renderBoard([
      "one",
      "In ein Gerät eingebaute Software, die unter knappen Ressourcen steuert.",
    ]);

    expect(document.querySelector(".matching-board.stacked")).not.toBeNull();
    expect(document.querySelectorAll(".matching-terms > li")).toHaveLength(2);
  });
});
