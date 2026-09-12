import { describe, it, expect } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import {
  buildFixedSession,
  buildRecallSession,
  buildReviewSession,
  buildTaskSession,
  checkAssignAnswer,
  checkChoiceAnswer,
  checkTaskIds,
  drillItemIds,
  recallableTaskIds,
  type AssignQuestion,
  type ChoiceQuestion,
  type Rng,
} from "./session.js";
import { startDrill } from "./drill.js";

/** A seeded LCG, so "20 different seeds" is deterministic without a queue. */
function seededRng(seed: number): Rng {
  let state = seed + 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const choiceItem: Item = {
  id: "t-item-choice-1",
  kind: "question",
  payload: {
    stem: "Which are true?",
    options: [
      { text: "A", correct: true, why: "why-a" },
      { text: "B", correct: false },
      { text: "C", correct: true, why: "why-c" },
      { text: "D", correct: false },
      { text: "E", correct: true },
    ],
  },
  sourceRef: "t-resource-1",
};
const choiceTask: Task = {
  id: "t-task-choice-1",
  type: "choice",
  itemIds: [choiceItem.id],
};

const assignItem: Item = {
  id: "t-item-assign-1",
  kind: "question",
  payload: {
    stem: "Assign each row",
    options: [
      { text: "Row1", correct: true },
      { text: "Row2", correct: false },
      { text: "Row3", correct: true },
    ],
    labels: ["Richtig", "Falsch"],
  },
  sourceRef: "t-resource-1",
};
const assignTask: Task = {
  id: "t-task-assign-1",
  type: "assign",
  itemIds: [assignItem.id],
};

function contentWith(
  items: Item[],
  tasks: Task[],
  units: Unit[] = [],
): Content {
  return {
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [],
    },
    lessons: [],
    units,
    items,
    tasks,
    resources: [],
    notes: [],
    exams: [],
  };
}

describe("buildTaskSession: choice", () => {
  it("builds authored-order choices, correctIndices, selectCount and aligned whys", () => {
    const content = contentWith([choiceItem], [choiceTask]);
    const questions = buildTaskSession(choiceTask, content, seededRng(0));

    expect(questions).toEqual([
      {
        kind: "choice",
        unitId: choiceItem.id,
        stem: "Which are true?",
        choices: ["A", "B", "C", "D", "E"],
        correctIndices: [0, 2, 4],
        selectCount: 3,
        whys: ["why-a", undefined, "why-c", undefined, undefined],
        explanation: undefined,
        explanationGenerated: false,
      },
    ]);
  });

  it("checkChoiceAnswer is order-insensitive and rejects partial/extra selections", () => {
    const content = contentWith([choiceItem], [choiceTask]);
    const [question] = buildTaskSession(
      choiceTask,
      content,
      seededRng(0),
    ) as ChoiceQuestion[];

    expect(checkChoiceAnswer(question!, [4, 0, 2])).toBe(true);
    expect(checkChoiceAnswer(question!, [0, 2])).toBe(false);
    expect(checkChoiceAnswer(question!, [0, 1, 2])).toBe(false);
  });
});

describe("buildTaskSession: assign", () => {
  it("builds rows/labels/correctLabelIndex from the authored options", () => {
    const content = contentWith([assignItem], [assignTask]);
    const questions = buildTaskSession(assignTask, content, seededRng(0));

    expect(questions).toEqual([
      {
        kind: "assign",
        unitId: assignItem.id,
        stem: "Assign each row",
        rows: ["Row1", "Row2", "Row3"],
        labels: ["Richtig", "Falsch"],
        correctLabelIndex: [0, 1, 0],
        whys: [undefined, undefined, undefined],
        explanation: undefined,
        explanationGenerated: false,
      },
    ]);
  });

  it("checkAssignAnswer treats a null pick as wrong", () => {
    const content = contentWith([assignItem], [assignTask]);
    const [question] = buildTaskSession(
      assignTask,
      content,
      seededRng(0),
    ) as AssignQuestion[];

    expect(checkAssignAnswer(question!, [0, 1, 0])).toBe(true);
    expect(checkAssignAnswer(question!, [0, null, 0])).toBe(false);
  });
});

describe("explanationGenerated", () => {
  function itemWith(flags: {
    generated?: boolean;
    explanationGenerated?: boolean;
  }): Item {
    return {
      id: "t-item-flags",
      kind: "question",
      payload: {
        stem: "Which are true?",
        options: [
          { text: "A", correct: true },
          { text: "B", correct: false },
        ],
        ...flags,
      },
      sourceRef: "t-resource-1",
    };
  }

  it("is true when `generated` is set", () => {
    const item = itemWith({ generated: true });
    const content = contentWith(
      [item],
      [{ id: "t-task-flags", type: "choice", itemIds: [item.id] }],
    );
    const [question] = buildTaskSession(
      content.tasks[0]!,
      content,
      seededRng(0),
    );
    expect(question).toMatchObject({ explanationGenerated: true });
  });

  it("is true when `explanationGenerated` is set", () => {
    const item = itemWith({ explanationGenerated: true });
    const content = contentWith(
      [item],
      [{ id: "t-task-flags", type: "choice", itemIds: [item.id] }],
    );
    const [question] = buildTaskSession(
      content.tasks[0]!,
      content,
      seededRng(0),
    );
    expect(question).toMatchObject({ explanationGenerated: true });
  });

  it("is false when neither flag is set", () => {
    const item = itemWith({});
    const content = contentWith(
      [item],
      [{ id: "t-task-flags", type: "choice", itemIds: [item.id] }],
    );
    const [question] = buildTaskSession(
      content.tasks[0]!,
      content,
      seededRng(0),
    );
    expect(question).toMatchObject({ explanationGenerated: false });
  });
});

describe("buildReviewSession: question units", () => {
  it("returns the item's choice/assign question, not the recall fallback", () => {
    const content = contentWith([choiceItem], [choiceTask]);
    const questions = buildReviewSession(
      [{ id: choiceItem.id, item: choiceItem }],
      content,
      seededRng(0),
    );
    expect(questions[0]!.kind).toBe("choice");

    const assignContent = contentWith([assignItem], [assignTask]);
    const assignQuestions = buildReviewSession(
      [{ id: assignItem.id, item: assignItem }],
      assignContent,
      seededRng(0),
    );
    expect(assignQuestions[0]!.kind).toBe("assign");
  });
});

describe("buildFixedSession", () => {
  it("preserves task order across two tasks and does not shuffle", () => {
    const itemA: Item = {
      id: "t-item-fixed-a",
      kind: "concept",
      payload: { term: "Term A", definition: "Def A" },
      sourceRef: "t-resource-1",
    };
    const itemB: Item = {
      id: "t-item-fixed-b",
      kind: "concept",
      payload: { term: "Term B", definition: "Def B" },
      sourceRef: "t-resource-1",
    };
    const taskA: Task = {
      id: "t-task-fixed-a",
      type: "recall",
      itemIds: [itemA.id],
    };
    const taskB: Task = {
      id: "t-task-fixed-b",
      type: "recall",
      itemIds: [itemB.id],
    };
    const content = contentWith([itemA, itemB], [taskA, taskB]);

    for (const seed of [0, 7, 13]) {
      const pairs = buildFixedSession(
        [taskB.id, taskA.id],
        content,
        seededRng(seed),
      );
      expect(pairs.map((p) => p.taskId)).toEqual([taskB.id, taskA.id]);
      expect(pairs.map((p) => p.question)).toEqual([
        {
          kind: "recall",
          unitId: itemB.id,
          prompt: "Term B",
          reveal: ["Def B"],
        },
        {
          kind: "recall",
          unitId: itemA.id,
          prompt: "Term A",
          reveal: ["Def A"],
        },
      ]);
    }
  });

  it("skips unknown task ids", () => {
    const item: Item = {
      id: "t-item-fixed-c",
      kind: "concept",
      payload: { term: "Term C", definition: "Def C" },
      sourceRef: "t-resource-1",
    };
    const task: Task = {
      id: "t-task-fixed-c",
      type: "recall",
      itemIds: [item.id],
    };
    const content = contentWith([item], [task]);

    const pairs = buildFixedSession(
      ["missing", task.id],
      content,
      seededRng(0),
    );
    expect(pairs.map((p) => p.taskId)).toEqual([task.id]);
  });
});

describe("drillItemIds", () => {
  const sentenceItem: Item = {
    id: "t-item-drill-sentence",
    kind: "sentence",
    payload: { text: "Мен китеп окуйм", translation: "I read a book" },
    sourceRef: "t-resource-1",
  };
  const scrambleTask: Task = {
    id: "t-task-drill-scramble",
    type: "scramble",
    itemIds: [sentenceItem.id],
  };
  const buildTask: Task = {
    id: "t-task-drill-build",
    type: "build",
    itemIds: [sentenceItem.id],
  };
  const matchingOnlyConcept: Item = {
    id: "t-item-drill-matching-only",
    kind: "concept",
    payload: { term: "MatchOnly", definition: "D" },
    sourceRef: "t-resource-1",
  };
  const matchingTask: Task = {
    id: "t-task-drill-matching",
    type: "matching",
    itemIds: [matchingOnlyConcept.id],
  };
  const recallConcept: Item = {
    id: "t-item-drill-recall",
    kind: "concept",
    payload: { term: "Recall", definition: "D" },
    sourceRef: "t-resource-1",
  };
  const recallTask: Task = {
    id: "t-task-drill-recall",
    type: "recall",
    itemIds: [recallConcept.id],
  };

  it("excludes a question item, a sentence with only scramble/build under a narrower allow-list, and keeps a concept with recall available", () => {
    const unit: Unit = {
      id: "t-unit-drill",
      lessonId: "t-topic",
      title: "Drill",
      goal: "Goal",
      itemIds: [
        choiceItem.id,
        sentenceItem.id,
        matchingOnlyConcept.id,
        recallConcept.id,
      ],
      taskIds: [
        choiceTask.id,
        scrambleTask.id,
        buildTask.id,
        matchingTask.id,
        recallTask.id,
      ],
      noteIds: [],
    };
    const content = contentWith(
      [choiceItem, sentenceItem, matchingOnlyConcept, recallConcept],
      [choiceTask, scrambleTask, buildTask, matchingTask, recallTask],
      [unit],
    );

    const result = drillItemIds(unit, content, [
      "matching",
      "recognize",
      "recall",
    ]);

    expect(result).toEqual([recallConcept.id]);
  });

  it('excludes a concept whose only exercise under allowed = ["matching"] is matching', () => {
    const unit: Unit = {
      id: "t-unit-drill-matching-only",
      lessonId: "t-topic",
      title: "Drill",
      goal: "Goal",
      itemIds: [matchingOnlyConcept.id],
      taskIds: [matchingTask.id],
      noteIds: [],
    };
    const content = contentWith([matchingOnlyConcept], [matchingTask], [unit]);

    expect(drillItemIds(unit, content, ["matching"])).toEqual([]);
  });
});

describe("drillItemIds feeding startDrill (plan 0027 §12, App.tsx step 6)", () => {
  it("a unit whose items include a question item starts a drill that never asks it", () => {
    const wordA: Item = {
      id: "t-item-drill-word-a",
      kind: "concept",
      payload: { term: "A", definition: "D" },
      sourceRef: "t-resource-1",
    };
    const wordB: Item = {
      id: "t-item-drill-word-b",
      kind: "concept",
      payload: { term: "B", definition: "D" },
      sourceRef: "t-resource-1",
    };
    const unit: Unit = {
      id: "t-unit-drill-mixed",
      lessonId: "t-topic",
      title: "Drill",
      goal: "Goal",
      itemIds: [wordA.id, wordB.id, choiceItem.id],
      taskIds: [choiceTask.id],
      noteIds: [],
    };
    const content = contentWith(
      [wordA, wordB, choiceItem],
      [choiceTask],
      [unit],
    );

    const ids = drillItemIds(unit, content);
    expect(ids).toEqual([wordA.id, wordB.id]);

    const repetitions = 3;
    const state = startDrill(ids, repetitions);
    // `remaining` is the count the App.tsx wiring hands the drill — it must
    // come from the non-question word count, not the unit's raw item count.
    expect(state.remaining).toBe(2 * repetitions);
    expect(state.queue.every((visit) => visit.unitId !== choiceItem.id)).toBe(
      true,
    );
  });
});

describe("buildRecallSession / recallableTaskIds: choice/assign tasks are never sampled", () => {
  const recallConcept: Item = {
    id: "t-item-recall-mix",
    kind: "concept",
    payload: { term: "Recall", definition: "D" },
    sourceRef: "t-resource-1",
  };
  const recallTask: Task = {
    id: "t-task-recall-mix",
    type: "recall",
    itemIds: [recallConcept.id],
  };
  const mixedUnit: Unit = {
    id: "t-unit-recall-mix",
    lessonId: "t-topic",
    title: "Mixed",
    goal: "Goal",
    itemIds: [choiceItem.id, recallConcept.id],
    taskIds: [choiceTask.id, recallTask.id],
    noteIds: [],
  };
  const mixedContent = contentWith(
    [choiceItem, recallConcept],
    [choiceTask, recallTask],
    [mixedUnit],
  );

  it("never returns a choice question, over 20 different rng seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const pairs = buildRecallSession(
        mixedUnit,
        mixedContent,
        seededRng(seed),
      );
      expect(pairs.some((p) => p.question.kind === "choice")).toBe(false);
    }
  });

  it("recallableTaskIds of an all-choice unit is []", () => {
    const allChoiceUnit: Unit = { ...mixedUnit, taskIds: [choiceTask.id] };
    expect(recallableTaskIds(allChoiceUnit, mixedContent)).toEqual([]);
  });

  it("recallableTaskIds of the mixed unit keeps only the recall task", () => {
    expect(recallableTaskIds(mixedUnit, mixedContent)).toEqual([recallTask.id]);
  });

  it("checkTaskIds of the mixed unit keeps only the choice task", () => {
    expect(checkTaskIds(mixedUnit, mixedContent)).toEqual([choiceTask.id]);
  });

  it("checkTaskIds of a unit with no choice/assign task is []", () => {
    const allRecallUnit: Unit = { ...mixedUnit, taskIds: [recallTask.id] };
    expect(checkTaskIds(allRecallUnit, mixedContent)).toEqual([]);
  });
});
