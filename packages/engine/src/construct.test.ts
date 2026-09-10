import { describe, expect, it } from "vitest";
import type { Content, Item, Task, Unit } from "@betterbeaver/schema";
import {
  constructibleExercises,
  exerciseAtLevel,
  itemCoverage,
  targetLevel,
} from "./construct.js";

function concept(n: number, term = `Term ${n}`): Item {
  return {
    id: `t-item-c${n}`,
    kind: "concept",
    payload: { term, definition: `Definition ${n}` },
    sourceRef: "t-resource-1",
  };
}

function lexeme(
  n: number,
  extra: { audioRef?: string; imageRef?: string } = {},
): Item {
  return {
    id: `t-item-l${n}`,
    kind: "lexeme",
    payload: {
      script: `Скрипт ${n}`,
      transliteration: `Translit ${n}`,
      gloss: `Gloss ${n}`,
      ...extra,
    },
    sourceRef: "t-resource-1",
  };
}

function sentence(n: number, text: string, audioRef?: string): Item {
  return {
    id: `t-item-s${n}`,
    kind: "sentence",
    payload: { text, translation: `Translation ${n}`, audioRef },
    sourceRef: "t-resource-1",
  };
}

function pair(n: number): Item {
  return {
    id: `t-item-p${n}`,
    kind: "pair",
    payload: {
      a: { script: "дам", audioRef: `dam-${n}` },
      b: { script: "дад", audioRef: `dad-${n}` },
      contrast: "m vs d",
    },
    sourceRef: "t-resource-1",
  };
}

function contentWith(
  items: Item[],
  tasks: Task[] = [],
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

/** Four same-kind concepts: the MCQ floor exactly met. */
const fourConcepts = [1, 2, 3, 4].map((n) => concept(n));

describe("constructibleExercises", () => {
  it("builds a full ladder rung set for a word with same-kind siblings", () => {
    // The plan's core claim: a unit with items and *zero* authored tasks can
    // still be asked across the ladder.
    const found = constructibleExercises(concept(1), contentWith(fourConcepts));
    expect(found).toEqual([
      "matching",
      "recognize",
      "recognize-produce",
      "recall",
      "write",
    ]);
  });

  it("orders what it finds by level, lowest first", () => {
    const found = constructibleExercises(concept(1), contentWith(fourConcepts));
    expect(found[0]).toBe("matching");
    expect(found.at(-1)).toBe("write");
  });

  it("never offers shadowing, which is unranked", () => {
    // Unranked means it can neither be a level nor confirm one, so
    // constructing it would only ever cost an appearance.
    const found = constructibleExercises(concept(1), contentWith(fourConcepts));
    expect(found).not.toContain("shadowing");
  });

  it("withholds the MCQ exercises below class (g)/(r)'s floor", () => {
    // Three same-kind items in the unit: the floor is four. A gate, not an
    // error (§7) — the word keeps everything the floor does not govern.
    const three = [1, 2, 3].map((n) => concept(n));
    const found = constructibleExercises(concept(1), contentWith(three));
    expect(found).not.toContain("recognize");
    expect(found).not.toContain("recognize-produce");
    expect(found).toContain("matching");
    expect(found).toContain("recall");
  });

  it("withholds matching from a lone item, which has no second card", () => {
    const found = constructibleExercises(concept(1), contentWith([concept(1)]));
    expect(found).not.toContain("matching");
    expect(found).toEqual(["recall", "write"]);
  });

  it("withholds matching from a sibling that reads the same on the prompt side", () => {
    // Class (p) forbids two identical prompt cards on one board, so a
    // same-prompt sibling is no sibling here.
    const items = [concept(1, "Same"), concept(2, "Same")];
    expect(constructibleExercises(items[0]!, contentWith(items))).not.toContain(
      "matching",
    );
  });

  it("withholds the produce direction when a sibling shares its prompt", () => {
    const items = [
      concept(1, "Same"),
      concept(2, "Same"),
      concept(3),
      concept(4),
    ];
    const found = constructibleExercises(items[0]!, contentWith(items));
    expect(found).toContain("recognize");
    expect(found).not.toContain("recognize-produce");
  });

  it("offers listen and dictation only where the item carries audio", () => {
    const withAudio = [1, 2, 3, 4].map((n) =>
      lexeme(n, { audioRef: `audio-${n}` }),
    );
    expect(
      constructibleExercises(withAudio[0]!, contentWith(withAudio)),
    ).toContain("listen");
    const without = [1, 2, 3, 4].map((n) => lexeme(n));
    expect(
      constructibleExercises(without[0]!, contentWith(without)),
    ).not.toContain("listen");
  });

  it("offers picture only where the item carries an image", () => {
    const withImage = [1, 2, 3, 4].map((n) =>
      lexeme(n, { imageRef: `pic-${n}` }),
    );
    expect(
      constructibleExercises(withImage[0]!, contentWith(withImage)),
    ).toContain("picture");
  });

  it("builds a sentence's production ladder from its own text", () => {
    // scramble/build come from the token count, cloze from the markup, and
    // dictation from the audio — all of them item data, per the plan's table.
    const item = sentence(1, "Кыз {{c1::китеп}} окуйт", "gnaw");
    const found = constructibleExercises(item, contentWith([item]));
    expect(found).toEqual([
      "scramble",
      "build",
      "cloze",
      "recall",
      "dictation",
    ]);
  });

  it("withholds scramble and build below class (q)'s token floor", () => {
    const item = sentence(1, "Салам досум");
    const found = constructibleExercises(item, contentWith([item]));
    expect(found).not.toContain("scramble");
    expect(found).not.toContain("build");
  });

  it("withholds cloze from a sentence with no blanks", () => {
    const item = sentence(1, "Кыз китеп окуйт");
    expect(constructibleExercises(item, contentWith([item]))).not.toContain(
      "cloze",
    );
  });

  it("gives a pair item exactly its own exercise", () => {
    const item = pair(1);
    expect(constructibleExercises(item, contentWith([item]))).toEqual([
      "minimal-pair",
    ]);
  });

  it("never offers write for a sentence or a pair", () => {
    const item = sentence(1, "Кыз китеп окуйт");
    expect(constructibleExercises(item, contentWith([item]))).not.toContain(
      "write",
    );
  });

  it("finds nothing for an item its content does not own", () => {
    // No owning unit means no sibling pool; only the item's own payload can
    // still carry an exercise, and a concept's payload carries recall/write.
    const orphan = concept(9);
    const found = constructibleExercises(orphan, contentWith(fourConcepts));
    expect(found).toEqual(["recall", "write"]);
  });
});

describe("exerciseAtLevel", () => {
  it("answers the cell the draw asks for", () => {
    const content = contentWith(fourConcepts);
    expect(exerciseAtLevel(concept(1), 1, content)).toBe("matching");
    expect(exerciseAtLevel(concept(1), 2, content)).toBe("recognize");
    expect(exerciseAtLevel(concept(1), 4, content)).toBe("recognize-produce");
    expect(exerciseAtLevel(concept(1), 8, content)).toBe("recall");
    expect(exerciseAtLevel(concept(1), 9, content)).toBe("write");
  });

  it("returns null for a level this content cannot build", () => {
    // No audio anywhere, so level 3 is a hole — which is exactly what
    // `drawExercise`'s "a missing level is skipped, not waited for" consumes.
    expect(
      exerciseAtLevel(concept(1), 3, contentWith(fourConcepts)),
    ).toBeNull();
    expect(
      exerciseAtLevel(concept(1), 10, contentWith(fourConcepts)),
    ).toBeNull();
  });

  it("is a gate rather than an error below a floor", () => {
    const three = [1, 2, 3].map((n) => concept(n));
    expect(exerciseAtLevel(concept(1), 2, contentWith(three))).toBeNull();
    expect(exerciseAtLevel(concept(1), 8, contentWith(three))).toBe("recall");
  });
});

describe("itemCoverage", () => {
  it("reports one row per rung of the ladder", () => {
    const rows = itemCoverage(concept(1), contentWith(fourConcepts), []);
    expect(rows).toHaveLength(10);
    expect(rows[0]?.level).toBe(1);
    expect(rows.at(-1)?.level).toBe(10);
  });

  it("lets an authored task own its cell, and construction fill the rest", () => {
    // §3's rule, read one cell at a time: authoring matching does not cost
    // the item anything at the levels the board does not sit on.
    const rows = itemCoverage(concept(1), contentWith(fourConcepts), [
      "matching",
    ]);
    expect(rows[0]).toEqual({
      level: 1,
      authored: ["matching"],
      constructed: [],
      beyondTarget: false,
    });
    expect(rows[1]).toEqual({
      level: 2,
      authored: [],
      constructed: ["recognize"],
      beyondTarget: false,
    });
  });

  it("leaves a cell empty where neither authored nor constructed reaches", () => {
    const rows = itemCoverage(concept(1), contentWith(fourConcepts), []);
    expect(rows[2]).toEqual({
      level: 3,
      authored: [],
      constructed: [],
      beyondTarget: false,
    });
  });
});

describe("what construction guarantees (plan 0026 §7)", () => {
  it("reaches every item kind the app has today, at some level", () => {
    // Deliberate, and the point of §7 rather than a hole in it: `recall`
    // needs only the item's own two sides and `minimal-pair` *is* the pair
    // item, so "a unit item no exercise reaches at all" is unrepresentable
    // rather than merely rare — which is why validator class (ad) fires on
    // nothing today. It starts biting on the first kind that can fail to
    // build, and `canConstruct`'s positive kind guards are what force that
    // kind to say which rungs it can fill.
    const lone = concept(1);
    expect(constructibleExercises(lone, contentWith([lone]))).toContain(
      "recall",
    );

    const short = sentence(1, "Салам досум");
    expect(constructibleExercises(short, contentWith([short]))).toContain(
      "recall",
    );

    const p1 = pair(1);
    expect(constructibleExercises(p1, contentWith([p1]))).toEqual([
      "minimal-pair",
    ]);
  });

  it("finds nothing for a kind it has not been taught", () => {
    // What a future item kind looks like before its rungs are wired up.
    const unknown = { ...concept(1), kind: "future" } as unknown as Item;
    expect(constructibleExercises(unknown, contentWith([unknown]))).toEqual([]);
  });
});

describe("item targets (plan 0026 §5)", () => {
  it("defaults to the full ladder, so most items never set one", () => {
    const content = contentWith(fourConcepts);
    expect(targetLevel(concept(1), content)).toBe(10);
    expect(constructibleExercises(concept(1), content)).toContain("write");
  });

  it("stops a passive word at the level its unit meant it to reach", () => {
    // "Recognise this, do not produce it" — a teaching decision no learner
    // data can infer, which is why it is authored.
    const content = contentWith(fourConcepts, [], undefined, {
      "t-item-c1": 2,
    });
    expect(constructibleExercises(concept(1), content)).toEqual([
      "matching",
      "recognize",
    ]);
    expect(exerciseAtLevel(concept(1), 8, content)).toBeNull();
  });

  it("caps only the item it names", () => {
    const content = contentWith(fourConcepts, [], undefined, {
      "t-item-c1": 2,
    });
    expect(constructibleExercises(concept(2), content)).toContain("write");
  });

  it("leaves a word askable when the cap would silence it entirely", () => {
    // A target of 1 on a word whose unit cannot build a board is an authored
    // contradiction. Showing the easiest thing it *can* be asked as beats a
    // hole in the session; the grid is where the author sees the problem.
    const lone = concept(1);
    const content = contentWith([lone], [], undefined, { "t-item-c1": 1 });
    expect(constructibleExercises(lone, content)).toEqual(["recall"]);
  });

  it("marks the rungs above the target as out of reach, not as gaps", () => {
    const rows = itemCoverage(
      concept(1),
      contentWith(fourConcepts, [], undefined, { "t-item-c1": 2 }),
      [],
    );
    expect(rows[1]?.beyondTarget).toBe(false);
    expect(rows[2]?.beyondTarget).toBe(true);
    expect(rows[8]?.constructed).toEqual([]);
  });
});
