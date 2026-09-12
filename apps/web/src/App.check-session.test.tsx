import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "./components/TappableText";
import { CheckSession } from "./App";

/**
 * The unit Check's "once per question, ever" grading rule (plan 0027 §12):
 * only a question at level 0 when the Check opens ever reaches the real
 * `bb.item.*` store, and a question already graded right in this sitting
 * must not be re-credited by a later "Retry the missed ones" run, even when
 * it reappears alongside a missed sibling on the same task.
 */

function questionItem(id: string, right: string, wrong: string): Item {
  return {
    id,
    kind: "question",
    payload: {
      stem: `Stem for ${id}`,
      options: [
        { text: right, correct: true },
        { text: wrong, correct: false },
      ],
    },
    sourceRef: "k-src",
  };
}

const lookup: TapLookup = {
  domainContent: {
    domain: {
      id: "k-domain",
      code: "k",
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

function makeContent(unit: Unit, items: Item[], tasks: Task[]): Content {
  return {
    exams: [],
    topic: {
      id: "k-topic",
      code: "k",
      domainId: "k-domain",
      title: "Book",
      description: "",
      lessonIds: ["k-lesson"],
    },
    lessons: [
      {
        id: "k-lesson",
        topicId: "k-topic",
        title: "Lesson",
        goal: "Goal",
        unitIds: [unit.id],
      },
    ],
    units: [unit],
    items,
    tasks,
    resources: [],
    notes: [],
  };
}

function seedLevel1(itemId: string): void {
  localStorage.setItem(
    `bb.item.${itemId}`,
    JSON.stringify({
      due: "2999-01-01T00:00:00.000Z",
      intervalDays: 1,
      ease: 2.5,
      reps: 1,
      levelDay: "2020-01-01",
    }),
  );
}

/** Selects the right or wrong option, Checks, then Continues. */
function answer(right: string, wrong: string, correct: boolean): void {
  fireEvent.click(screen.getByText(correct ? right : wrong));
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

afterEach(cleanup);

describe("CheckSession grading (plan 0027 §12)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes bb.item.* only for the question at level 0", async () => {
    const itemA = questionItem("k-item-a", "A-right", "A-wrong");
    const itemB = questionItem("k-item-b", "B-right", "B-wrong");
    const taskA: Task = { id: "k-task-a", type: "choice", itemIds: [itemA.id] };
    const taskB: Task = { id: "k-task-b", type: "choice", itemIds: [itemB.id] };
    const unit: Unit = {
      id: "k-unit-1",
      lessonId: "k-lesson",
      title: "Unit",
      goal: "Goal",
      itemIds: [itemA.id, itemB.id],
      taskIds: [taskA.id, taskB.id],
      noteIds: [],
    };
    seedLevel1(itemA.id);
    const before = localStorage.getItem(`bb.item.${itemA.id}`);

    render(
      <CheckSession
        content={makeContent(unit, [itemA, itemB], [taskA, taskB])}
        unit={unit}
        lookup={lookup}
        onDone={() => {}}
        onPractice={() => {}}
      />,
    );
    await screen.findByText(/Stem for/);

    answer("A-right", "A-wrong", true);
    answer("B-right", "B-wrong", true);

    // Grading is async (`recordGrade`'s several awaits): wait for it rather
    // than asserting the instant the click handlers return.
    await waitFor(() => {
      expect(localStorage.getItem(`bb.item.${itemB.id}`)).not.toBeNull();
    });
    // A was already level ≥ 1: the gate never lets the Check touch it again.
    expect(localStorage.getItem(`bb.item.${itemA.id}`)).toBe(before);
  });

  it("a retry writes nothing again for a question already answered right in the first run", async () => {
    const itemC = questionItem("k-item-c", "C-right", "C-wrong");
    const itemD = questionItem("k-item-d", "D-right", "D-wrong");
    // Both on ONE task, so retrying the task (missed because D was wrong)
    // re-asks C too — the case the mutation-on-correct-grade guard covers.
    const sharedTask: Task = {
      id: "k-task-cd",
      type: "choice",
      itemIds: [itemC.id, itemD.id],
    };
    const unit: Unit = {
      id: "k-unit-2",
      lessonId: "k-lesson",
      title: "Unit",
      goal: "Goal",
      itemIds: [itemC.id, itemD.id],
      taskIds: [sharedTask.id],
      noteIds: [],
    };

    render(
      <CheckSession
        content={makeContent(unit, [itemC, itemD], [sharedTask])}
        unit={unit}
        lookup={lookup}
        onDone={() => {}}
        onPractice={() => {}}
      />,
    );
    await screen.findByText(/Stem for/);

    // Run 1: C right, D wrong — D's miss puts the shared task in the retry set.
    answer("C-right", "C-wrong", true);
    answer("D-right", "D-wrong", false);

    await waitFor(() => {
      expect(localStorage.getItem(`bb.item.${itemC.id}`)).not.toBeNull();
      expect(localStorage.getItem(`bb.item.${itemD.id}`)).not.toBeNull();
    });
    const cAfterRun1 = localStorage.getItem(`bb.item.${itemC.id}`);
    const dAfterRun1 = localStorage.getItem(`bb.item.${itemD.id}`);

    fireEvent.click(
      screen.getByRole("button", { name: "Retry the missed ones" }),
    );
    await screen.findByText(/Stem for/);

    // Run 2 re-asks the whole task: both C and D reappear.
    answer("C-right", "C-wrong", true);
    answer("D-right", "D-wrong", true);

    // D was still eligible (never yet answered right): this write lands.
    // Waiting on it is also what proves the run has finished grading —
    // C's grade, triggered earlier in this same run, has settled by then.
    await waitFor(() => {
      expect(localStorage.getItem(`bb.item.${itemD.id}`)).not.toBe(dAfterRun1);
    });
    // C was already answered right once this sitting: no further write.
    expect(localStorage.getItem(`bb.item.${itemC.id}`)).toBe(cAfterRun1);
  });
});
