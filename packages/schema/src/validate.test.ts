import { describe, it, expect } from "vitest";
import { validateContent, type ValidateContentResult } from "./validate.js";

type ConceptItemLike = {
  id: string;
  kind: "concept";
  payload: {
    term: string;
    definition: string;
    audioRef?: string;
    imageRef?: string;
  };
  sourceRef: string;
};
type LexemeItemLike = {
  id: string;
  kind: "lexeme";
  payload: {
    script: string;
    transliteration: string;
    gloss: string;
    audioRef?: string;
    imageRef?: string;
  };
  sourceRef: string;
};
type SentenceItemLike = {
  id: string;
  kind: "sentence";
  payload: { text: string; translation: string; audioRef?: string };
  sourceRef: string;
};
type PairItemLike = {
  id: string;
  kind: "pair";
  payload: {
    a: { script: string; audioRef: string };
    b: { script: string; audioRef: string };
    contrast: string;
  };
  sourceRef: string;
};
type ItemLike =
  ConceptItemLike | LexemeItemLike | SentenceItemLike | PairItemLike;
/** A task's `type` covers plan 0001's `recognize`/`recall` plus plan 0002's new types. */
type TaskLike = {
  id: string;
  type: string;
  itemIds: string[];
};

/**
 * Builds a fresh, fully valid fixture: topic "kyrgyz" (code "ky"), one unit
 * with 4 concept items with distinct definitions, one recognize task over
 * all 4, one recall task over 2 of them, one note stem, one resource. Every
 * item's sourceRef points at the resource. Returns both the raw input for
 * `validateContent` and handles to the individual entities so tests can seed
 * a single violation by mutating them.
 */
function makeFixture() {
  const resource = {
    id: "ky-resource-manual",
    title: "Kyrgyz Language Manual",
    path: "https://example.com/manual",
  };

  const itemA: ConceptItemLike = {
    id: "ky-item-a",
    kind: "concept",
    payload: { term: "А", definition: "Sound of A" },
    sourceRef: resource.id,
  };
  const itemB: ConceptItemLike = {
    id: "ky-item-b",
    kind: "concept",
    payload: { term: "Б", definition: "Sound of B" },
    sourceRef: resource.id,
  };
  const itemC: ConceptItemLike = {
    id: "ky-item-c",
    kind: "concept",
    payload: { term: "В", definition: "Sound of V" },
    sourceRef: resource.id,
  };
  const itemD: ConceptItemLike = {
    id: "ky-item-d",
    kind: "concept",
    payload: { term: "Г", definition: "Sound of G" },
    sourceRef: resource.id,
  };
  const items: ItemLike[] = [itemA, itemB, itemC, itemD];

  const taskRecognize: TaskLike = {
    id: "ky-task-recognize-1",
    type: "recognize",
    itemIds: [itemA.id, itemB.id, itemC.id, itemD.id],
  };
  const taskRecall: TaskLike = {
    id: "ky-task-recall-1",
    type: "recall",
    itemIds: [itemA.id, itemB.id],
  };

  const unit: {
    id: string;
    topicId: string;
    title: string;
    goal: string;
    itemIds: string[];
    taskIds: string[];
    noteIds: string[];
    unlocksAfterUnitId?: string;
  } = {
    id: "ky-unit-1",
    topicId: "kyrgyz",
    title: "Script and sound survival",
    goal: "recognize the Kyrgyz alphabet",
    itemIds: [itemA.id, itemB.id, itemC.id, itemD.id],
    taskIds: [taskRecognize.id, taskRecall.id],
    noteIds: ["ky-note-intro"],
  };

  const topic = {
    id: "kyrgyz",
    code: "ky",
    title: "Kyrgyz",
    description: "Kyrgyz language topic",
    unitIds: [unit.id],
  };

  const input = {
    topic,
    units: [unit],
    items,
    tasks: [taskRecognize, taskRecall],
    resources: [resource],
    noteStems: ["intro"],
    audioStems: [] as string[],
    imageStems: [] as string[],
  };

  return {
    input,
    topic,
    unit,
    itemA,
    itemB,
    itemC,
    itemD,
    taskRecognize,
    taskRecall,
    resource,
  };
}

/** Replaces the first occurrence of `oldId` with `newId` in-place. */
function renameId(ids: string[], oldId: string, newId: string): void {
  const index = ids.indexOf(oldId);
  if (index !== -1) {
    ids[index] = newId;
  }
}

function expectErrors(result: ValidateContentResult): string[] {
  if ("content" in result) {
    throw new Error("expected validation errors, got valid content");
  }
  return result.errors;
}

describe("validateContent", () => {
  it("accepts a valid fixture and derives notes from noteStems", () => {
    const { input } = makeFixture();

    const result = validateContent(input);

    if ("errors" in result) {
      throw new Error(
        `expected valid content, got errors: ${result.errors.join("; ")}`,
      );
    }
    expect(result.content.notes).toEqual([
      { id: "ky-note-intro", stem: "intro" },
    ]);
    expect(result.content.topic.id).toBe("kyrgyz");
    expect(result.content.units).toHaveLength(1);
    expect(result.content.items).toHaveLength(4);
    expect(result.content.tasks).toHaveLength(2);
    expect(result.content.resources).toHaveLength(1);
  });

  it("(a) reports a dangling sourceRef", () => {
    const { input, itemA } = makeFixture();
    itemA.sourceRef = "ky-resource-missing";

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-a"))).toBe(true);
  });

  it("(a) reports a dangling taskIds entry", () => {
    const { input, unit } = makeFixture();
    unit.taskIds.push("ky-task-missing");

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-missing"))).toBe(true);
  });

  it("(b) reports a bad slug", () => {
    const { input, itemA } = makeFixture();
    itemA.id = "Ky_Item_A";

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("Ky_Item_A"))).toBe(true);
  });

  it("(c) reports a missing <code>- prefix", () => {
    const { input, itemA, unit, taskRecognize, taskRecall } = makeFixture();
    const oldId = itemA.id;
    itemA.id = "other-item-a";
    renameId(unit.itemIds, oldId, itemA.id);
    renameId(taskRecognize.itemIds, oldId, itemA.id);
    renameId(taskRecall.itemIds, oldId, itemA.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("other-item-a"))).toBe(true);
  });

  it("(d) reports an orphaned item", () => {
    const { input } = makeFixture();
    input.items.push({
      id: "ky-item-orphan",
      kind: "concept",
      payload: { term: "Д", definition: "Sound of D (extra)" },
      sourceRef: "ky-resource-manual",
    });

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-orphan"))).toBe(true);
  });

  it("(d) reports a doubly-owned item", () => {
    const { input, unit, itemA } = makeFixture();
    unit.itemIds.push(itemA.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-a"))).toBe(true);
  });

  it("(e) reports mixed-kind task items", () => {
    const { input, unit, itemA } = makeFixture();
    const lexemeItem: LexemeItemLike = {
      id: "ky-item-lex",
      kind: "lexeme",
      payload: { script: "аа", transliteration: "aa", gloss: "double a" },
      sourceRef: "ky-resource-manual",
    };
    input.items.push(lexemeItem);
    unit.itemIds.push(lexemeItem.id);
    const mixedTask = {
      id: "ky-task-mixed",
      type: "recall",
      itemIds: [itemA.id, lexemeItem.id],
    };
    input.tasks.push(mixedTask);
    unit.taskIds.push(mixedTask.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-mixed"))).toBe(true);
  });

  it("(f) reports a task item not owned by the task's unit", () => {
    const { input, taskRecall } = makeFixture();
    input.items.push({
      id: "ky-item-outsider",
      kind: "concept",
      payload: { term: "Е", definition: "Sound of E (outsider)" },
      sourceRef: "ky-resource-manual",
    });
    taskRecall.itemIds.push("ky-item-outsider");

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-outsider"))).toBe(true);
  });

  it("(g) reports a recognize task whose owning unit has fewer than 4 items of its kind", () => {
    const { input, unit, taskRecognize, itemD } = makeFixture();
    input.items = input.items.filter((item) => item.id !== itemD.id);
    unit.itemIds = unit.itemIds.filter((id) => id !== itemD.id);
    taskRecognize.itemIds = taskRecognize.itemIds.filter(
      (id) => id !== itemD.id,
    );

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-recognize-1"))).toBe(true);
  });

  it("(h) reports a duplicate definition within a unit", () => {
    const { input, itemA, itemB } = makeFixture();
    itemB.payload.definition = itemA.payload.definition;

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-b"))).toBe(true);
  });

  it("(i) reports a unit with zero tasks", () => {
    const { input, unit } = makeFixture();
    unit.taskIds = [];

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-unit-1"))).toBe(true);
  });

  it("(j) reports a duplicate item id with distinct payloads", () => {
    const { input } = makeFixture();
    input.items.push({
      id: "ky-item-a",
      kind: "concept",
      payload: { term: "Ə", definition: "A completely different sound" },
      sourceRef: "ky-resource-manual",
    });

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-a"))).toBe(true);
  });

  it("(j) reports a duplicate task id", () => {
    const { input } = makeFixture();
    input.tasks.push({
      id: "ky-task-recall-1",
      type: "recall",
      itemIds: ["ky-item-c"],
    });

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-recall-1"))).toBe(true);
  });

  it("(j) reports a duplicate noteStems entry", () => {
    const { input } = makeFixture();
    input.noteStems.push("intro");

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-note-intro"))).toBe(true);
  });

  it("(k) reports a duplicate entry in a task's itemIds", () => {
    const { input, taskRecall, itemA } = makeFixture();
    taskRecall.itemIds.push(itemA.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-recall-1"))).toBe(true);
  });

  it("(k) reports a duplicate entry in topic.unitIds", () => {
    const { input, topic, unit } = makeFixture();
    topic.unitIds.push(unit.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("topic.unitIds"))).toBe(true);
  });

  it("(l) reports a unit whose unlocksAfterUnitId is itself", () => {
    const { input, unit } = makeFixture();
    unit.unlocksAfterUnitId = unit.id;

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-unit-1"))).toBe(true);
  });

  it("(l) reports a 2-unit unlocksAfterUnitId cycle", () => {
    const { input, topic, unit } = makeFixture();
    const itemE: ConceptItemLike = {
      id: "ky-item-e",
      kind: "concept",
      payload: { term: "Д", definition: "Sound of D" },
      sourceRef: "ky-resource-manual",
    };
    const task2 = {
      id: "ky-task-recall-2",
      type: "recall",
      itemIds: [itemE.id],
    };
    const unit2 = {
      id: "ky-unit-2",
      topicId: "kyrgyz",
      title: "Second unit",
      goal: "second goal",
      itemIds: [itemE.id],
      taskIds: [task2.id],
      noteIds: [] as string[],
      unlocksAfterUnitId: unit.id as string | undefined,
    };
    input.items.push(itemE);
    input.tasks.push(task2);
    input.units.push(unit2);
    topic.unitIds.push(unit2.id);
    unit.unlocksAfterUnitId = unit2.id;

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-unit-1"))).toBe(true);
    expect(errors.some((e) => e.includes("ky-unit-2"))).toBe(true);
  });

  it("(m) reports invalid cloze markup (Anki's ::hint suffix is unsupported)", () => {
    const { input, unit, resource } = makeFixture();
    const badSentence: SentenceItemLike = {
      id: "ky-item-sentence-bad",
      kind: "sentence",
      payload: {
        text: "Hello {{c1::world::hint}}.",
        translation: "Hello world.",
      },
      sourceRef: resource.id,
    };
    input.items.push(badSentence);
    unit.itemIds.push(badSentence.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-sentence-bad"))).toBe(true);
  });

  it("(m) reports unclosed cloze markup, even on an item of a non-cloze task", () => {
    const { input, unit, resource } = makeFixture();
    const badSentence: SentenceItemLike = {
      id: "ky-item-sentence-unclosed",
      kind: "sentence",
      payload: {
        text: "say {{c1::hi}",
        translation: "say hi",
      },
      sourceRef: resource.id,
    };
    input.items.push(badSentence);
    unit.itemIds.push(badSentence.id);

    const errors = expectErrors(validateContent(input));

    expect(
      errors.some(
        (e) =>
          e.includes("ky-item-sentence-unclosed") &&
          e.includes("invalid cloze markup"),
      ),
    ).toBe(true);
  });

  it("(m) reports an empty cloze blank (an empty typed answer would auto-grade correct)", () => {
    const { input, unit, resource } = makeFixture();
    const badSentence: SentenceItemLike = {
      id: "ky-item-sentence-empty-blank",
      kind: "sentence",
      payload: {
        text: "The {{c1::}} sat.",
        translation: "the cat sat",
      },
      sourceRef: resource.id,
    };
    input.items.push(badSentence);
    unit.itemIds.push(badSentence.id);

    const errors = expectErrors(validateContent(input));

    expect(
      errors.some(
        (e) =>
          e.includes("ky-item-sentence-empty-blank") &&
          e.includes("invalid cloze markup"),
      ),
    ).toBe(true);
  });

  it("(n) reports a dangling audioRef", () => {
    const { input, itemA } = makeFixture();
    itemA.payload.audioRef = "missing-audio";

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-item-a"))).toBe(true);
  });

  it("(o) reports a task/kind mismatch (a non-minimal-pair task over a pair item)", () => {
    const { input, unit, resource } = makeFixture();
    const pairItem: PairItemLike = {
      id: "ky-item-pair-1",
      kind: "pair",
      payload: {
        a: { script: "шым", audioRef: "shym" },
        b: { script: "чым", audioRef: "chym" },
        contrast: "ш vs ч",
      },
      sourceRef: resource.id,
    };
    input.items.push(pairItem);
    unit.itemIds.push(pairItem.id);
    input.audioStems.push("shym", "chym");
    const badTask: TaskLike = {
      id: "ky-task-recall-pair",
      type: "recall",
      itemIds: [pairItem.id],
    };
    input.tasks.push(badTask);
    unit.taskIds.push(badTask.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-recall-pair"))).toBe(true);
  });

  it("(p) reports a matching task with fewer than 2 items", () => {
    const { input, unit, itemA } = makeFixture();
    const matchingTask: TaskLike = {
      id: "ky-task-matching-1",
      type: "matching",
      itemIds: [itemA.id],
    };
    input.tasks.push(matchingTask);
    unit.taskIds.push(matchingTask.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-matching-1"))).toBe(true);
  });

  it("(q) reports a scramble item whose stripped text has fewer than 3 tokens", () => {
    const { input, unit, resource } = makeFixture();
    const shortSentence: SentenceItemLike = {
      id: "ky-item-sentence-short",
      kind: "sentence",
      payload: { text: "Hi there", translation: "Hi there" },
      sourceRef: resource.id,
    };
    input.items.push(shortSentence);
    unit.itemIds.push(shortSentence.id);
    const scrambleTask: TaskLike = {
      id: "ky-task-scramble-1",
      type: "scramble",
      itemIds: [shortSentence.id],
    };
    input.tasks.push(scrambleTask);
    unit.taskIds.push(scrambleTask.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-scramble-1"))).toBe(true);
  });

  it("(r) reports a listen task whose owning unit has fewer than 4 same-kind items", () => {
    const { input, unit, resource } = makeFixture();
    const sentenceItem: SentenceItemLike = {
      id: "ky-item-sentence-1",
      kind: "sentence",
      payload: {
        text: "One two three",
        translation: "One two three",
        audioRef: "s1",
      },
      sourceRef: resource.id,
    };
    input.items.push(sentenceItem);
    unit.itemIds.push(sentenceItem.id);
    input.audioStems.push("s1");
    const listenTask: TaskLike = {
      id: "ky-task-listen-1",
      type: "listen",
      itemIds: [sentenceItem.id],
    };
    input.tasks.push(listenTask);
    unit.taskIds.push(listenTask.id);

    const errors = expectErrors(validateContent(input));

    expect(errors.some((e) => e.includes("ky-task-listen-1"))).toBe(true);
  });
});
