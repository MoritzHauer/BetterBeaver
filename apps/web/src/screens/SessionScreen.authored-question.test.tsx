import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChoiceQuestion, DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";

/**
 * Post-grade feedback on an authored question (plan 0027 §5): each option's
 * `why`, then the question's `explanation`, shown only once it is graded —
 * and the "KI-generiert" badge only when `explanationGenerated`.
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

function question(explanationGenerated: boolean): ChoiceQuestion {
  return {
    kind: "choice",
    unitId: "t-item-1",
    stem: "Which of these are architectural views?",
    choices: ["Bausteinsicht", "Dienstagssicht"],
    correctIndices: [0],
    selectCount: 1,
    whys: ["Shows the static structure.", undefined],
    explanation: "Bausteinsicht is one of the four+1 views.",
    explanationGenerated,
  };
}

function renderAndGrade(explanationGenerated: boolean) {
  render(
    <SessionScreen
      title="Practice"
      questions={[question(explanationGenerated)]}
      bookId="t-topic"
      lookup={lookup}
      onGrade={() => Promise.resolve()}
      onFinished={() => {}}
      onExit={() => {}}
    />,
  );
  fireEvent.click(screen.getByText("Bausteinsicht"));
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
}

afterEach(cleanup);

describe("authored-question feedback (plan 0027 §5)", () => {
  it("shows each option's why and the explanation once graded, with the badge for a generated explanation", () => {
    renderAndGrade(true);

    expect(screen.getByText("Shows the static structure.")).toBeTruthy();
    expect(document.querySelectorAll(".option-why")).toHaveLength(1);
    expect(
      screen.getByText("Bausteinsicht is one of the four+1 views."),
    ).toBeTruthy();
    expect(screen.getByText("KI-generiert")).toBeTruthy();
  });

  it("omits the badge for an expert-written explanation", () => {
    renderAndGrade(false);

    expect(
      screen.getByText("Bausteinsicht is one of the four+1 views."),
    ).toBeTruthy();
    expect(screen.queryByText("KI-generiert")).toBeNull();
  });
});
