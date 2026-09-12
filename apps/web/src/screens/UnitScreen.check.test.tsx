import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { UnitScreen } from "./UnitScreen";

/**
 * The unit Check (plan 0027 §12): its page in the trail, and the rules that
 * bind to `checkOnly` — a unit with questions but nothing to drill — rather
 * than to "the drill is empty", which a notes-only unit also has.
 */

const lexeme: Item = {
  id: "c-lex-a",
  kind: "lexeme",
  payload: { script: "суу", transliteration: "suu", gloss: "water" },
  sourceRef: "c-src",
};
const recallTask: Task = {
  id: "c-task-recall",
  type: "recall",
  itemIds: [lexeme.id],
};

function questionItem(id: string): Item {
  return {
    id,
    kind: "question",
    payload: {
      stem: "Which of these are architectural views?",
      options: [
        { text: "Bausteinsicht", correct: true },
        { text: "Dienstagssicht", correct: false },
      ],
    },
    sourceRef: "c-src",
  };
}

const mixedQuestion = questionItem("c-q-mixed");
const mixedChoiceTask: Task = {
  id: "c-task-choice-mixed",
  type: "choice",
  itemIds: [mixedQuestion.id],
};

// Overview + Vocabulary + Check: the mixed unit has both a drillable word
// and a question, so its drill is non-empty and the Check is not the only
// activity.
const mixedUnit: Unit = {
  id: "c-unit-mixed",
  lessonId: "c-lesson",
  title: "Mixed unit",
  goal: "Goal",
  itemIds: [lexeme.id, mixedQuestion.id],
  taskIds: [recallTask.id, mixedChoiceTask.id],
  noteIds: [],
};

const allQuestion = questionItem("c-q-all");
const allChoiceTask: Task = {
  id: "c-task-choice-all",
  type: "choice",
  itemIds: [allQuestion.id],
};

// Overview + Check only: every item is a question, so the drill is empty and
// the unit is checkOnly.
const allQuestionUnit: Unit = {
  id: "c-unit-all",
  lessonId: "c-lesson",
  title: "All-question unit",
  goal: "Goal",
  itemIds: [allQuestion.id],
  taskIds: [allChoiceTask.id],
  noteIds: [],
};

// Overview + Theory, no items and no Check: a notes-only unit's drill is
// also empty, but it must behave exactly as before this plan (regression).
const notesOnlyUnit: Unit = {
  id: "c-unit-notes",
  lessonId: "c-lesson",
  title: "Notes-only unit",
  goal: "Goal",
  itemIds: [],
  taskIds: [],
  noteIds: ["c-note-1"],
};

// A unit whose only Remember link points at the all-question unit — cross-
// unit recall has nothing to sample there, so the card must not render.
const linkingUnit: Unit = {
  id: "c-unit-link",
  lessonId: "c-lesson",
  title: "Linking unit",
  goal: "Goal",
  itemIds: [],
  taskIds: [],
  noteIds: [],
  recallUnitIds: [allQuestionUnit.id],
};

const content: Content = {
  exams: [],
  topic: {
    id: "c-topic",
    code: "c",
    domainId: "c-domain",
    title: "Book",
    description: "",
    lessonIds: ["c-lesson"],
  },
  lessons: [
    {
      id: "c-lesson",
      topicId: "c-topic",
      title: "Lesson",
      goal: "Goal",
      unitIds: [
        mixedUnit.id,
        allQuestionUnit.id,
        notesOnlyUnit.id,
        linkingUnit.id,
      ],
    },
  ],
  units: [mixedUnit, allQuestionUnit, notesOnlyUnit, linkingUnit],
  items: [lexeme, mixedQuestion, allQuestion],
  tasks: [recallTask, mixedChoiceTask, allChoiceTask],
  resources: [],
  notes: [{ id: "c-note-1", stem: "intro" }],
};

const domainContent: DomainContent = {
  domain: {
    id: "c-domain",
    code: "c",
    kind: "language",
    title: "Domain",
    glossLanguage: "en",
  },
  entries: [],
  families: [],
  linksByEntryId: new Map(),
};

const lookup: TapLookup = {
  domainContent,
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

function renderUnit(unitId: string, onPractice = vi.fn()) {
  render(
    <UnitScreen
      content={content}
      unitId={unitId}
      lookup={lookup}
      onPractice={onPractice}
      onCheck={() => {}}
      checkLevels={null}
      onRecall={() => {}}
      onPinNote={() => {}}
      isNotePinned={() => Promise.resolve(false)}
      onBack={() => {}}
      noteMarkdown={(stem) =>
        stem === "intro" ? "# Intro\n\nText." : undefined
      }
    />,
  );
  return onPractice;
}

const bar = () =>
  document.querySelector<HTMLButtonElement>(".unit-practice-button");
const practiceDot = () => document.querySelector(".dot.practice");
const activeDot = () => {
  const dots = [...document.querySelectorAll(".trail .dot:not(.practice)")];
  return dots.findIndex((dot) => dot.classList.contains("active"));
};
const arrowRight = () => fireEvent.keyDown(window, { key: "ArrowRight" });

afterEach(cleanup);

describe("the unit Check page (plan 0027 §12)", () => {
  it("a mixed unit shows the Check page last, and ArrowRight there starts Practice", () => {
    const onPractice = renderUnit(mixedUnit.id);

    // overview -> vocabulary -> check
    arrowRight();
    arrowRight();
    expect(activeDot()).toBe(2);
    expect(screen.getByText("Check")).toBeTruthy();
    expect(bar()?.textContent).toContain("Practice");

    arrowRight();
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it("an all-question unit's Check page has no bar, no practice dot, and ArrowRight does nothing", () => {
    const onPractice = renderUnit(allQuestionUnit.id);

    // overview -> check
    arrowRight();
    expect(activeDot()).toBe(1);
    expect(screen.getByText("Check")).toBeTruthy();
    expect(bar()).toBeNull();
    expect(practiceDot()).toBeNull();

    arrowRight();
    expect(activeDot()).toBe(1);
    expect(onPractice).not.toHaveBeenCalled();
  });

  it("a notes-only unit keeps its Practice bar and dot, and ArrowRight starts Practice", () => {
    const onPractice = renderUnit(notesOnlyUnit.id);

    expect(practiceDot()).not.toBeNull();
    // overview -> theory (last page)
    arrowRight();
    expect(bar()?.textContent).toContain("Practice");

    arrowRight();
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it("the Practice bar's count excludes check questions", () => {
    renderUnit(mixedUnit.id);

    arrowRight();
    arrowRight();
    expect(document.querySelector(".unit-practice-count")?.textContent).toBe(
      "1",
    );
  });

  it("does not render a Remember link to an all-question unit", () => {
    renderUnit(linkingUnit.id);

    expect(screen.queryByText(/Remember:/)).toBeNull();
  });
});
