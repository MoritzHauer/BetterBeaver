import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { UnitScreen } from "./UnitScreen";

/**
 * The trail's forward button and where a returning learner lands (owner
 * request, 2026-07-30): the bottom bar reads `Next` until the last content
 * page, where it becomes `Practice`; `startAtEnd` opens there directly, which
 * is how the practice session's back-swipe returns you to the page you left
 * from.
 */

const lexeme: Item = {
  id: "t-lex-a",
  kind: "lexeme",
  payload: { script: "суу", transliteration: "suu", gloss: "water" },
  sourceRef: "t-src",
};
const concept: Item = {
  id: "t-con-a",
  kind: "concept",
  payload: { term: "Dam", definition: "A wall of logs" },
  sourceRef: "t-src",
};
const task: Task = { id: "t-task-a", type: "recall", itemIds: [lexeme.id] };

// Overview + Vocabulary + Concepts: three pages, so there is a middle page
// where `Next` must NOT already read `Practice`.
const unit: Unit = {
  id: "t-unit-a",
  lessonId: "t-lesson-a",
  title: "Unit A",
  goal: "Goal",
  itemIds: [lexeme.id, concept.id],
  taskIds: [task.id],
  noteIds: [],
};

const content: Content = {
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
      unitIds: [unit.id],
    },
  ],
  units: [unit],
  items: [lexeme, concept],
  tasks: [task],
  resources: [],
  notes: [],
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

function renderUnit(onPractice: () => void, startAtEnd?: boolean) {
  return render(
    <UnitScreen
      content={content}
      unitId={unit.id}
      lookup={lookup}
      onPractice={onPractice}
      onRecall={() => {}}
      onPinNote={() => {}}
      isNotePinned={() => Promise.resolve(false)}
      onBack={() => {}}
      startAtEnd={startAtEnd}
    />,
  );
}

/** The bar's label, without the question count that rides along on Practice. */
function barLabel(): string {
  return (
    document.querySelector(".unit-practice-button span")?.textContent ?? ""
  );
}

/** Index of the lit trail dot, ignoring the Practice dot that follows them. */
function activeDot(): number {
  const dots = [...document.querySelectorAll(".trail .dot:not(.practice)")];
  return dots.findIndex((dot) => dot.classList.contains("active"));
}

// No `globals: true` in this project, so RTL's auto-cleanup never runs.
afterEach(cleanup);

describe("Unit trail's forward button", () => {
  it("reads Next until the last page, then Practice", () => {
    const onPractice = vi.fn();
    renderUnit(onPractice);

    const bar = () =>
      document.querySelector<HTMLButtonElement>(".unit-practice-button")!;

    expect(barLabel()).toBe("Next");
    fireEvent.click(bar());
    expect(activeDot()).toBe(1);
    expect(barLabel()).toBe("Next");

    fireEvent.click(bar());
    expect(activeDot()).toBe(2);
    expect(barLabel()).toBe("Practice");
    expect(onPractice).not.toHaveBeenCalled();

    fireEvent.click(bar());
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it("opens on the last page when startAtEnd is set", () => {
    renderUnit(vi.fn(), true);

    expect(barLabel()).toBe("Practice");
    expect(activeDot()).toBe(2);
  });
});
