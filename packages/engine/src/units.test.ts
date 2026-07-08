import { describe, it, expect } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import { schedulingUnits } from "./units.js";

const sharedSentence: Item = {
  id: "t-item-shared",
  kind: "sentence",
  payload: {
    text: "The {{c1::cat}} sat on the {{c2::mat}}.",
    translation: "translation",
    audioRef: "shared-audio",
  },
  sourceRef: "t-resource-1",
};

const clozeOnlySentence: Item = {
  id: "t-item-cloze-only",
  kind: "sentence",
  payload: { text: "A {{c1::single}} blank.", translation: "translation" },
  sourceRef: "t-resource-1",
};

const plainSentence: Item = {
  id: "t-item-plain",
  kind: "sentence",
  payload: { text: "No blanks here.", translation: "translation" },
  sourceRef: "t-resource-1",
};

const lexeme: Item = {
  id: "t-item-lexeme",
  kind: "lexeme",
  payload: { script: "Салам", transliteration: "Salam", gloss: "hello" },
  sourceRef: "t-resource-1",
};

const concept: Item = {
  id: "t-item-concept",
  kind: "concept",
  payload: { term: "Term", definition: "Definition" },
  sourceRef: "t-resource-1",
};

const pair: Item = {
  id: "t-item-pair",
  kind: "pair",
  payload: {
    a: { script: "шым", audioRef: "shym" },
    b: { script: "чым", audioRef: "chym" },
    contrast: "ш/ч",
  },
  sourceRef: "t-resource-1",
};

const clozeTask: Task = {
  id: "t-task-cloze",
  type: "cloze",
  itemIds: [sharedSentence.id, clozeOnlySentence.id],
};
const dictationTask: Task = {
  id: "t-task-dictation",
  type: "dictation",
  itemIds: [sharedSentence.id],
};
const scrambleTask: Task = {
  id: "t-task-scramble",
  type: "scramble",
  itemIds: [plainSentence.id],
};
const recallTask: Task = {
  id: "t-task-recall",
  type: "recall",
  itemIds: [lexeme.id, concept.id],
};
const minimalPairTask: Task = {
  id: "t-task-minimal-pair",
  type: "minimal-pair",
  itemIds: [pair.id],
};

const unit: Unit = {
  id: "t-unit-1",
  topicId: "t-topic",
  title: "Unit",
  goal: "Goal",
  itemIds: [
    sharedSentence.id,
    clozeOnlySentence.id,
    plainSentence.id,
    lexeme.id,
    concept.id,
    pair.id,
  ],
  taskIds: [
    clozeTask.id,
    dictationTask.id,
    scrambleTask.id,
    recallTask.id,
    minimalPairTask.id,
  ],
  noteIds: [],
};

const content: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    title: "Topic",
    description: "",
    unitIds: [unit.id],
  },
  units: [unit],
  items: [
    sharedSentence,
    clozeOnlySentence,
    plainSentence,
    lexeme,
    concept,
    pair,
  ],
  tasks: [clozeTask, dictationTask, scrambleTask, recallTask, minimalPairTask],
  resources: [],
  notes: [],
};

describe("schedulingUnits", () => {
  const units = schedulingUnits(content);
  const idsByItem = (itemId: string) =>
    units.filter((u) => u.item.id === itemId).map((u) => u.id);

  it("a sentence referenced by both a cloze task (2 blanks) and a non-cloze task yields both blank units and the item unit", () => {
    expect(idsByItem(sharedSentence.id).sort()).toEqual(
      [
        `${sharedSentence.id}::c1`,
        `${sharedSentence.id}::c2`,
        sharedSentence.id,
      ].sort(),
    );
  });

  it("a cloze-only sentence yields only its blank unit", () => {
    expect(idsByItem(clozeOnlySentence.id)).toEqual([
      `${clozeOnlySentence.id}::c1`,
    ]);
  });

  it("a plain sentence referenced only by a non-cloze task yields only the item unit", () => {
    expect(idsByItem(plainSentence.id)).toEqual([plainSentence.id]);
  });

  it("lexeme, concept, and pair items yield the item unit", () => {
    expect(idsByItem(lexeme.id)).toEqual([lexeme.id]);
    expect(idsByItem(concept.id)).toEqual([concept.id]);
    expect(idsByItem(pair.id)).toEqual([pair.id]);
  });

  it("blank units carry their blank number", () => {
    const c1Unit = units.find((u) => u.id === `${sharedSentence.id}::c1`);
    const c2Unit = units.find((u) => u.id === `${sharedSentence.id}::c2`);
    expect(c1Unit?.blankNumber).toBe(1);
    expect(c2Unit?.blankNumber).toBe(2);
  });
});
