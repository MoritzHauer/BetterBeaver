import { describe, it, expect } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import { buildTaskSession, buildReviewSession, type Rng } from "./session.js";

/** Returns an Rng that yields the given values in order; throws if exhausted. */
function queueRng(values: number[]): Rng {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (value === undefined) {
      throw new Error("queueRng exhausted");
    }
    return value;
  };
}

const c1: Item = {
  id: "t-item-c1",
  kind: "concept",
  payload: { term: "Term 1", definition: "Definition 1" },
  sourceRef: "t-resource-1",
};
const c2: Item = {
  id: "t-item-c2",
  kind: "concept",
  payload: { term: "Term 2", definition: "Definition 2" },
  sourceRef: "t-resource-1",
};
const c3: Item = {
  id: "t-item-c3",
  kind: "concept",
  payload: { term: "Term 3", definition: "Definition 3" },
  sourceRef: "t-resource-1",
};
const c4: Item = {
  id: "t-item-c4",
  kind: "concept",
  payload: { term: "Term 4", definition: "Definition 4" },
  sourceRef: "t-resource-1",
};

const recognizeTask: Task = {
  id: "t-task-recognize",
  type: "recognize",
  itemIds: [c1.id, c2.id],
};

const conceptUnit: Unit = {
  id: "t-unit-concepts",
  topicId: "t-topic",
  title: "Concepts",
  goal: "Goal",
  itemIds: [c1.id, c2.id, c3.id, c4.id],
  taskIds: [recognizeTask.id],
  noteIds: [],
};

const conceptContent: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    title: "Topic",
    description: "",
    unitIds: [conceptUnit.id],
  },
  units: [conceptUnit],
  items: [c1, c2, c3, c4],
  tasks: [recognizeTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: recognize", () => {
  it("matches the pinned shuffle-and-insert algorithm exactly", () => {
    // For each item, candidates are the other 3 concept items of the unit
    // (in unit.itemIds order), shuffled via Fisher-Yates (i=2 downto 1),
    // then the correct item's text is spliced in at a scripted index.
    //
    // Question 1 (item c1): candidates = [c2, c3, c4].
    //   i=2: j = floor(0.9 * 3) = 2 -> swap(2,2): no-op -> [c2, c3, c4]
    //   i=1: j = floor(0.1 * 2) = 0 -> swap(1,0): [c3, c2, c4]
    //   distractor texts = [Definition 3, Definition 2, Definition 4]
    //   correctIndex = floor(0.5 * 4) = 2 -> insert "Definition 1" at index 2
    //   choices = [Definition 3, Definition 2, Definition 1, Definition 4]
    //
    // Question 2 (item c2): candidates = [c1, c3, c4].
    //   i=2: j = floor(0.9 * 3) = 2 -> swap(2,2): no-op -> [c1, c3, c4]
    //   i=1: j = floor(0.1 * 2) = 0 -> swap(1,0): [c3, c1, c4]
    //   distractor texts = [Definition 3, Definition 1, Definition 4]
    //   correctIndex = floor(0.5 * 4) = 2 -> insert "Definition 2" at index 2
    //   choices = [Definition 3, Definition 1, Definition 2, Definition 4]
    const rng = queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5]);

    const questions = buildTaskSession(recognizeTask, conceptContent, rng);

    expect(questions).toEqual([
      {
        kind: "recognize",
        itemId: c1.id,
        prompt: "Term 1",
        choices: [
          "Definition 3",
          "Definition 2",
          "Definition 1",
          "Definition 4",
        ],
        correctIndex: 2,
      },
      {
        kind: "recognize",
        itemId: c2.id,
        prompt: "Term 2",
        choices: [
          "Definition 3",
          "Definition 1",
          "Definition 2",
          "Definition 4",
        ],
        correctIndex: 2,
      },
    ]);
  });

  it("distractors are never the correct text and are drawn from the same kind/unit", () => {
    const rng = queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5]);
    const questions = buildTaskSession(recognizeTask, conceptContent, rng);
    const sameUnitConceptTexts = new Set([
      c1.payload.definition,
      c2.payload.definition,
      c3.payload.definition,
      c4.payload.definition,
    ]);

    for (const question of questions) {
      if (question.kind !== "recognize") {
        throw new Error("expected a recognize question");
      }
      const correctText = question.choices[question.correctIndex];
      question.choices.forEach((choice, index) => {
        expect(sameUnitConceptTexts.has(choice)).toBe(true);
        if (index !== question.correctIndex) {
          expect(choice).not.toBe(correctText);
        }
      });
    }
  });
});

const l1: Item = {
  id: "t-item-l1",
  kind: "lexeme",
  payload: { script: "Салам", transliteration: "Salam", gloss: "hello" },
  sourceRef: "t-resource-1",
};

const recallTask: Task = {
  id: "t-task-recall",
  type: "recall",
  itemIds: [l1.id],
};

const lexemeUnit: Unit = {
  id: "t-unit-lexemes",
  topicId: "t-topic",
  title: "Lexemes",
  goal: "Goal",
  itemIds: [l1.id],
  taskIds: [recallTask.id],
  noteIds: [],
};

const lexemeContent: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    title: "Topic",
    description: "",
    unitIds: [lexemeUnit.id],
  },
  units: [lexemeUnit],
  items: [l1],
  tasks: [recallTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: recall", () => {
  it("prompt is the gloss, reveal is [script, transliteration], for a lexeme item", () => {
    const rng = queueRng([]);
    const questions = buildTaskSession(recallTask, lexemeContent, rng);

    expect(questions).toEqual([
      {
        kind: "recall",
        itemId: l1.id,
        prompt: "hello",
        reveal: ["Салам", "Salam"],
      },
    ]);
  });
});

const rl1: Item = {
  id: "t-item-rl1",
  kind: "lexeme",
  payload: { script: "Салам", transliteration: "Salam", gloss: "hello" },
  sourceRef: "t-resource-1",
};
const rl2: Item = {
  id: "t-item-rl2",
  kind: "lexeme",
  payload: { script: "Ооба", transliteration: "Ooba", gloss: "yes" },
  sourceRef: "t-resource-1",
};
const rl3: Item = {
  id: "t-item-rl3",
  kind: "lexeme",
  payload: { script: "Жок", transliteration: "Jok", gloss: "no" },
  sourceRef: "t-resource-1",
};
const rl4: Item = {
  id: "t-item-rl4",
  kind: "lexeme",
  payload: { script: "Рахмат", transliteration: "Rakhmat", gloss: "thanks" },
  sourceRef: "t-resource-1",
};

const recognizeLexemeTask: Task = {
  id: "t-task-recognize-lexeme",
  type: "recognize",
  itemIds: [rl1.id, rl2.id],
};

const lexemeRecognizeUnit: Unit = {
  id: "t-unit-lexemes-recognize",
  topicId: "t-topic",
  title: "Lexemes",
  goal: "Goal",
  itemIds: [rl1.id, rl2.id, rl3.id, rl4.id],
  taskIds: [recognizeLexemeTask.id],
  noteIds: [],
};

const lexemeRecognizeContent: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    title: "Topic",
    description: "",
    unitIds: [lexemeRecognizeUnit.id],
  },
  units: [lexemeRecognizeUnit],
  items: [rl1, rl2, rl3, rl4],
  tasks: [recognizeLexemeTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: recognize over lexeme items", () => {
  it("prompt is the script, choices are glosses", () => {
    const rng = queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5]);
    const questions = buildTaskSession(
      recognizeLexemeTask,
      lexemeRecognizeContent,
      rng,
    );
    const allGlosses = new Set([
      rl1.payload.gloss,
      rl2.payload.gloss,
      rl3.payload.gloss,
      rl4.payload.gloss,
    ]);

    expect(questions[0]?.prompt).toBe(rl1.payload.script);
    expect(questions[1]?.prompt).toBe(rl2.payload.script);

    for (const question of questions) {
      if (question.kind !== "recognize") {
        throw new Error("expected a recognize question");
      }
      expect(question.choices).toHaveLength(4);
      question.choices.forEach((choice) => {
        expect(allGlosses.has(choice)).toBe(true);
      });
    }
    expect(questions[0]).toMatchObject({
      choices: expect.arrayContaining([rl1.payload.gloss]),
    });
    expect(questions[1]).toMatchObject({
      choices: expect.arrayContaining([rl2.payload.gloss]),
    });
  });
});

describe("buildReviewSession", () => {
  it("always uses the recall presentation, regardless of item kind", () => {
    const questions = buildReviewSession([c1, l1]);

    expect(questions).toEqual([
      {
        kind: "recall",
        itemId: c1.id,
        prompt: "Term 1",
        reveal: ["Definition 1"],
      },
      {
        kind: "recall",
        itemId: l1.id,
        prompt: "hello",
        reveal: ["Салам", "Salam"],
      },
    ]);
  });
});
