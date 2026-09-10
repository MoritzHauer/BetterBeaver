import { describe, expect, it } from "vitest";
import type { Content, Exercise, Item, Task, Unit } from "@betterbeaver/schema";
import { availableExercises, drawExercise } from "./draw.js";
import { buildExerciseQuestion, buildVisitQuestion } from "./session.js";
import type { Rng } from "./rng.js";

/** Deterministic Rng: always picks the first element of a shuffle. */
const first: Rng = () => 0;

function concept(n: number, term = `Term ${n}`): Item {
  return {
    id: `t-item-c${n}`,
    kind: "concept",
    payload: { term, definition: `Definition ${n}` },
    sourceRef: "t-resource-1",
  };
}

/** A one-unit Book. `generatedExercises` is the plan 0026 §9 opt-in. */
function contentWith(
  tasks: Task[],
  items = [1, 2, 3, 4].map((n) => concept(n)),
  generatedExercises?: boolean,
  itemTargets?: Record<string, number>,
): Content {
  const unit: Unit = {
    id: "t-unit-1",
    lessonId: "t-lesson-1",
    title: "Unit",
    goal: "Goal",
    itemIds: items.map((i) => i.id),
    taskIds: tasks.map((t) => t.id),
    noteIds: [],
    ...(itemTargets !== undefined && { itemTargets }),
  };
  return {
    exams: [],
    topic: {
      id: "t",
      code: "t",
      title: "Book",
      description: "",
      lessonIds: ["t-lesson-1"],
      domainId: "t",
      ...(generatedExercises !== undefined && { generatedExercises }),
    },
    lessons: [],
    units: [unit],
    items,
    tasks,
    notes: [],
    resources: [],
  };
}

const recognizeTask: Task = {
  id: "t-task-recognize",
  type: "recognize",
  itemIds: [1, 2, 3, 4].map((n) => `t-item-c${n}`),
};
const matchingTask: Task = {
  id: "t-task-matching",
  type: "matching",
  itemIds: [1, 2, 3, 4].map((n) => `t-item-c${n}`),
};

describe("availableExercises", () => {
  it("collects what the unit's tasks authorize", () => {
    const content = contentWith([matchingTask]);
    const found = availableExercises(concept(1), content);
    expect(found).toContain("matching");
    expect(found).not.toContain("scramble");
  });

  it("derives write from any lexeme or concept, with no authored task", () => {
    // The point of §9: level 9 has to be reachable on already-published
    // content, which could not have authored a task type that did not exist.
    const found = availableExercises(concept(1), contentWith([]));
    expect(found).toEqual(["write"]);
  });

  it("offers both recognize directions from one authored recognize task", () => {
    const found = availableExercises(concept(1), contentWith([recognizeTask]));
    expect(found).toContain("recognize");
    expect(found).toContain("recognize-produce");
  });

  it("withholds the produce direction when a sibling shares its prompt", () => {
    // Class (h) guarantees distinct display texts, not distinct prompts, so
    // this is valid published content — and an ambiguous produce-direction
    // MCQ, since both items answer to the same prompt.
    const items = [
      concept(1, "Same"),
      concept(2, "Same"),
      concept(3),
      concept(4),
    ];
    const content = contentWith([recognizeTask], items);
    const found = availableExercises(items[0]!, content);
    expect(found).toContain("recognize");
    expect(found).not.toContain("recognize-produce");
  });

  it("never offers shadowing, which checks nothing", () => {
    const shadowing: Task = {
      id: "t-task-shadowing",
      type: "shadowing",
      itemIds: ["t-item-c1"],
    };
    expect(
      availableExercises(concept(1), contentWith([shadowing])),
    ).not.toContain("shadowing");
  });
});

describe("drawExercise", () => {
  const all: Exercise[] = [
    "matching",
    "recognize",
    "recognize-produce",
    "recall",
    "write",
  ];

  it("asks a new word at level 1 for its new attempt", () => {
    expect(drawExercise(0, "new", all, first)).toBe("matching");
  });

  it("asks exactly one level above for a new attempt", () => {
    expect(drawExercise(1, "new", all, first)).toBe("recognize");
    expect(drawExercise(3, "new", all, first)).toBe("recognize-produce");
  });

  it("skips a level the content cannot build rather than stalling", () => {
    // No audio anywhere, so nothing sits at level 3. A word at level 2 must
    // still be able to climb, or 100% is unreachable on every Book today.
    expect(drawExercise(2, "new", all, first)).toBe("recognize-produce");
  });

  it("draws a repetition from the level below or the level itself", () => {
    const drawn = new Set<Exercise | null>();
    for (const r of [0, 0.99]) {
      drawn.add(drawExercise(2, "repetition", all, () => r));
    }
    expect([...drawn].every((e) => e === "matching" || e === "recognize")).toBe(
      true,
    );
  });

  it("falls back below the window when the content has a gap there", () => {
    const sparse: Exercise[] = ["matching"];
    expect(drawExercise(6, "repetition", sparse, first)).toBe("matching");
  });

  it("returns null when the content can build nothing", () => {
    expect(drawExercise(3, "new", [], first)).toBeNull();
  });

  it("stays at the hardest available exercise once the ladder runs out", () => {
    expect(drawExercise(10, "new", all, first)).toBe("write");
  });
});

describe("buildExerciseQuestion", () => {
  const unitOf = (item: Item) => ({ id: item.id, item });

  it("builds the produce direction with foreign-side choices", () => {
    // The mirror of `recognize`: the meaning prompts, and every option is a
    // form. This is the exercise plan 0002 claimed was already covered.
    const content = contentWith([recognizeTask]);
    const q = buildExerciseQuestion(
      unitOf(concept(1)),
      "recognize-produce",
      content,
      first,
    );
    expect(q?.kind).toBe("recognize");
    if (q?.kind !== "recognize")
      throw new Error("expected a recognize question");
    expect(q.prompt).toBe("Definition 1");
    expect(q.choices[q.correctIndex]).toBe("Term 1");
  });

  it("builds write from an item with no authored task at all", () => {
    const q = buildExerciseQuestion(
      unitOf(concept(1)),
      "write",
      contentWith([]),
      first,
    );
    expect(q).toEqual({
      kind: "write",
      unitId: "t-item-c1",
      prompt: "Definition 1",
      target: "Term 1",
    });
  });

  it("refuses write for a sentence — that is dictation without the audio", () => {
    const sentence: Item = {
      id: "t-item-s1",
      kind: "sentence",
      payload: {
        text: "Beavers gnaw trees.",
        translation: "Beavers gnaw trees.",
      },
      sourceRef: "t-resource-1",
    };
    const content = contentWith([], [sentence]);
    expect(
      buildExerciseQuestion(unitOf(sentence), "write", content, first),
    ).toBeNull();
  });

  it("constructs the exercise when no authored task backs it", () => {
    // Plan 0026 slice 2: the builder answers for a cell nobody authored.
    // It is not gated on the Book's opt-in — the *draw* is (see
    // `availableExercises`), so a Book that has not opted in never asks;
    // asking directly is what the author's coverage preview does (§8).
    const content = contentWith([]);
    const q = buildExerciseQuestion(
      unitOf(concept(1)),
      "matching",
      content,
      first,
    );
    expect(q?.kind).toBe("matching");
  });

  it("gives a constructed MCQ real distractors from the item's own unit", () => {
    // The synthetic task is listed by no unit, so without `owningUnitOf`'s
    // fallback this board would be one choice long.
    const q = buildExerciseQuestion(
      unitOf(concept(1)),
      "recognize",
      contentWith([]),
      first,
    );
    expect(q?.kind).toBe("recognize");
    expect(q?.kind === "recognize" && q.choices).toHaveLength(4);
  });

  it("caps a constructed board at the five class (p) allows", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => concept(n));
    const q = buildExerciseQuestion(
      unitOf(many[0]!),
      "matching",
      contentWith([], many),
      first,
    );
    expect(q?.kind === "matching" && q.prompts).toHaveLength(5);
  });

  it("keeps a constructed cloze on the word the caller planned", () => {
    // §2: a constructed exercise mints no scheduling unit. Without this the
    // question would grade `<itemId>::c1`, a blank id only an *authored*
    // cloze task creates — and the drill would credit a word it never
    // planned, stalling the session.
    const sentence: Item = {
      id: "t-item-s2",
      kind: "sentence",
      payload: {
        text: "Beavers {{c1::gnaw}} trees.",
        translation: "Beavers gnaw trees.",
      },
      sourceRef: "t-resource-1",
    };
    const q = buildExerciseQuestion(
      unitOf(sentence),
      "cloze",
      contentWith([], [sentence]),
      first,
    );
    expect(q?.kind).toBe("cloze");
    expect(q?.kind === "cloze" && q.unitId).toBe("t-item-s2");
  });

  it("leaves an authored cloze minting its blank id", () => {
    const sentence: Item = {
      id: "t-item-s3",
      kind: "sentence",
      payload: {
        text: "Beavers {{c1::gnaw}} trees.",
        translation: "Beavers gnaw trees.",
      },
      sourceRef: "t-resource-1",
    };
    const task: Task = {
      id: "t-task-cloze",
      type: "cloze",
      itemIds: [sentence.id],
    };
    const q = buildExerciseQuestion(
      unitOf(sentence),
      "cloze",
      contentWith([task], [sentence]),
      first,
    );
    expect(q?.kind === "cloze" && q.unitId).toBe("t-item-s3::c1");
  });
});

describe("availableExercises, opted in (plan 0026 slice 2)", () => {
  it("changes nothing for a Book that has not opted in", () => {
    // Phase 1's promise: every existing Book behaves exactly as before.
    const content = contentWith([matchingTask]);
    expect(availableExercises(concept(1), content)).toEqual(
      availableExercises(
        concept(1),
        contentWith([matchingTask], undefined, false),
      ),
    );
    expect(availableExercises(concept(1), content)).not.toContain("recognize");
  });

  it("unions in what the constructor can build once opted in", () => {
    const found = availableExercises(
      concept(1),
      contentWith([matchingTask], undefined, true),
    );
    expect(found).toContain("matching");
    expect(found).toContain("recognize");
    expect(found).toContain("recall");
  });

  it("gives an item no task mentions a full ladder, with no other edit", () => {
    // The plan's second goal, and the end of index rot: adding an item to a
    // unit is sufficient.
    const items = [1, 2, 3, 4].map((n) => concept(n));
    const taskOverOne: Task = {
      id: "t-task-recall-one",
      type: "recall",
      itemIds: [items[0]!.id],
    };
    const found = availableExercises(
      items[3]!,
      contentWith([taskOverOne], items, true),
    );
    expect([...found].sort()).toEqual(
      ["matching", "recall", "recognize", "recognize-produce", "write"].sort(),
    );
  });

  it("lets one authored board keep its cell without costing the rest theirs", () => {
    // The done-criterion the retired per-type rule got wrong: a board over
    // five of a unit's items must not switch off level 1 for the others.
    const items = Array.from({ length: 8 }, (_, i) => concept(i + 1));
    const board: Task = {
      id: "t-task-matching-five",
      type: "matching",
      itemIds: items.slice(0, 5).map((i) => i.id),
    };
    const content = contentWith([board], items, true);
    for (const item of items.slice(5)) {
      expect(availableExercises(item, content)).toContain("matching");
      expect(
        drawExercise(0, "new", availableExercises(item, content), first),
      ).toBe("matching");
    }
  });
});

describe("availableExercises and item targets (plan 0026 §5)", () => {
  it("caps an authored task the unit's target contradicts", () => {
    // A `recall` task sits at level 8 and `write` at 9. Capping the word at
    // 2 means the author said how far it goes, and the cap is the more
    // specific statement — so neither survives once something at or below
    // the cap exists to ask instead.
    const recallTask: Task = {
      id: "t-task-recall",
      type: "recall",
      itemIds: [1, 2, 3, 4].map((n) => `t-item-c${n}`),
    };
    const found = availableExercises(
      concept(1),
      contentWith([recallTask], undefined, true, { "t-item-c1": 2 }),
    );
    expect(found).not.toContain("recall");
    expect(found).not.toContain("write");
    expect(found).toContain("recognize");
  });

  it("still asks a capped word the content cannot reach at its cap", () => {
    // Authored `recall`/`write` only, construction off, capped at 2: nothing
    // at or below the cap exists. Silence would leave the word undrilled and
    // the session short, so the easiest available exercise survives the cap
    // — and the coverage grid is where the author sees the contradiction.
    const recallTask: Task = {
      id: "t-task-recall",
      type: "recall",
      itemIds: [1, 2, 3, 4].map((n) => `t-item-c${n}`),
    };
    expect(
      availableExercises(
        concept(1),
        contentWith([recallTask], undefined, undefined, { "t-item-c1": 2 }),
      ),
    ).toEqual(["recall"]);
  });

  it("leaves an uncapped sibling alone", () => {
    const recallTask: Task = {
      id: "t-task-recall",
      type: "recall",
      itemIds: [1, 2, 3, 4].map((n) => `t-item-c${n}`),
    };
    const found = availableExercises(
      concept(2),
      contentWith([recallTask], undefined, true, { "t-item-c1": 2 }),
    );
    expect(found).toContain("recall");
    expect(found).toContain("write");
  });

  it("never draws above the target", () => {
    const content = contentWith([matchingTask], undefined, true, {
      "t-item-c1": 2,
    });
    const available = availableExercises(concept(1), content);
    // The `new` slot at a level already at the ceiling falls back to the
    // hardest thing available — which is now the target, not the ladder top.
    expect(drawExercise(9, "new", available, first)).toBe("recognize");
  });
});

describe("buildVisitQuestion", () => {
  const levelZero = () => 0;
  const visit = (
    unitId: string,
    slot: "new" | "repetition" = "new",
    levelOffset = 0,
  ) => ({
    unitId,
    slot,
    levelOffset,
  });

  it("builds the visit's word at the level the draw picks", () => {
    const content = contentWith([recognizeTask, matchingTask]);
    const unit = content.units[0]!;
    const built = buildVisitQuestion(
      visit("t-item-c1"),
      unit,
      content,
      levelZero,
      first,
    );
    // Level 0's new attempt is level 1, which is the board.
    expect(built?.question.kind).toBe("matching");
  });

  it("asks a word at level 8 to write it — the derived level 9", () => {
    const content = contentWith([recognizeTask]);
    const unit = content.units[0]!;
    const built = buildVisitQuestion(
      visit("t-item-c1"),
      unit,
      content,
      () => 8,
      first,
    );
    expect(built?.question.kind).toBe("write");
  });

  it("reads a word back down when the session already knocked it lower", () => {
    // levelOffset is how far a miss has pushed the word within this session
    // (plan 0025 §6): the draw must see the lowered level, or a learner who
    // just failed gets the same difficulty straight back.
    const content = contentWith([recognizeTask]);
    const unit = content.units[0]!;
    const lowered = buildVisitQuestion(
      visit("t-item-c1", "repetition", -3),
      unit,
      content,
      () => 8,
      first,
    );
    expect(lowered?.question.kind).not.toBe("write");
  });

  it("skips the board for a word one already answered for", () => {
    const content = contentWith([recognizeTask, matchingTask]);
    const unit = content.units[0]!;
    const built = buildVisitQuestion(
      visit("t-item-c1"),
      unit,
      content,
      levelZero,
      first,
      new Set(["t-item-c1"]),
    );
    expect(built?.question.kind).not.toBe("matching");
  });

  it("tags every question with a task from the unit, for pinning and edit", () => {
    const content = contentWith([recognizeTask]);
    const unit = content.units[0]!;
    const built = buildVisitQuestion(
      visit("t-item-c1"),
      unit,
      content,
      () => 8,
      first,
    );
    // A `write` question is derived — no task authored it — but the tag
    // still has to point somewhere real in the unit.
    expect(unit.taskIds).toContain(built?.taskId);
  });

  it("returns null when the content can build nothing for the word", () => {
    const orphan: Item = {
      id: "t-item-s9",
      kind: "sentence",
      payload: { text: "Nothing references this.", translation: "..." },
      sourceRef: "t-resource-1",
    };
    const content = contentWith([], [orphan]);
    const unit = content.units[0]!;
    expect(
      buildVisitQuestion(visit("t-item-s9"), unit, content, levelZero, first),
    ).toBeNull();
  });
});
