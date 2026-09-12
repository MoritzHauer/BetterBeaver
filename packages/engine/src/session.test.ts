import { describe, it, expect } from "vitest";
import type { Content, Exercise, Item, Task, Unit } from "@betterbeaver/schema";
import {
  buildTaskSession,
  buildReviewSession,
  buildUnitSession,
  buildRecallSession,
  buildFixedSession,
  checkTaskIds,
  drillItemIds,
  recallableTaskIds,
  shuffle,
  checkScrambleAnswer,
  checkMatchingPair,
  checkAssignAnswer,
  checkChoiceAnswer,
  matchingOutcomes,
  countUnitQuestions,
  type AssignQuestion,
  type ChoiceQuestion,
  type MatchingQuestion,
  type Question,
  type Rng,
} from "./session.js";
import { noteUnitId } from "./units.js";

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
  lessonId: "t-topic",
  title: "Concepts",
  goal: "Goal",
  itemIds: [c1.id, c2.id, c3.id, c4.id],
  taskIds: [recognizeTask.id],
  noteIds: [],
};

const conceptContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [conceptUnit.id],
  },
  lessons: [],
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
        unitId: c1.id,
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
        unitId: c2.id,
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
  lessonId: "t-topic",
  title: "Lexemes",
  goal: "Goal",
  itemIds: [l1.id],
  taskIds: [recallTask.id],
  noteIds: [],
};

const lexemeContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [lexemeUnit.id],
  },
  lessons: [],
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
        unitId: l1.id,
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
  lessonId: "t-topic",
  title: "Lexemes",
  goal: "Goal",
  itemIds: [rl1.id, rl2.id, rl3.id, rl4.id],
  taskIds: [recognizeLexemeTask.id],
  noteIds: [],
};

const lexemeRecognizeContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [lexemeRecognizeUnit.id],
  },
  lessons: [],
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

    const prompts = ["", ""];
    for (const [index, question] of questions.entries()) {
      if (question.kind !== "recognize") {
        throw new Error("expected a recognize question");
      }
      prompts[index] = question.prompt;
      expect(question.choices).toHaveLength(4);
      question.choices.forEach((choice) => {
        expect(allGlosses.has(choice)).toBe(true);
      });
    }
    expect(prompts[0]).toBe(rl1.payload.script);
    expect(prompts[1]).toBe(rl2.payload.script);
    expect(questions[0]).toMatchObject({
      choices: expect.arrayContaining([rl1.payload.gloss]),
    });
    expect(questions[1]).toMatchObject({
      choices: expect.arrayContaining([rl2.payload.gloss]),
    });
  });
});

const clozeSentence1: Item = {
  id: "t-item-cloze-1",
  kind: "sentence",
  payload: {
    text: "The {{c2::mat}} holds the {{c1::cat}}.",
    translation: "translation",
  },
  sourceRef: "t-resource-1",
};
const clozeSentence2: Item = {
  id: "t-item-cloze-2",
  kind: "sentence",
  payload: { text: "Only {{c1::one}} blank here.", translation: "translation" },
  sourceRef: "t-resource-1",
};
const clozeTask: Task = {
  id: "t-task-cloze",
  type: "cloze",
  itemIds: [clozeSentence1.id, clozeSentence2.id],
};
const clozeUnit: Unit = {
  id: "t-unit-cloze",
  lessonId: "t-topic",
  title: "Cloze",
  goal: "Goal",
  itemIds: [clozeSentence1.id, clozeSentence2.id],
  taskIds: [clozeTask.id],
  noteIds: [],
};
const clozeContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [clozeUnit.id],
  },
  lessons: [],
  units: [clozeUnit],
  items: [clozeSentence1, clozeSentence2],
  tasks: [clozeTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: cloze", () => {
  it("fans out one question per blank, in blank-number order, items in task.itemIds order, filling the other blanks", () => {
    const questions = buildTaskSession(clozeTask, clozeContent, queueRng([]));

    expect(questions).toEqual([
      {
        kind: "cloze",
        unitId: `${clozeSentence1.id}::c1`,
        prompt: "The mat holds the ___.",
        target: "cat",
      },
      {
        kind: "cloze",
        unitId: `${clozeSentence1.id}::c2`,
        prompt: "The ___ holds the cat.",
        target: "mat",
      },
      {
        kind: "cloze",
        unitId: `${clozeSentence2.id}::c1`,
        prompt: "Only ___ blank here.",
        target: "one",
      },
    ]);
  });
});

const matchM1: Item = {
  id: "t-item-match-1",
  kind: "concept",
  payload: { term: "T1", definition: "D1" },
  sourceRef: "t-resource-1",
};
const matchM2: Item = {
  id: "t-item-match-2",
  kind: "concept",
  payload: { term: "T2", definition: "D2" },
  sourceRef: "t-resource-1",
};
const matchM3: Item = {
  id: "t-item-match-3",
  kind: "concept",
  payload: { term: "T3", definition: "D3" },
  sourceRef: "t-resource-1",
};
const matchingTask: Task = {
  id: "t-task-matching",
  type: "matching",
  itemIds: [matchM1.id, matchM2.id, matchM3.id],
};
const matchingUnit: Unit = {
  id: "t-unit-matching",
  lessonId: "t-topic",
  title: "Matching",
  goal: "Goal",
  itemIds: [matchM1.id, matchM2.id, matchM3.id],
  taskIds: [matchingTask.id],
  noteIds: [],
};
const matchingContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [matchingUnit.id],
  },
  lessons: [],
  units: [matchingUnit],
  items: [matchM1, matchM2, matchM3],
  tasks: [matchingTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: matching", () => {
  it("shuffles the prompt side and the answer side independently with the injected RNG", () => {
    // prompts shuffle: i=2 j=floor(0.9*3)=2 (noop), i=1 j=floor(0.1*2)=0 -> [m2,m1,m3]
    // answers shuffle: i=2 j=floor(0.1*3)=0 -> [m3,m2,m1], i=1 j=floor(0.9*2)=1 (noop)
    const rng = queueRng([0.9, 0.1, 0.1, 0.9]);
    const questions = buildTaskSession(matchingTask, matchingContent, rng);

    expect(questions).toEqual([
      {
        kind: "matching",
        prompts: [
          { text: "T2", unitId: matchM2.id },
          { text: "T1", unitId: matchM1.id },
          { text: "T3", unitId: matchM3.id },
        ],
        answers: [
          { text: "D3", unitId: matchM3.id },
          { text: "D2", unitId: matchM2.id },
          { text: "D1", unitId: matchM1.id },
        ],
      },
    ]);
  });
});

describe("matchingOutcomes: first-selection-decides + board-clear semantics", () => {
  const question: MatchingQuestion = {
    kind: "matching",
    prompts: [
      { text: "T1", unitId: "item-1" },
      { text: "T2", unitId: "item-2" },
    ],
    answers: [
      { text: "D1", unitId: "item-1" },
      { text: "D2", unitId: "item-2" },
    ],
  };

  it("checkMatchingPair is correct only when the prompt/answer unit ids match", () => {
    expect(checkMatchingPair(question, 0, 0)).toBe(true);
    expect(checkMatchingPair(question, 0, 1)).toBe(false);
  });

  it("out-of-range indices are never a correct pair (and never clear the board)", () => {
    expect(checkMatchingPair(question, -1, -1)).toBe(false);
    expect(checkMatchingPair(question, 0, 9)).toBe(false);
    // A phantom selection must not count toward clearing the board.
    expect(
      matchingOutcomes(question, [
        { promptIndex: 0, answerIndex: 0 },
        { promptIndex: 9, answerIndex: 9 },
      ]),
    ).toBeNull();
  });

  it("returns null (grades nothing) until the board clears", () => {
    // item-1's first (and only, so far) selection is wrong.
    expect(
      matchingOutcomes(question, [{ promptIndex: 0, answerIndex: 1 }]),
    ).toBeNull();
  });

  it("the first selection decides the grade even if a later retry corrects it, and outcomes emit only once the whole board clears", () => {
    const outcomes = matchingOutcomes(question, [
      { promptIndex: 0, answerIndex: 1 }, // item-1: wrong first attempt -> quality 2, fixed
      { promptIndex: 0, answerIndex: 0 }, // item-1: retry correct -> clears the pair, grade unchanged
      { promptIndex: 1, answerIndex: 1 }, // item-2: correct first attempt -> quality 4, clears
    ]);

    expect(outcomes).toEqual([
      ["item-1", 2],
      ["item-2", 4],
    ]);
  });
});

const scrambleSentence: Item = {
  id: "t-item-scramble",
  kind: "sentence",
  payload: { text: "the cat and the dog", translation: "translation" },
  sourceRef: "t-resource-1",
};
const scrambleTask: Task = {
  id: "t-task-scramble",
  type: "scramble",
  itemIds: [scrambleSentence.id],
};
const scrambleUnit: Unit = {
  id: "t-unit-scramble",
  lessonId: "t-topic",
  title: "Scramble",
  goal: "Goal",
  itemIds: [scrambleSentence.id],
  taskIds: [scrambleTask.id],
  noteIds: [],
};
const scrambleContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [scrambleUnit.id],
  },
  lessons: [],
  units: [scrambleUnit],
  items: [scrambleSentence],
  tasks: [scrambleTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: scramble", () => {
  it("shuffles the markup-stripped whitespace tokens with the injected RNG", () => {
    // 5 tokens: i=4..1, j=floor(rng()*(i+1)) with rng always 0 -> j=0 each
    // step, walking the last element to the front repeatedly.
    const questions = buildTaskSession(
      scrambleTask,
      scrambleContent,
      queueRng([0, 0, 0, 0]),
    );

    expect(questions).toEqual([
      {
        kind: "scramble",
        unitId: scrambleSentence.id,
        tokens: ["cat", "and", "the", "dog", "the"],
        targetTokens: ["the", "cat", "and", "the", "dog"],
      },
    ]);
  });

  it('join-equality: a duplicate token ("the") is interchangeable with its twin', () => {
    const question = {
      kind: "scramble" as const,
      unitId: scrambleSentence.id,
      tokens: ["cat", "and", "the", "dog", "the"],
      targetTokens: ["the", "cat", "and", "the", "dog"],
    };
    // A correct reordering, picking the *other* "the" instance than the
    // shuffle order implies, still joins to the same string.
    expect(
      checkScrambleAnswer(question, ["the", "cat", "and", "the", "dog"]),
    ).toBe(true);
    expect(
      checkScrambleAnswer(question, ["the", "cat", "and", "dog", "the"]),
    ).toBe(false);
  });
});

const buildSentence: Item = {
  id: "t-item-build",
  kind: "sentence",
  payload: { text: "the cat sleeps", translation: "die Katze schläft" },
  sourceRef: "t-resource-1",
};
const buildSib1: Item = {
  id: "t-item-build-sib1",
  kind: "sentence",
  payload: { text: "The dog runs fast", translation: "s1" },
  sourceRef: "t-resource-1",
};
const buildSib2: Item = {
  id: "t-item-build-sib2",
  kind: "sentence",
  payload: { text: "dog runs away now", translation: "s2" },
  sourceRef: "t-resource-1",
};
const buildTask: Task = {
  id: "t-task-build",
  type: "build",
  itemIds: [buildSentence.id],
};

function buildContentWith(unitItems: Item[]): Content {
  const unit: Unit = {
    id: "t-unit-build",
    lessonId: "t-topic",
    title: "Build",
    goal: "Goal",
    itemIds: unitItems.map((item) => item.id),
    taskIds: [buildTask.id],
    noteIds: [],
  };
  return {
    exams: [],
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [unit.id],
    },
    lessons: [],
    units: [unit],
    items: unitItems,
    tasks: [buildTask],
    resources: [],
    notes: [],
  };
}

describe("buildTaskSession: build", () => {
  it("builds a deterministic bank: sibling tokens deduped by string, targets excluded case-insensitively, <= 3 distractors", () => {
    // Candidate pool from siblings (itemIds order, first occurrence wins the
    // dedup): The(excluded vs target "the"), dog, runs, fast, away, now ->
    // [dog, runs, fast, away, now]. rng always 0 pins both shuffles (pool: 4
    // calls, bank of 6: 5 calls).
    const questions = buildTaskSession(
      buildTask,
      buildContentWith([buildSentence, buildSib1, buildSib2]),
      queueRng([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );

    expect(questions).toEqual([
      {
        kind: "build",
        unitId: buildSentence.id,
        prompt: "die Katze schläft",
        tokens: ["cat", "sleeps", "runs", "fast", "away", "the"],
        targetTokens: ["the", "cat", "sleeps"],
      },
    ]);
  });

  it("degrades to a distractor-free bank when the unit has no other sentence items", () => {
    const questions = buildTaskSession(
      buildTask,
      buildContentWith([buildSentence]),
      queueRng([0, 0]),
    );

    expect(questions).toEqual([
      {
        kind: "build",
        unitId: buildSentence.id,
        prompt: "die Katze schläft",
        tokens: ["cat", "sleeps", "the"],
        targetTokens: ["the", "cat", "sleeps"],
      },
    ]);
  });

  it("grades by join-equality against the targets; unused distractors don't matter, a chosen one does", () => {
    const question = {
      kind: "build" as const,
      unitId: buildSentence.id,
      prompt: "die Katze schläft",
      tokens: ["cat", "sleeps", "runs", "fast", "away", "the"],
      targetTokens: ["the", "cat", "sleeps"],
    };
    expect(checkScrambleAnswer(question, ["the", "cat", "sleeps"])).toBe(true);
    expect(checkScrambleAnswer(question, ["the", "runs", "sleeps"])).toBe(
      false,
    );
    expect(
      checkScrambleAnswer(question, ["the", "cat", "sleeps", "fast"]),
    ).toBe(false);
  });
});

const audioC1: Item = {
  id: "t-item-audio-c1",
  kind: "concept",
  payload: { term: "Term 1", definition: "Definition 1", audioRef: "a1" },
  sourceRef: "t-resource-1",
};
const audioC2: Item = {
  id: "t-item-audio-c2",
  kind: "concept",
  payload: { term: "Term 2", definition: "Definition 2", audioRef: "a2" },
  sourceRef: "t-resource-1",
};
const audioC3: Item = {
  id: "t-item-audio-c3",
  kind: "concept",
  payload: { term: "Term 3", definition: "Definition 3", audioRef: "a3" },
  sourceRef: "t-resource-1",
};
const audioC4: Item = {
  id: "t-item-audio-c4",
  kind: "concept",
  payload: { term: "Term 4", definition: "Definition 4", audioRef: "a4" },
  sourceRef: "t-resource-1",
};
const listenTask: Task = {
  id: "t-task-listen",
  type: "listen",
  itemIds: [audioC1.id, audioC2.id],
};
const listenUnit: Unit = {
  id: "t-unit-listen",
  lessonId: "t-topic",
  title: "Listen",
  goal: "Goal",
  itemIds: [audioC1.id, audioC2.id, audioC3.id, audioC4.id],
  taskIds: [listenTask.id],
  noteIds: [],
};
const listenContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [listenUnit.id],
  },
  lessons: [],
  units: [listenUnit],
  items: [audioC1, audioC2, audioC3, audioC4],
  tasks: [listenTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: listen", () => {
  it("reuses the pinned shuffle-and-insert distractor algorithm over display texts, prompted by the audio stem", () => {
    // Same rng script and same algorithm as the recognize test above.
    const rng = queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5]);
    const questions = buildTaskSession(listenTask, listenContent, rng);

    expect(questions).toEqual([
      {
        kind: "listen",
        unitId: audioC1.id,
        audio: { kind: "stem", stem: "a1" },
        choices: [
          "Definition 3",
          "Definition 2",
          "Definition 1",
          "Definition 4",
        ],
        correctIndex: 2,
      },
      {
        kind: "listen",
        unitId: audioC2.id,
        audio: { kind: "stem", stem: "a2" },
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
});

const imageL1: Item = {
  id: "t-item-image-l1",
  kind: "lexeme",
  payload: {
    script: "A",
    transliteration: "a",
    gloss: "Gloss 1",
    imageRef: "i1",
  },
  sourceRef: "t-resource-1",
};
const imageL2: Item = {
  id: "t-item-image-l2",
  kind: "lexeme",
  payload: {
    script: "B",
    transliteration: "b",
    gloss: "Gloss 2",
    imageRef: "i2",
  },
  sourceRef: "t-resource-1",
};
const imageL3: Item = {
  id: "t-item-image-l3",
  kind: "lexeme",
  payload: {
    script: "C",
    transliteration: "c",
    gloss: "Gloss 3",
    imageRef: "i3",
  },
  sourceRef: "t-resource-1",
};
const imageL4: Item = {
  id: "t-item-image-l4",
  kind: "lexeme",
  payload: {
    script: "D",
    transliteration: "d",
    gloss: "Gloss 4",
    imageRef: "i4",
  },
  sourceRef: "t-resource-1",
};
const pictureTask: Task = {
  id: "t-task-picture",
  type: "picture",
  itemIds: [imageL1.id],
};
const pictureUnit: Unit = {
  id: "t-unit-picture",
  lessonId: "t-topic",
  title: "Picture",
  goal: "Goal",
  itemIds: [imageL1.id, imageL2.id, imageL3.id, imageL4.id],
  taskIds: [pictureTask.id],
  noteIds: [],
};
const pictureContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [pictureUnit.id],
  },
  lessons: [],
  units: [pictureUnit],
  items: [imageL1, imageL2, imageL3, imageL4],
  tasks: [pictureTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: picture", () => {
  it("reuses the pinned shuffle-and-insert distractor algorithm over the foreign forms, prompted by the image stem", () => {
    // Production direction (plan 0025 §2): the image prompts, and the
    // choices are scripts — "A".."D" here — not the glosses it used to show.
    const rng = queueRng([0.9, 0.1, 0.5]);
    const questions = buildTaskSession(pictureTask, pictureContent, rng);

    expect(questions).toEqual([
      {
        kind: "picture",
        unitId: imageL1.id,
        imageStem: "i1",
        choices: ["C", "B", "A", "D"],
        correctIndex: 2,
      },
    ]);
  });

  it("drops a distractor that renders as the answer rather than showing it twice", () => {
    // Class (h) guarantees distinct glosses, not distinct scripts, so a
    // produce-direction board can be handed a homograph. A shorter board is
    // answerable; two identical buttons are not.
    const homograph: Item = {
      id: "t-item-image-homograph",
      kind: "lexeme",
      payload: {
        script: "A",
        transliteration: "a",
        gloss: "Gloss 5",
        imageRef: "i5",
      },
      sourceRef: "t-resource-1",
    };
    const content: Content = {
      ...pictureContent,
      units: [
        { ...pictureUnit, itemIds: [...pictureUnit.itemIds, homograph.id] },
      ],
      items: [...pictureContent.items, homograph],
    };
    const rng = queueRng([0.9, 0.1, 0.5, 0.2]);
    const questions = buildTaskSession(pictureTask, content, rng);

    const [question] = questions;
    expect(question?.kind).toBe("picture");
    const { choices, correctIndex } = question as Extract<
      Question,
      { kind: "picture" }
    >;
    expect(choices).toHaveLength(4);
    expect(new Set(choices).size).toBe(4);
    expect(choices[correctIndex]).toBe("A");
  });
});

const pairItem: Item = {
  id: "t-item-pair-mp",
  kind: "pair",
  payload: {
    a: { script: "шым", audioRef: "shym" },
    b: { script: "чым", audioRef: "chym" },
    contrast: "ш/ч",
  },
  sourceRef: "t-resource-1",
};
const minimalPairTask: Task = {
  id: "t-task-minimal-pair",
  type: "minimal-pair",
  itemIds: [pairItem.id],
};
const minimalPairUnit: Unit = {
  id: "t-unit-minimal-pair",
  lessonId: "t-topic",
  title: "Minimal pair",
  goal: "Goal",
  itemIds: [pairItem.id],
  taskIds: [minimalPairTask.id],
  noteIds: [],
};
const minimalPairContent: Content = {
  exams: [],
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [minimalPairUnit.id],
  },
  lessons: [],
  units: [minimalPairUnit],
  items: [pairItem],
  tasks: [minimalPairTask],
  resources: [],
  notes: [],
};

describe("buildTaskSession: minimal-pair", () => {
  it("plays side a when the coin flip is < 0.5", () => {
    const questions = buildTaskSession(
      minimalPairTask,
      minimalPairContent,
      queueRng([0.1]),
    );
    expect(questions).toEqual([
      {
        kind: "minimal-pair",
        unitId: pairItem.id,
        audioStem: "shym",
        choices: ["шым", "чым"],
        correctIndex: 0,
      },
    ]);
  });

  it("plays side b when the coin flip is >= 0.5", () => {
    const questions = buildTaskSession(
      minimalPairTask,
      minimalPairContent,
      queueRng([0.9]),
    );
    expect(questions).toEqual([
      {
        kind: "minimal-pair",
        unitId: pairItem.id,
        audioStem: "chym",
        choices: ["шым", "чым"],
        correctIndex: 1,
      },
    ]);
  });
});

describe("buildReviewSession", () => {
  it("uses the recall presentation for lexeme/concept units, regardless of kind", () => {
    const units = [
      { id: c1.id, item: c1 },
      { id: l1.id, item: l1 },
    ];
    const questions = buildReviewSession(units, conceptContent, queueRng([]));

    expect(questions).toEqual([
      {
        kind: "recall",
        unitId: c1.id,
        prompt: "Term 1",
        reveal: ["Definition 1"],
      },
      {
        kind: "recall",
        unitId: l1.id,
        prompt: "hello",
        reveal: ["Салам", "Salam"],
      },
    ]);
  });

  it("uses the recall presentation for a plain-sentence unit (blankNumber undefined)", () => {
    const sentence: Item = {
      id: "t-item-sentence-plain",
      kind: "sentence",
      payload: {
        text: "The {{c1::cat}} sat.",
        translation: "the translation",
      },
      sourceRef: "t-resource-1",
    };

    const questions = buildReviewSession(
      [{ id: sentence.id, item: sentence }],
      conceptContent,
      queueRng([]),
    );

    expect(questions).toEqual([
      {
        kind: "recall",
        unitId: sentence.id,
        prompt: "the translation",
        reveal: ["The cat sat."],
      },
    ]);
  });

  it("builds the cloze question for a due blank unit, and a minimal-pair question for a due pair unit", () => {
    const sentence: Item = {
      id: "t-item-sentence-cloze",
      kind: "sentence",
      payload: {
        text: "The {{c1::cat}} sat on the {{c2::mat}}.",
        translation: "translation",
      },
      sourceRef: "t-resource-1",
    };
    const pair: Item = {
      id: "t-item-pair-1",
      kind: "pair",
      payload: {
        a: { script: "шым", audioRef: "shym" },
        b: { script: "чым", audioRef: "chym" },
        contrast: "ш/ч",
      },
      sourceRef: "t-resource-1",
    };
    const units = [
      { id: `${sentence.id}::c2`, item: sentence, blankNumber: 2 },
      { id: pair.id, item: pair },
    ];

    const questions = buildReviewSession(
      units,
      conceptContent,
      queueRng([0.9]),
    );

    expect(questions).toEqual([
      {
        kind: "cloze",
        unitId: `${sentence.id}::c2`,
        prompt: "The cat sat on the ___.",
        target: "mat",
      },
      {
        kind: "minimal-pair",
        unitId: pair.id,
        audioStem: "chym",
        choices: ["шым", "чым"],
        correctIndex: 1,
      },
    ]);
  });

  describe("a due sentence reviews as its authored exercise (plan 0022 §6)", () => {
    const s1: Item = {
      id: "t-item-s1",
      kind: "sentence",
      payload: {
        text: "Мен китеп окуйм",
        translation: "I read a book",
        audioRef: "s1-audio",
      },
      sourceRef: "t-resource-1",
    };
    const s2: Item = {
      id: "t-item-s2",
      kind: "sentence",
      payload: { text: "Сен барасың", translation: "you go" },
      sourceRef: "t-resource-1",
    };
    const sentenceUnit: Unit = {
      id: "t-unit-sentences",
      lessonId: "t-lesson",
      title: "Sentences",
      goal: "Goal",
      itemIds: [s1.id, s2.id],
      taskIds: ["t-task-build", "t-task-scramble", "t-task-dictation"],
      noteIds: [],
    };
    function contentWith(tasks: Task[]): Content {
      return {
        ...conceptContent,
        units: [sentenceUnit],
        items: [s1, s2],
        tasks,
      };
    }

    it("prefers the build task, with the same bank buildTaskSession would produce", () => {
      const buildTask: Task = {
        id: "t-task-build",
        type: "build",
        itemIds: [s1.id, s2.id],
      };
      const content = contentWith([buildTask]);
      const units = [{ id: s1.id, item: s1 }];

      // Same rng script both ways: the review question must be exactly the
      // question the task itself builds for that item.
      const reviewed = buildReviewSession(
        units,
        content,
        queueRng([0.5, 0.5, 0.1, 0.9, 0.3, 0.7]),
      );
      const taught = buildTaskSession(
        { ...buildTask, itemIds: [s1.id] },
        content,
        queueRng([0.5, 0.5, 0.1, 0.9, 0.3, 0.7]),
      );

      expect(reviewed).toEqual(taught);
      expect(reviewed[0]).toMatchObject({ kind: "build", unitId: s1.id });
    });

    it("falls to scramble, then dictation, when no build task teaches the sentence", () => {
      const scramble = buildReviewSession(
        [{ id: s1.id, item: s1 }],
        contentWith([
          { id: "t-task-scramble", type: "scramble", itemIds: [s1.id] },
          { id: "t-task-dictation", type: "dictation", itemIds: [s1.id] },
        ]),
        queueRng([0.5, 0.5, 0.5]),
      );
      expect(scramble[0]!.kind).toBe("scramble");

      const dictation = buildReviewSession(
        [{ id: s1.id, item: s1 }],
        contentWith([
          { id: "t-task-dictation", type: "dictation", itemIds: [s1.id] },
        ]),
        queueRng([]),
      );
      expect(dictation[0]).toEqual({
        kind: "dictation",
        unitId: s1.id,
        audioStem: "s1-audio",
        target: "Мен китеп окуйм",
      });
    });

    it("skips a dictation task for a sentence with no audio instead of throwing", () => {
      const questions = buildReviewSession(
        [{ id: s2.id, item: s2 }],
        contentWith([
          { id: "t-task-dictation", type: "dictation", itemIds: [s2.id] },
        ]),
        queueRng([]),
      );
      expect(questions[0]!.kind).toBe("recall");
    });

    it("ignores multiple-choice and cloze tasks — they are weaker than the card", () => {
      const questions = buildReviewSession(
        [{ id: s1.id, item: s1 }],
        contentWith([
          { id: "t-task-cloze", type: "cloze", itemIds: [s1.id] },
          { id: "t-task-listen", type: "listen", itemIds: [s1.id] },
          { id: "t-task-matching", type: "matching", itemIds: [s1.id, s2.id] },
        ]),
        queueRng([]),
      );
      expect(questions[0]!.kind).toBe("recall");
    });

    it("leaves lexemes and concepts on the recall card even when tasks exist", () => {
      const questions = buildReviewSession(
        [{ id: c1.id, item: c1 }],
        conceptContent,
        queueRng([]),
      );
      expect(questions[0]!.kind).toBe("recall");
    });

    it("still grades against the sentence's own scheduling unit id", () => {
      const content = contentWith([
        { id: "t-task-build", type: "build", itemIds: [s1.id, s2.id] },
      ]);
      const questions = buildReviewSession(
        [
          { id: s1.id, item: s1 },
          { id: s2.id, item: s2 },
        ],
        content,
        queueRng([0.5, 0.5, 0.1, 0.9, 0.3, 0.7, 0.5, 0.5, 0.1, 0.9, 0.3, 0.7]),
      );
      expect(questions.map((q) => ("unitId" in q ? q.unitId : null))).toEqual([
        s1.id,
        s2.id,
      ]);
    });
  });

  it("maps a note unit to a NoteQuestion (plan 0008 step 7)", () => {
    const note = { id: "t-note-1", stem: "note-stem-1" };
    const units = [{ id: noteUnitId(note.id), note }];

    const questions = buildReviewSession(units, conceptContent, queueRng([]));

    expect(questions).toEqual([
      {
        kind: "note",
        unitId: noteUnitId(note.id),
        noteId: note.id,
        stem: note.stem,
      },
    ]);
  });
});

describe("buildUnitSession", () => {
  it("tags every question with its source task, then shuffles the combined list once (plan 0010)", () => {
    // A recall task (no rng draws) plus the recognize task/items reused from
    // the "recognize" fixtures above, pooled into one unit with two tasks.
    const recallTaskU: Task = {
      id: "t-task-recall-u",
      type: "recall",
      itemIds: [c3.id],
    };
    const unit: Unit = {
      id: "t-unit-session",
      lessonId: "t-topic",
      title: "Unit Session",
      goal: "Goal",
      itemIds: [c1.id, c2.id, c3.id, c4.id],
      taskIds: [recallTaskU.id, recognizeTask.id],
      noteIds: [],
    };
    const content: Content = {
      exams: [],
      topic: {
        id: "t-topic",
        code: "t",
        domainId: "t",
        title: "Book",
        description: "",
        lessonIds: [unit.id],
      },
      lessons: [],
      units: [unit],
      items: [c1, c2, c3, c4],
      tasks: [recallTaskU, recognizeTask],
      resources: [],
      notes: [],
    };

    // First 6 draws reproduce the recognize task's two questions exactly as
    // in "buildTaskSession: recognize" above (recallTaskU draws nothing).
    // The final 2 draws are the combine-step Fisher-Yates over the 3
    // resulting pairs: both 0 -> [P0, P1, P2] rotates to [P1, P2, P0].
    const rng = queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5, 0, 0]);

    const pairs = buildUnitSession(unit, content, rng);

    expect(pairs).toEqual([
      {
        taskId: recognizeTask.id,
        question: {
          kind: "recognize",
          unitId: c1.id,
          prompt: "Term 1",
          choices: [
            "Definition 3",
            "Definition 2",
            "Definition 1",
            "Definition 4",
          ],
          correctIndex: 2,
        },
      },
      {
        taskId: recognizeTask.id,
        question: {
          kind: "recognize",
          unitId: c2.id,
          prompt: "Term 2",
          choices: [
            "Definition 3",
            "Definition 1",
            "Definition 2",
            "Definition 4",
          ],
          correctIndex: 2,
        },
      },
      {
        taskId: recallTaskU.id,
        question: {
          kind: "recall",
          unitId: c3.id,
          prompt: "Term 3",
          reveal: ["Definition 3"],
        },
      },
    ]);
  });

  it("pools every task's questions, not just the first", () => {
    const questions = buildUnitSession(
      conceptUnit,
      conceptContent,
      queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5, 0, 0]),
    ).map((pair) => pair.question);
    // conceptUnit has exactly one task (recognizeTask, 2 items) -> 2 questions.
    expect(questions).toHaveLength(2);
    expect(questions.every((q) => q.kind === "recognize")).toBe(true);
  });
});

describe("countUnitQuestions", () => {
  it("counts one question per item for a plain task type", () => {
    expect(countUnitQuestions(conceptUnit, conceptContent)).toBe(2);
  });

  it("counts a matching task as exactly 1, regardless of item count", () => {
    expect(countUnitQuestions(matchingUnit, matchingContent)).toBe(1);
  });

  it("counts a cloze task as one question per blank across its items", () => {
    expect(countUnitQuestions(clozeUnit, clozeContent)).toBe(3);
  });

  it("matches buildUnitSession's actual output length for a mixed unit", () => {
    const recallTaskU: Task = {
      id: "t-task-recall-u2",
      type: "recall",
      itemIds: [c3.id],
    };
    const unit: Unit = {
      id: "t-unit-session-2",
      lessonId: "t-topic",
      title: "Unit Session",
      goal: "Goal",
      itemIds: [c1.id, c2.id, c3.id, c4.id],
      taskIds: [recallTaskU.id, recognizeTask.id],
      noteIds: [],
    };
    const content: Content = {
      exams: [],
      topic: {
        id: "t-topic",
        code: "t",
        domainId: "t",
        title: "Book",
        description: "",
        lessonIds: [unit.id],
      },
      lessons: [],
      units: [unit],
      items: [c1, c2, c3, c4],
      tasks: [recallTaskU, recognizeTask],
      resources: [],
      notes: [],
    };
    expect(countUnitQuestions(unit, content)).toBe(
      buildUnitSession(
        unit,
        content,
        queueRng([0.9, 0.1, 0.5, 0.9, 0.1, 0.5, 0, 0]),
      ).length,
    );
  });
});

describe("buildRecallSession", () => {
  // Seven single-item recall tasks over seven lexeme items, pooled into one
  // unit — more than RECALL_SESSION_MAX_TASKS (5), so sampling is exercised.
  const recallItems: Item[] = Array.from({ length: 7 }, (_, i) => ({
    id: `t-item-recall-${i + 1}`,
    kind: "lexeme",
    payload: {
      script: `Script ${i + 1}`,
      transliteration: `Translit ${i + 1}`,
      gloss: `Gloss ${i + 1}`,
    },
    sourceRef: "t-resource-1",
  }));
  const recallTasks: Task[] = recallItems.map((item, i) => ({
    id: `t-task-recall-${i + 1}`,
    type: "recall",
    itemIds: [item.id],
  }));
  const bigRecallUnit: Unit = {
    id: "t-unit-recall-big",
    lessonId: "t-topic",
    title: "Big recall unit",
    goal: "Goal",
    itemIds: recallItems.map((item) => item.id),
    taskIds: recallTasks.map((task) => task.id),
    noteIds: [],
  };
  const bigRecallContent: Content = {
    exams: [],
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [bigRecallUnit.id],
    },
    lessons: [],
    units: [bigRecallUnit],
    items: recallItems,
    tasks: recallTasks,
    resources: [],
    notes: [],
  };

  it("samples exactly RECALL_SESSION_MAX_TASKS (5) distinct tasks when the linked unit has more than 5", () => {
    const pairs = buildRecallSession(bigRecallUnit, bigRecallContent, () => 0);
    const distinctTaskIds = new Set(pairs.map((pair) => pair.taskId));
    expect(distinctTaskIds.size).toBe(5);
  });

  it("includes every task when the linked unit has fewer than 5", () => {
    const smallUnit: Unit = {
      ...bigRecallUnit,
      id: "t-unit-recall-small",
      taskIds: recallTasks.slice(0, 3).map((task) => task.id),
    };
    const pairs = buildRecallSession(smallUnit, bigRecallContent, () => 0);
    const distinctTaskIds = new Set(pairs.map((pair) => pair.taskId));
    expect(distinctTaskIds.size).toBe(3);
  });

  it("is just a capped buildUnitSession: matches buildUnitSession over the same sampled subset", () => {
    // rng is stateless (always 0), so re-deriving the sampled subset and
    // feeding it straight to buildUnitSession must reproduce the same pairs.
    const sampledTaskIds = shuffle(bigRecallUnit.taskIds, () => 0).slice(0, 5);
    const expected = buildUnitSession(
      { ...bigRecallUnit, taskIds: sampledTaskIds },
      bigRecallContent,
      () => 0,
    );

    const actual = buildRecallSession(bigRecallUnit, bigRecallContent, () => 0);

    expect(actual).toEqual(expected);
  });
});

/**
 * Authored-option questions (plan 0027 §5): the payload is the whole
 * exercise, so both builders are total functions of the item — no sampling,
 * no shuffle, no rng consumed at all.
 */
describe("choice and assign questions (plan 0027)", () => {
  const choiceItem: Item = {
    id: "t-item-choice",
    kind: "question",
    payload: {
      stem: "Which of these are architectural views?",
      options: [
        { text: "Bausteinsicht", correct: true },
        { text: "Laufzeitsicht", correct: true },
        { text: "Dienstagssicht", correct: false },
        { text: "Verteilungssicht", correct: true },
      ],
    },
    sourceRef: "t-resource-1",
  };
  const assignItem: Item = {
    id: "t-item-assign",
    kind: "question",
    payload: {
      stem: "Richtig oder falsch?",
      options: [
        { text: "A blackbox hides its internals", correct: true },
        { text: "A whitebox hides its internals", correct: false },
        { text: "Both are views on the same building block", correct: true },
      ],
      labels: ["Richtig", "Falsch"],
    },
    sourceRef: "t-resource-1",
  };
  const choiceTask: Task = {
    id: "t-task-choice",
    type: "choice",
    itemIds: [choiceItem.id],
  };
  const assignTask: Task = {
    id: "t-task-assign",
    type: "assign",
    itemIds: [assignItem.id],
  };
  const questionUnit: Unit = {
    id: "t-unit-questions",
    lessonId: "t-topic",
    title: "Questions",
    goal: "Goal",
    itemIds: [choiceItem.id, assignItem.id],
    taskIds: [choiceTask.id, assignTask.id],
    noteIds: [],
  };
  const questionContent: Content = {
    exams: [],
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [questionUnit.id],
    },
    lessons: [],
    units: [questionUnit],
    items: [choiceItem, assignItem],
    tasks: [choiceTask, assignTask],
    resources: [],
    notes: [],
  };
  /** Any call is a bug: neither builder samples or shuffles anything. */
  const noRng: Rng = () => {
    throw new Error("rng must not be consumed");
  };

  it("builds a choice question in the authored option order", () => {
    const [question] = buildTaskSession(choiceTask, questionContent, noRng);
    expect(question).toEqual({
      kind: "choice",
      unitId: choiceItem.id,
      stem: "Which of these are architectural views?",
      choices: [
        "Bausteinsicht",
        "Laufzeitsicht",
        "Dienstagssicht",
        "Verteilungssicht",
      ],
      correctIndices: [0, 1, 3],
      selectCount: 3,
      whys: [undefined, undefined, undefined, undefined],
      explanationGenerated: false,
    } satisfies ChoiceQuestion);
  });

  it("derives selectCount from the correct options, never from a field", () => {
    const [question] = buildTaskSession(choiceTask, questionContent, noRng);
    expect((question as ChoiceQuestion).selectCount).toBe(
      (question as ChoiceQuestion).correctIndices.length,
    );
  });

  it("builds an assign question, correct meaning the first label", () => {
    const [question] = buildTaskSession(assignTask, questionContent, noRng);
    expect(question).toEqual({
      kind: "assign",
      unitId: assignItem.id,
      stem: "Richtig oder falsch?",
      rows: [
        "A blackbox hides its internals",
        "A whitebox hides its internals",
        "Both are views on the same building block",
      ],
      labels: ["Richtig", "Falsch"],
      correctLabelIndex: [0, 1, 0],
      whys: [undefined, undefined, undefined],
      explanationGenerated: false,
    } satisfies AssignQuestion);
  });

  it("reviews a due question item as its own card, not a recall card", () => {
    const [question] = buildReviewSession(
      [{ id: assignItem.id, item: assignItem }],
      questionContent,
      noRng,
    );
    expect(question?.kind).toBe("assign");
  });

  it("counts one question per item", () => {
    expect(countUnitQuestions(questionUnit, questionContent)).toBe(2);
  });

  describe("checkChoiceAnswer", () => {
    const question = buildTaskSession(
      choiceTask,
      questionContent,
      noRng,
    )[0] as ChoiceQuestion;

    it("accepts exactly the correct set, in any order", () => {
      expect(checkChoiceAnswer(question, [3, 0, 1])).toBe(true);
    });

    it("rejects a partially correct answer", () => {
      expect(checkChoiceAnswer(question, [0, 1])).toBe(false);
    });

    it("rejects a full-count answer with one wrong pick", () => {
      expect(checkChoiceAnswer(question, [0, 1, 2])).toBe(false);
    });

    it("rejects an empty answer", () => {
      expect(checkChoiceAnswer(question, [])).toBe(false);
    });
  });

  describe("checkAssignAnswer", () => {
    const question = buildTaskSession(
      assignTask,
      questionContent,
      noRng,
    )[0] as AssignQuestion;

    it("accepts every row correctly labelled", () => {
      expect(checkAssignAnswer(question, [0, 1, 0])).toBe(true);
    });

    it("rejects one wrong row", () => {
      expect(checkAssignAnswer(question, [0, 0, 0])).toBe(false);
    });

    it("counts an unanswered row as wrong — in practice, not in an exam", () => {
      expect(checkAssignAnswer(question, [0, null, 0])).toBe(false);
    });
  });

  describe("whys and explanation (plan 0027 amendment §5)", () => {
    it("carries whys aligned with choices, the explanation, and marks explanationGenerated via `generated`", () => {
      const item: Item = {
        id: "t-item-choice-explained",
        kind: "question",
        payload: {
          stem: "Which of these are architectural views?",
          options: [
            {
              text: "Bausteinsicht",
              correct: true,
              why: "Shows the building blocks.",
            },
            { text: "Dienstagssicht", correct: false },
          ],
          explanation: "Views structure a system from different angles.",
          generated: true,
        },
        sourceRef: "t-resource-1",
      };
      const task: Task = {
        id: "t-task-choice-explained",
        type: "choice",
        itemIds: [item.id],
      };
      const content: Content = {
        ...questionContent,
        items: [item],
        tasks: [task],
      };

      const [question] = buildTaskSession(task, content, noRng);

      expect(question).toEqual({
        kind: "choice",
        unitId: item.id,
        stem: "Which of these are architectural views?",
        choices: ["Bausteinsicht", "Dienstagssicht"],
        correctIndices: [0],
        selectCount: 1,
        whys: ["Shows the building blocks.", undefined],
        explanation: "Views structure a system from different angles.",
        explanationGenerated: true,
      } satisfies ChoiceQuestion);
    });

    it("marks explanationGenerated true via `explanationGenerated` alone", () => {
      const item: Item = {
        id: "t-item-choice-explained-2",
        kind: "question",
        payload: {
          stem: "Stem",
          options: [
            { text: "A", correct: true },
            { text: "B", correct: false },
          ],
          explanation: "Because.",
          explanationGenerated: true,
        },
        sourceRef: "t-resource-1",
      };
      const task: Task = {
        id: "t-task-choice-explained-2",
        type: "choice",
        itemIds: [item.id],
      };
      const content: Content = {
        ...questionContent,
        items: [item],
        tasks: [task],
      };

      const [question] = buildTaskSession(task, content, noRng) as [
        ChoiceQuestion,
      ];

      expect(question.explanationGenerated).toBe(true);
    });

    it("leaves explanationGenerated false when neither flag is set", () => {
      // choiceItem carries no `generated`/`explanationGenerated` and no `why`s.
      const [question] = buildTaskSession(choiceTask, questionContent, noRng);
      expect((question as ChoiceQuestion).explanationGenerated).toBe(false);
      expect((question as ChoiceQuestion).whys).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(question !== undefined && "explanation" in question).toBe(false);
    });
  });
});

describe("buildFixedSession (plan 0027 §5)", () => {
  const c1: Item = {
    id: "t-item-fixed-c1",
    kind: "concept",
    payload: { term: "Term 1", definition: "Definition 1" },
    sourceRef: "t-resource-1",
  };
  const c2: Item = {
    id: "t-item-fixed-c2",
    kind: "concept",
    payload: { term: "Term 2", definition: "Definition 2" },
    sourceRef: "t-resource-1",
  };
  const taskA: Task = {
    id: "t-task-fixed-a",
    type: "recall",
    itemIds: [c2.id],
  };
  const taskB: Task = {
    id: "t-task-fixed-b",
    type: "recall",
    itemIds: [c1.id],
  };
  const unit: Unit = {
    id: "t-unit-fixed",
    lessonId: "t-topic",
    title: "Fixed",
    goal: "Goal",
    itemIds: [c1.id, c2.id],
    taskIds: [taskA.id, taskB.id],
    noteIds: [],
  };
  const content: Content = {
    exams: [],
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [unit.id],
    },
    lessons: [],
    units: [unit],
    items: [c1, c2],
    tasks: [taskA, taskB],
    resources: [],
    notes: [],
  };

  it("preserves the given task order, not unit.taskIds order, and skips an unknown id", () => {
    const pairs = buildFixedSession(
      [taskB.id, "t-task-missing", taskA.id],
      content,
      () => 0,
    );
    expect(pairs.map((p) => p.taskId)).toEqual([taskB.id, taskA.id]);
    expect(
      pairs.map((p) =>
        p.question.kind === "recall" ? p.question.unitId : undefined,
      ),
    ).toEqual([c1.id, c2.id]);
  });
});

describe("checkTaskIds (plan 0027 §12)", () => {
  it("returns only the choice/assign task ids, in unit.taskIds order", () => {
    const concept1: Item = {
      id: "t-item-check-c1",
      kind: "concept",
      payload: { term: "Term 1", definition: "Definition 1" },
      sourceRef: "t-resource-1",
    };
    const concept2: Item = {
      id: "t-item-check-c2",
      kind: "concept",
      payload: { term: "Term 2", definition: "Definition 2" },
      sourceRef: "t-resource-1",
    };
    const qItem: Item = {
      id: "t-item-check-q",
      kind: "question",
      payload: {
        stem: "Stem",
        options: [
          { text: "A", correct: true },
          { text: "B", correct: false },
        ],
      },
      sourceRef: "t-resource-1",
    };
    const assignItem: Item = {
      id: "t-item-check-assign",
      kind: "question",
      payload: {
        stem: "Stem",
        options: [
          { text: "A", correct: true },
          { text: "B", correct: false },
        ],
        labels: ["Richtig", "Falsch"],
      },
      sourceRef: "t-resource-1",
    };
    const recallTask: Task = {
      id: "t-task-check-recall",
      type: "recall",
      itemIds: [concept1.id],
    };
    const choiceTask: Task = {
      id: "t-task-check-choice",
      type: "choice",
      itemIds: [qItem.id],
    };
    const matchingTask: Task = {
      id: "t-task-check-matching",
      type: "matching",
      itemIds: [concept1.id, concept2.id],
    };
    const assignTask: Task = {
      id: "t-task-check-assign",
      type: "assign",
      itemIds: [assignItem.id],
    };
    const unit: Unit = {
      id: "t-unit-check",
      lessonId: "t-topic",
      title: "Check",
      goal: "Goal",
      itemIds: [concept1.id, concept2.id, qItem.id, assignItem.id],
      taskIds: [recallTask.id, choiceTask.id, matchingTask.id, assignTask.id],
      noteIds: [],
    };
    const content: Content = {
      exams: [],
      topic: {
        id: "t-topic",
        code: "t",
        domainId: "t",
        title: "Book",
        description: "",
        lessonIds: [unit.id],
      },
      lessons: [],
      units: [unit],
      items: [concept1, concept2, qItem, assignItem],
      tasks: [recallTask, choiceTask, matchingTask, assignTask],
      resources: [],
      notes: [],
    };

    expect(checkTaskIds(unit, content)).toEqual([choiceTask.id, assignTask.id]);
  });
});

describe("drillItemIds (plan 0027 §5, §10)", () => {
  const drillQuestionItem: Item = {
    id: "t-item-drill-question",
    kind: "question",
    payload: {
      stem: "Stem",
      options: [
        { text: "A", correct: true },
        { text: "B", correct: false },
      ],
    },
    sourceRef: "t-resource-1",
  };
  const matchingOnlySentence: Item = {
    id: "t-item-drill-matching-only",
    kind: "sentence",
    payload: { text: "Hello.", translation: "Hi." },
    sourceRef: "t-resource-1",
  };
  const scrambleBuildSentence: Item = {
    id: "t-item-drill-scramble-build",
    kind: "sentence",
    payload: { text: "Hello there.", translation: "Hi there." },
    sourceRef: "t-resource-1",
  };
  const recallConcept: Item = {
    id: "t-item-drill-recall",
    kind: "concept",
    payload: { term: "Term", definition: "Definition" },
    sourceRef: "t-resource-1",
  };
  const questionTask: Task = {
    id: "t-task-drill-question",
    type: "choice",
    itemIds: [drillQuestionItem.id],
  };
  const matchingOnlyTask: Task = {
    id: "t-task-drill-matching-only",
    type: "matching",
    itemIds: [matchingOnlySentence.id],
  };
  const scrambleTask: Task = {
    id: "t-task-drill-scramble",
    type: "scramble",
    itemIds: [scrambleBuildSentence.id],
  };
  const buildTask: Task = {
    id: "t-task-drill-build",
    type: "build",
    itemIds: [scrambleBuildSentence.id],
  };
  const recallOnlyTask: Task = {
    id: "t-task-drill-recall-only",
    type: "recall",
    itemIds: [recallConcept.id],
  };
  const drillUnit: Unit = {
    id: "t-unit-drill",
    lessonId: "t-topic",
    title: "Drill",
    goal: "Goal",
    itemIds: [
      drillQuestionItem.id,
      matchingOnlySentence.id,
      scrambleBuildSentence.id,
      recallConcept.id,
    ],
    taskIds: [
      questionTask.id,
      matchingOnlyTask.id,
      scrambleTask.id,
      buildTask.id,
      recallOnlyTask.id,
    ],
    noteIds: [],
  };
  const drillContent: Content = {
    exams: [],
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [drillUnit.id],
    },
    lessons: [],
    units: [drillUnit],
    items: [
      drillQuestionItem,
      matchingOnlySentence,
      scrambleBuildSentence,
      recallConcept,
    ],
    tasks: [
      questionTask,
      matchingOnlyTask,
      scrambleTask,
      buildTask,
      recallOnlyTask,
    ],
    resources: [],
    notes: [],
  };

  it("excludes a question item", () => {
    expect(drillItemIds(drillUnit, drillContent)).not.toContain(
      drillQuestionItem.id,
    );
  });

  it("excludes an item whose only available exercise is matching", () => {
    expect(drillItemIds(drillUnit, drillContent)).not.toContain(
      matchingOnlySentence.id,
    );
  });

  it("keeps a concept with recall", () => {
    expect(drillItemIds(drillUnit, drillContent)).toContain(recallConcept.id);
  });

  it("keeps a sentence whose only tasks are scramble/build when nothing is disallowed", () => {
    expect(drillItemIds(drillUnit, drillContent)).toContain(
      scrambleBuildSentence.id,
    );
  });

  it("excludes that same sentence under an allow-list without scramble/build", () => {
    const allowed: Exercise[] = ["matching", "recognize", "recall"];
    expect(drillItemIds(drillUnit, drillContent, allowed)).not.toContain(
      scrambleBuildSentence.id,
    );
  });
});

describe("recallableTaskIds and buildRecallSession over a choice task (plan 0027 §5)", () => {
  const recallConcept: Item = {
    id: "t-item-recall-mixed",
    kind: "concept",
    payload: { term: "Term", definition: "Definition" },
    sourceRef: "t-resource-1",
  };
  const qItem: Item = {
    id: "t-item-recall-mixed-q",
    kind: "question",
    payload: {
      stem: "Stem",
      options: [
        { text: "A", correct: true },
        { text: "B", correct: false },
      ],
    },
    sourceRef: "t-resource-1",
  };
  const recallTask: Task = {
    id: "t-task-mixed-recall",
    type: "recall",
    itemIds: [recallConcept.id],
  };
  const choiceTask: Task = {
    id: "t-task-mixed-choice",
    type: "choice",
    itemIds: [qItem.id],
  };
  const mixedUnit: Unit = {
    id: "t-unit-mixed",
    lessonId: "t-topic",
    title: "Mixed",
    goal: "Goal",
    itemIds: [recallConcept.id, qItem.id],
    taskIds: [recallTask.id, choiceTask.id],
    noteIds: [],
  };
  const mixedContent: Content = {
    exams: [],
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [mixedUnit.id],
    },
    lessons: [],
    units: [mixedUnit],
    items: [recallConcept, qItem],
    tasks: [recallTask, choiceTask],
    resources: [],
    notes: [],
  };

  it("never draws the choice task, across 20 rng seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng: Rng = () => seed / 20;
      const pairs = buildRecallSession(mixedUnit, mixedContent, rng);
      expect(pairs.some((pair) => pair.question.kind === "choice")).toBe(false);
    }
  });

  it("recallableTaskIds of an all-question unit is []", () => {
    const allQuestionUnit: Unit = { ...mixedUnit, taskIds: [choiceTask.id] };
    expect(recallableTaskIds(allQuestionUnit, mixedContent)).toEqual([]);
  });
});
