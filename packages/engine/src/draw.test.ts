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

function contentWith(
  tasks: Task[],
  items = [1, 2, 3, 4].map((n) => concept(n)),
): Content {
  const unit: Unit = {
    id: "t-unit-1",
    lessonId: "t-lesson-1",
    title: "Unit",
    goal: "Goal",
    itemIds: items.map((i) => i.id),
    taskIds: tasks.map((t) => t.id),
    noteIds: [],
  };
  return {
    topics: [],
    lessons: [],
    units: [unit],
    items,
    tasks,
    notes: [],
    resources: [],
  } as unknown as Content;
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

  it("returns null when no authored task backs the exercise", () => {
    const content = contentWith([]);
    expect(
      buildExerciseQuestion(unitOf(concept(1)), "matching", content, first),
    ).toBeNull();
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
