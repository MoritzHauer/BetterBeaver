import { describe, it, expect } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import {
  buildTaskSession,
  buildReviewSession,
  buildUnitSession,
  checkScrambleAnswer,
  checkMatchingPair,
  matchingOutcomes,
  countUnitQuestions,
  type MatchingQuestion,
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
  it("reuses the pinned shuffle-and-insert distractor algorithm over display texts, prompted by the image stem", () => {
    const rng = queueRng([0.9, 0.1, 0.5]);
    const questions = buildTaskSession(pictureTask, pictureContent, rng);

    expect(questions).toEqual([
      {
        kind: "picture",
        unitId: imageL1.id,
        imageStem: "i1",
        choices: ["Gloss 3", "Gloss 2", "Gloss 1", "Gloss 4"],
        correctIndex: 2,
      },
    ]);
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
