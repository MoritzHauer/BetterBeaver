import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  AssignQuestion,
  ChoiceQuestion,
  DomainContent,
  Question,
} from "@betterbeaver/engine";
import type { Quality } from "@betterbeaver/srs";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";

/**
 * Session UI for the two authored-option question kinds (plan 0027 §5/§6):
 * `choice` (pick `selectCount` of N options) and `assign` (a label per row).
 * Both auto-grade the ordinary way (wrong -> quality 2, correct -> 4) and
 * then show the marked answer, each option's `why`, and the explanation.
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

const choiceQuestion: ChoiceQuestion = {
  kind: "choice",
  unitId: "t-item-choice-1",
  stem: "Which are true?",
  choices: ["A", "B", "C", "D", "E"],
  correctIndices: [0, 2, 4],
  selectCount: 3,
  whys: ["why-a", undefined, "why-c", undefined, undefined],
  explanation: "A, C and E are the true statements.",
  explanationGenerated: true,
};

const assignQuestion: AssignQuestion = {
  kind: "assign",
  unitId: "t-item-assign-1",
  stem: "Assign each row",
  rows: ["Row1", "Row2", "Row3"],
  labels: ["Richtig", "Falsch"],
  correctLabelIndex: [0, 1, 0],
  whys: [undefined, "why-row2", undefined],
  explanation: undefined,
  explanationGenerated: false,
};

function renderQuestion(
  question: Question,
  onGrade: (unitId: string, quality: Quality) => Promise<void> = () =>
    Promise.resolve(),
) {
  render(
    <SessionScreen
      title="Practice"
      questions={[question]}
      bookId="t-topic"
      lookup={lookup}
      onGrade={onGrade}
      onFinished={() => {}}
      onExit={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("choice question", () => {
  it("caps selection at selectCount and gates Check on it", () => {
    renderQuestion(choiceQuestion);
    const checkButton = screen.getByRole("button", { name: "Check" });

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(checkButton).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(checkButton).toHaveProperty("disabled", false);

    // A fourth tap (the cap, plan §4) is ignored: selected stays at 3, so
    // Check — gated on selected.length === selectCount — stays enabled
    // rather than falling out of sync.
    fireEvent.click(screen.getByRole("button", { name: "D" }));
    expect(checkButton).toHaveProperty("disabled", false);
  });

  it("grades the right combination as correct", async () => {
    const onGrade = vi.fn(() => Promise.resolve());
    renderQuestion(choiceQuestion, onGrade);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    fireEvent.click(screen.getByRole("button", { name: "E" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    await vi.waitFor(() => expect(onGrade).toHaveBeenCalled());
    expect(onGrade).toHaveBeenCalledWith("t-item-choice-1", 4);
  });

  it("grades a wrong combination as incorrect", async () => {
    const onGrade = vi.fn(() => Promise.resolve());
    renderQuestion(choiceQuestion, onGrade);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    fireEvent.click(screen.getByRole("button", { name: "D" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    await vi.waitFor(() => expect(onGrade).toHaveBeenCalled());
    expect(onGrade).toHaveBeenCalledWith("t-item-choice-1", 2);
  });

  it("shows the whys and the explanation once checked", async () => {
    renderQuestion(choiceQuestion);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    fireEvent.click(screen.getByRole("button", { name: "E" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    await screen.findByText("why-a");
    expect(screen.getByText("why-c")).not.toBeNull();
    expect(
      screen.getByText("A, C and E are the true statements."),
    ).not.toBeNull();
  });

  it("shows the generated badge when explanationGenerated is true", async () => {
    renderQuestion(choiceQuestion);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    fireEvent.click(screen.getByRole("button", { name: "E" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(await screen.findByText("KI-generiert")).not.toBeNull();
  });

  it("hides the badge when explanationGenerated is false", async () => {
    renderQuestion({ ...choiceQuestion, explanationGenerated: false });

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    fireEvent.click(screen.getByRole("button", { name: "E" }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    await screen.findByText("A, C and E are the true statements.");
    expect(screen.queryByText("KI-generiert")).toBeNull();
  });
});

describe("assign question", () => {
  it("gates Check on every row being picked, then grades and shows the miss", async () => {
    const onGrade = vi.fn(() => Promise.resolve());
    renderQuestion(assignQuestion, onGrade);
    const checkButton = screen.getByRole("button", { name: "Check" });
    const richtigButtons = screen.getAllByRole("button", { name: "Richtig" });
    const falschButtons = screen.getAllByRole("button", { name: "Falsch" });

    expect(checkButton).toHaveProperty("disabled", true);

    // Row1 -> Richtig (correct), Row2 -> Richtig (wrong, correct is Falsch),
    // Row3 -> Falsch (wrong, correct is Richtig): one right, two wrong, so
    // the overall answer grades incorrect regardless of the partial credit
    // the exam scorer would give — practice never gives partial credit.
    fireEvent.click(richtigButtons[0]!);
    expect(checkButton).toHaveProperty("disabled", true);
    fireEvent.click(richtigButtons[1]!);
    expect(checkButton).toHaveProperty("disabled", true);
    fireEvent.click(falschButtons[2]!);
    expect(checkButton).toHaveProperty("disabled", false);

    fireEvent.click(checkButton);

    await vi.waitFor(() => expect(onGrade).toHaveBeenCalled());
    expect(onGrade).toHaveBeenCalledWith("t-item-assign-1", 2);
    expect(screen.getByText("Answer: Falsch")).not.toBeNull();
    expect(screen.getByText("Answer: Richtig")).not.toBeNull();
    expect(screen.getByText("why-row2")).not.toBeNull();
  });
});
