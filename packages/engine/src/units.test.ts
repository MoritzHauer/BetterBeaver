import { describe, it, expect } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import { domainSchedulingUnits, schedulingUnits } from "./units.js";

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
    domainId: "t",
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

describe("domainSchedulingUnits", () => {
  // A second topic of the same domain, referencing the same `lexeme` entry
  // (shared vocabulary) plus a unit-less lexicon entry the topic never uses.
  const otherLexeme: Item = {
    id: "t-item-other-lexeme",
    kind: "lexeme",
    payload: { script: "Ооба", transliteration: "Ooba", gloss: "yes" },
    sourceRef: "t-resource-1",
  };
  const otherUnit: Unit = {
    id: "t-unit-2",
    topicId: "t-topic-2",
    title: "Unit 2",
    goal: "Goal",
    itemIds: [lexeme.id, otherLexeme.id],
    taskIds: ["t-task-recall-2"],
    noteIds: [],
  };
  const otherContent: Content = {
    topic: {
      id: "t-topic-2",
      code: "t",
      domainId: "t",
      title: "Topic 2",
      description: "",
      unitIds: [otherUnit.id],
    },
    units: [otherUnit],
    items: [lexeme, otherLexeme],
    tasks: [
      {
        id: "t-task-recall-2",
        type: "recall",
        itemIds: [lexeme.id, otherLexeme.id],
      },
    ],
    resources: [],
    notes: [],
  };
  const unreferencedEntry: Item = {
    id: "t-item-unreferenced",
    kind: "lexeme",
    payload: { script: "Жок", transliteration: "Jok", gloss: "no" },
    sourceRef: "t-resource-1",
  };

  const units = domainSchedulingUnits(
    [content, otherContent],
    [lexeme, otherLexeme, unreferencedEntry],
  );
  const idsByItem = (itemId: string) =>
    units.filter((u) => u.item.id === itemId).map((u) => u.id);

  it("unions scheduling units across every topic of the domain", () => {
    expect(idsByItem(sharedSentence.id).sort()).toEqual(
      [
        `${sharedSentence.id}::c1`,
        `${sharedSentence.id}::c2`,
        sharedSentence.id,
      ].sort(),
    );
    expect(idsByItem(otherLexeme.id)).toEqual([otherLexeme.id]);
  });

  it("an entry referenced by two topics is one unit, not two (deduplicated by scheduling-unit id)", () => {
    expect(idsByItem(lexeme.id)).toEqual([lexeme.id]);
  });

  it("adds one unit per lexicon entry referenced by no topic", () => {
    expect(idsByItem(unreferencedEntry.id)).toEqual([unreferencedEntry.id]);
  });

  it("does not add an unreferenced-entry unit for an entry already covered by a topic", () => {
    // lexeme and otherLexeme are both referenced by a topic above, so the
    // unreferenced-entries pass must not duplicate them.
    expect(units.filter((u) => u.id === lexeme.id)).toHaveLength(1);
    expect(units.filter((u) => u.id === otherLexeme.id)).toHaveLength(1);
  });
});
