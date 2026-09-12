import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { UnitScreen } from "./UnitScreen";

/**
 * The unit Check page (plan 0027 §12): last in the trail whenever the unit
 * has a `choice`/`assign` task, the trail's forward button and practice dot
 * both respect an empty drill there, and the Practice bar's count leaves
 * Check questions out.
 */

const concept: Item = {
  id: "t-con-a",
  kind: "concept",
  payload: { term: "Dam", definition: "A wall of logs" },
  sourceRef: "t-src",
};
const recallTask: Task = {
  id: "t-task-recall",
  type: "recall",
  itemIds: [concept.id],
};

const choiceItem: Item = {
  id: "t-item-choice",
  kind: "question",
  payload: {
    stem: "Which are true?",
    options: [
      { text: "A", correct: true },
      { text: "B", correct: false },
    ],
  },
  sourceRef: "t-src",
};
const choiceTask: Task = {
  id: "t-task-choice",
  type: "choice",
  itemIds: [choiceItem.id],
};

const domainContent: DomainContent = {
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

function contentWith(units: Unit[], items: Item[], tasks: Task[]): Content {
  return {
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t-domain",
      title: "Book",
      description: "",
      lessonIds: ["t-lesson-a"],
    },
    lessons: [
      {
        id: "t-lesson-a",
        topicId: "t-topic",
        title: "Lesson",
        goal: "Goal",
        unitIds: units.map((u) => u.id),
      },
    ],
    units,
    items,
    tasks,
    resources: [],
    notes: [],
    exams: [],
  };
}

function renderUnit(
  content: Content,
  unitId: string,
  onPractice: () => void,
  onCheck: () => void = () => {},
) {
  return render(
    <UnitScreen
      content={content}
      unitId={unitId}
      lookup={lookup}
      onPractice={onPractice}
      onCheck={onCheck}
      checkLevels={null}
      onRecall={() => {}}
      onPinNote={() => {}}
      isNotePinned={() => Promise.resolve(false)}
      onBack={() => {}}
    />,
  );
}

/** Index of the lit trail dot, ignoring the Practice dot that follows them. */
function activeDot(): number {
  const dots = [...document.querySelectorAll(".trail .dot:not(.practice)")];
  return dots.findIndex((dot) => dot.classList.contains("active"));
}

function goToLastPage() {
  const dots = document.querySelectorAll(".trail .dot:not(.practice)");
  fireEvent.click(dots[dots.length - 1]!);
}

// No `globals: true` in this project, so RTL's auto-cleanup never runs.
afterEach(cleanup);

describe("Unit Check page", () => {
  it("shows a Check page last, and ArrowRight there starts Practice", () => {
    const unit: Unit = {
      id: "t-unit-mixed",
      lessonId: "t-lesson-a",
      title: "Unit",
      goal: "Goal",
      itemIds: [concept.id, choiceItem.id],
      taskIds: [recallTask.id, choiceTask.id],
      noteIds: [],
    };
    const content = contentWith(
      [unit],
      [concept, choiceItem],
      [recallTask, choiceTask],
    );
    const onPractice = vi.fn();
    renderUnit(content, unit.id, onPractice);

    goToLastPage();
    expect(document.querySelector(".eyebrow")?.textContent).toContain("Check");
    expect(activeDot()).toBe(
      document.querySelectorAll(".trail .dot:not(.practice)").length - 1,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it("an all-question unit's Check page has no bar, no practice dot, and ArrowRight does nothing", () => {
    const unit: Unit = {
      id: "t-unit-all-question",
      lessonId: "t-lesson-a",
      title: "Unit",
      goal: "Goal",
      itemIds: [choiceItem.id],
      taskIds: [choiceTask.id],
      noteIds: [],
    };
    const content = contentWith([unit], [choiceItem], [choiceTask]);
    const onPractice = vi.fn();
    renderUnit(content, unit.id, onPractice);

    // Overview, then Check — the drill has nothing (no non-question items),
    // so once there the bar and practice dot are both gone.
    goToLastPage();
    expect(document.querySelector(".eyebrow")?.textContent).toContain("Check");
    expect(document.querySelector(".dot.practice")).toBeNull();
    expect(document.querySelector(".unit-practice-bar")).toBeNull();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onPractice).not.toHaveBeenCalled();
  });

  it("a notes-only unit (empty drill, no Check) keeps Practice on its last page", () => {
    // Regression (code review, 2026-09-11): the empty-drill rules must bind
    // only when a Check page ends the trail. A unit with no words and no
    // questions has an empty drill too, and Practice — whose summary offers
    // "Next unit" — is its only way forward.
    const unit: Unit = {
      id: "t-unit-notes-only",
      lessonId: "t-lesson-a",
      title: "Unit",
      goal: "Goal",
      itemIds: [],
      taskIds: [],
      noteIds: [],
    };
    const content = contentWith([unit], [], []);
    const onPractice = vi.fn();
    renderUnit(content, unit.id, onPractice);

    goToLastPage();
    expect(document.querySelector(".dot.practice")).not.toBeNull();
    expect(document.querySelector(".unit-practice-bar")).not.toBeNull();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it("a Remember link to an all-question unit is not rendered", () => {
    const linkedUnit: Unit = {
      id: "t-unit-linked-all-question",
      lessonId: "t-lesson-a",
      title: "Linked",
      goal: "Goal",
      itemIds: [choiceItem.id],
      taskIds: [choiceTask.id],
      noteIds: [],
    };
    const unit: Unit = {
      id: "t-unit-with-link",
      lessonId: "t-lesson-a",
      title: "Unit",
      goal: "Goal",
      itemIds: [concept.id],
      taskIds: [recallTask.id],
      noteIds: [],
      recallUnitIds: [linkedUnit.id],
    };
    const content = contentWith(
      [unit, linkedUnit],
      [concept, choiceItem],
      [recallTask, choiceTask],
    );
    renderUnit(content, unit.id, () => {});

    expect(document.querySelector(".card.recall")).toBeNull();
  });

  it("the Practice bar count excludes check questions", () => {
    const unit: Unit = {
      id: "t-unit-mixed-count",
      lessonId: "t-lesson-a",
      title: "Unit",
      goal: "Goal",
      itemIds: [concept.id, choiceItem.id],
      taskIds: [recallTask.id, choiceTask.id],
      noteIds: [],
    };
    const content = contentWith(
      [unit],
      [concept, choiceItem],
      [recallTask, choiceTask],
    );
    renderUnit(content, unit.id, () => {});

    goToLastPage();
    // One recall item, no check questions counted in the bar.
    expect(document.querySelector(".unit-practice-count")?.textContent).toBe(
      "1",
    );
  });
});
