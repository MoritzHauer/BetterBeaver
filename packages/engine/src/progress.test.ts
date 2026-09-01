import { describe, it, expect } from "vitest";
import type { Content, Item, Lesson, Unit } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import { REVIEW_PACES } from "@betterbeaver/srs";
import {
  dueCountsByLesson,
  dueCountsByUnit,
  isUnitComplete,
  isUnitUnlocked,
  isLessonComplete,
  isLessonUnlocked,
  nextUnit,
  reviewQueue,
  applyGrade,
} from "./progress.js";
import type { SchedulingUnit } from "./units.js";

/** A card written by the level scheduler, at `level` on Balanced. The
 * level's own transitions are covered in `packages/srs`; what these tests
 * pin is how `applyGrade` and `reviewQueue` behave around them. */
function atLevel(level: number, due: string): SrsState {
  return {
    due,
    intervalDays: REVIEW_PACES.balanced[level]!,
    ease: 2.5,
    reps: level,
    levelDay: "2026-07-01",
  };
}

function makeUnit(overrides: Partial<Unit> & Pick<Unit, "id">): Unit {
  return {
    lessonId: "t-lesson",
    title: "Unit",
    goal: "Goal",
    itemIds: [],
    taskIds: [],
    noteIds: [],
    ...overrides,
  };
}

function makeLesson(overrides: Partial<Lesson> & Pick<Lesson, "id">): Lesson {
  return {
    topicId: "t-topic",
    title: "Lesson",
    goal: "Goal",
    unitIds: [],
    ...overrides,
  };
}

function makeContent(args: {
  lessonIds: string[];
  lessons: Lesson[];
  units: Unit[];
}): Content {
  return {
    topic: {
      id: "t-topic",
      code: "t",
      title: "Topic",
      description: "",
      lessonIds: args.lessonIds,
      domainId: "t-domain",
    },
    lessons: args.lessons,
    units: args.units,
    items: [],
    tasks: [],
    resources: [],
    notes: [],
  };
}

describe("isUnitComplete", () => {
  it("is false until every task of the unit has been attempted", () => {
    const unit = makeUnit({
      id: "t-unit-a",
      taskIds: ["t-task-1", "t-task-2"],
    });

    expect(isUnitComplete(unit, new Set())).toBe(false);
    expect(isUnitComplete(unit, new Set(["t-task-1"]))).toBe(false);
    expect(isUnitComplete(unit, new Set(["t-task-1", "t-task-2"]))).toBe(true);
  });
});

describe("isUnitUnlocked", () => {
  const unitA = makeUnit({ id: "t-unit-a", taskIds: ["t-task-1", "t-task-2"] });
  const unitB = makeUnit({
    id: "t-unit-b",
    taskIds: ["t-task-3"],
    unlocksAfterUnitId: "t-unit-a",
  });
  const units = [unitA, unitB];

  it("a unit without unlocksAfterUnitId is always unlocked", () => {
    expect(isUnitUnlocked(unitA, units, new Set())).toBe(true);
  });

  it("is locked when the gating unit's tasks are not all attempted", () => {
    expect(isUnitUnlocked(unitB, units, new Set())).toBe(false);
    expect(isUnitUnlocked(unitB, units, new Set(["t-task-1"]))).toBe(false);
  });

  it("is unlocked once every task of the gating unit is attempted", () => {
    expect(
      isUnitUnlocked(unitB, units, new Set(["t-task-1", "t-task-2"])),
    ).toBe(true);
  });

  it("defensively treats a missing gate unit as unlocked", () => {
    const orphan = makeUnit({
      id: "t-unit-c",
      unlocksAfterUnitId: "t-unit-missing",
    });
    expect(isUnitUnlocked(orphan, units, new Set())).toBe(true);
  });
});

describe("isLessonComplete", () => {
  it("is false until every unit of the lesson is complete", () => {
    const unitA = makeUnit({ id: "t-unit-a", taskIds: ["t-task-1"] });
    const unitB = makeUnit({ id: "t-unit-b", taskIds: ["t-task-2"] });
    const lesson = makeLesson({
      id: "t-lesson-a",
      unitIds: [unitA.id, unitB.id],
    });
    const units = [unitA, unitB];

    expect(isLessonComplete(lesson, units, new Set())).toBe(false);
    expect(isLessonComplete(lesson, units, new Set(["t-task-1"]))).toBe(false);
    expect(
      isLessonComplete(lesson, units, new Set(["t-task-1", "t-task-2"])),
    ).toBe(true);
  });
});

describe("isLessonUnlocked", () => {
  const lessonUnitA = makeUnit({ id: "t-unit-a", taskIds: ["t-task-1"] });
  const lessonA = makeLesson({
    id: "t-lesson-a",
    unitIds: [lessonUnitA.id],
  });
  const lessonB = makeLesson({
    id: "t-lesson-b",
    unitIds: [],
    unlocksAfterLessonId: "t-lesson-a",
  });
  const lessons = [lessonA, lessonB];
  const units = [lessonUnitA];

  it("a lesson without unlocksAfterLessonId is always unlocked", () => {
    expect(isLessonUnlocked(lessonA, lessons, units, new Set())).toBe(true);
  });

  it("is locked when the gating lesson's units are not all complete", () => {
    expect(isLessonUnlocked(lessonB, lessons, units, new Set())).toBe(false);
  });

  it("is unlocked once every unit of the gating lesson is complete", () => {
    expect(
      isLessonUnlocked(lessonB, lessons, units, new Set(["t-task-1"])),
    ).toBe(true);
  });

  it("defensively treats a missing gate lesson as unlocked", () => {
    const orphan = makeLesson({
      id: "t-lesson-c",
      unlocksAfterLessonId: "t-lesson-missing",
    });
    expect(isLessonUnlocked(orphan, lessons, units, new Set())).toBe(true);
  });
});

describe("nextUnit", () => {
  const unitA1 = makeUnit({ id: "t-unit-a1", taskIds: ["t-task-a1"] });
  const unitA2 = makeUnit({ id: "t-unit-a2", taskIds: ["t-task-a2"] });
  const lessonA = makeLesson({
    id: "t-lesson-a",
    unitIds: [unitA1.id, unitA2.id],
  });
  const unitB1 = makeUnit({ id: "t-unit-b1", taskIds: ["t-task-b1"] });
  const lessonB = makeLesson({ id: "t-lesson-b", unitIds: [unitB1.id] });

  const content = makeContent({
    lessonIds: [lessonA.id, lessonB.id],
    lessons: [lessonA, lessonB],
    units: [unitA1, unitA2, unitB1],
  });

  it("nothing attempted -> the first unit of the first lesson", () => {
    expect(nextUnit(content, new Set())).toEqual({
      lessonId: lessonA.id,
      unitId: unitA1.id,
    });
  });

  it("first unit complete -> the second unit", () => {
    expect(nextUnit(content, new Set(["t-task-a1"]))).toEqual({
      lessonId: lessonA.id,
      unitId: unitA2.id,
    });
  });

  it("half-attempted unit (some but not all taskIds) -> that same unit, not the next one", () => {
    const half = makeUnit({
      id: "t-unit-half",
      taskIds: ["t-task-h1", "t-task-h2"],
    });
    const lessonHalf = makeLesson({
      id: "t-lesson-half",
      unitIds: [half.id, unitA1.id],
    });
    const halfContent = makeContent({
      lessonIds: [lessonHalf.id],
      lessons: [lessonHalf],
      units: [half, unitA1],
    });
    expect(nextUnit(halfContent, new Set(["t-task-h1"]))).toEqual({
      lessonId: lessonHalf.id,
      unitId: half.id,
    });
  });

  it("last unit of lesson 1 complete -> the first unit of lesson 2 (crosses the boundary)", () => {
    expect(nextUnit(content, new Set(["t-task-a1", "t-task-a2"]))).toEqual({
      lessonId: lessonB.id,
      unitId: unitB1.id,
    });
  });

  it("skip-ahead shape: lesson 1 incomplete, lesson 2 fully complete -> points back into lesson 1", () => {
    expect(nextUnit(content, new Set(["t-task-b1"]))).toEqual({
      lessonId: lessonA.id,
      unitId: unitA1.id,
    });
  });

  it("every unit complete -> null", () => {
    expect(
      nextUnit(content, new Set(["t-task-a1", "t-task-a2", "t-task-b1"])),
    ).toBeNull();
  });

  it("skips a dangling lesson id and a dangling unit id instead of throwing", () => {
    const danglingLesson = makeLesson({
      id: "t-lesson-dangling",
      unitIds: ["t-unit-missing", unitB1.id],
    });
    const danglingContent = makeContent({
      lessonIds: ["t-lesson-missing", danglingLesson.id],
      lessons: [danglingLesson],
      units: [unitB1],
    });
    expect(nextUnit(danglingContent, new Set())).toEqual({
      lessonId: danglingLesson.id,
      unitId: unitB1.id,
    });
  });

  it("reading order follows topic.lessonIds / lesson.unitIds, not array order in content.lessons / content.units", () => {
    // Array order is reversed from the reading order given by lessonIds /
    // unitIds, to prove the resolver walks id order, not array order.
    const reorderedContent = makeContent({
      lessonIds: [lessonA.id, lessonB.id],
      lessons: [lessonB, lessonA],
      units: [unitB1, unitA2, unitA1],
    });
    expect(nextUnit(reorderedContent, new Set())).toEqual({
      lessonId: lessonA.id,
      unitId: unitA1.id,
    });
  });
});

const item1: Item = {
  id: "t-item-1",
  kind: "concept",
  payload: { term: "Term 1", definition: "Definition 1" },
  sourceRef: "t-resource-1",
};
const item2: Item = {
  id: "t-item-2",
  kind: "concept",
  payload: { term: "Term 2", definition: "Definition 2" },
  sourceRef: "t-resource-1",
};
const unit1: SchedulingUnit = { id: item1.id, item: item1 };
const unit2: SchedulingUnit = { id: item2.id, item: item2 };

describe("reviewQueue", () => {
  it("includes only units with due <= now, sorted by due ascending", () => {
    const states = new Map<string, SrsState>([
      [
        item1.id,
        {
          due: "2026-07-05T00:00:00.000Z",
          intervalDays: 1,
          ease: 2.5,
          reps: 1,
        },
      ],
      [
        item2.id,
        {
          due: "2026-07-04T00:00:00.000Z",
          intervalDays: 1,
          ease: 2.5,
          reps: 1,
        },
      ],
    ]);

    expect(
      reviewQueue([unit1, unit2], states, new Date("2026-07-06T00:00:00Z")),
    ).toEqual([unit2, unit1]);
  });

  it("excludes units without state", () => {
    const states = new Map<string, SrsState>([
      [
        item1.id,
        {
          due: "2026-07-04T00:00:00.000Z",
          intervalDays: 1,
          ease: 2.5,
          reps: 1,
        },
      ],
    ]);
    expect(
      reviewQueue([unit1, unit2], states, new Date("2026-07-06T00:00:00Z")),
    ).toEqual([unit1]);
  });
});

describe("reviewQueue pinning (plan 0008)", () => {
  const item3: Item = {
    id: "t-item-3",
    kind: "concept",
    payload: { term: "Term 3", definition: "Definition 3" },
    sourceRef: "t-resource-1",
  };
  const unit3: SchedulingUnit = { id: item3.id, item: item3 };

  const states = new Map<string, SrsState>([
    [
      item1.id,
      { due: "2026-07-04T00:00:00.000Z", intervalDays: 1, ease: 2.5, reps: 1 },
    ],
    [
      item2.id,
      { due: "2026-07-05T00:00:00.000Z", intervalDays: 1, ease: 2.5, reps: 1 },
    ],
    [
      item3.id,
      { due: "2026-07-03T00:00:00.000Z", intervalDays: 1, ease: 2.5, reps: 1 },
    ],
  ]);
  const now = new Date("2026-07-06T00:00:00Z");

  it("sorts a pinned unit first even when its due date is later than non-pinned units", () => {
    expect(
      reviewQueue([unit1, unit2, unit3], states, now, new Set([item2.id])),
    ).toEqual([unit2, unit3, unit1]);
  });

  it("keeps due-ascending order within the pinned group and within the rest", () => {
    expect(
      reviewQueue(
        [unit1, unit2, unit3],
        states,
        now,
        new Set([item1.id, item2.id]),
      ),
    ).toEqual([unit1, unit2, unit3]);
  });

  it("an empty/omitted pin set leaves due-ascending order unchanged", () => {
    expect(reviewQueue([unit1, unit2, unit3], states, now)).toEqual([
      unit3,
      unit1,
      unit2,
    ]);
    expect(reviewQueue([unit1, unit2, unit3], states, now, new Set())).toEqual([
      unit3,
      unit1,
      unit2,
    ]);
  });
});

describe("reviewQueue / applyGrade boundary: due exactly equal to now", () => {
  it("a unit due exactly at `now` is included in reviewQueue", () => {
    const states = new Map<string, SrsState>([
      [
        item1.id,
        {
          due: "2026-07-05T00:00:00.000Z",
          intervalDays: 1,
          ease: 2.5,
          reps: 1,
        },
      ],
    ]);
    expect(
      reviewQueue([unit1], states, new Date("2026-07-05T00:00:00.000Z")),
    ).toEqual([unit1]);
  });

  it("applyGrade advances when gradedAt is exactly the due instant", () => {
    const state: SrsState = {
      due: "2026-07-05T00:00:00.000Z",
      intervalDays: 1,
      ease: 2.5,
      reps: 1,
    };
    const result = applyGrade(state, 4, new Date("2026-07-05T00:00:00.000Z"));
    expect(result).not.toBeNull();
  });
});

describe("reviewQueue / applyGrade repair: unparseable due", () => {
  it("a corrupted due string sorts first in reviewQueue", () => {
    const states = new Map<string, SrsState>([
      [
        item1.id,
        {
          due: "2026-07-04T00:00:00.000Z",
          intervalDays: 1,
          ease: 2.5,
          reps: 1,
        },
      ],
      [item2.id, { due: "not-a-date", intervalDays: 1, ease: 2.5, reps: 1 }],
    ]);
    expect(
      reviewQueue([unit1, unit2], states, new Date("2026-07-06T00:00:00Z")),
    ).toEqual([unit2, unit1]);
  });

  it("applyGrade repairs a corrupted due state by advancing it", () => {
    const corrupted: SrsState = {
      due: "not-a-date",
      intervalDays: 30,
      ease: 2.5,
      reps: 8,
      levelDay: "2026-07-01",
    };
    const result = applyGrade(corrupted, 4, new Date("2026-07-06T00:00:00Z"));
    expect(result).not.toBeNull();
    expect(result!.reps).toBe(9);
    expect(result!.due).toBe("2026-10-04T00:00:00.000Z");
  });
});

describe("clock-injected review cycle", () => {
  it("first grading schedules the item, review queue reflects due, re-grading while not due is practice-only, grading when due advances", () => {
    // Staged at the production level, where the practice-only rule applies:
    // below it a word is due daily and answering it again the same day is
    // the point (plan 0025 §5), which the test below this one pins.
    const state1 = atLevel(6, "2026-07-04T00:00:00.000Z");

    const states = new Map<string, SrsState>([[item1.id, state1]]);
    expect(
      reviewQueue([unit1], states, new Date("2026-07-03T12:00:00Z")),
    ).toEqual([]);
    expect(
      reviewQueue([unit1], states, new Date("2026-07-04T01:00:00Z")),
    ).toEqual([unit1]);

    // Due by 2026-07-04T01:00:00Z: grading advances state.
    const state2 = applyGrade(state1, 4, new Date("2026-07-04T01:00:00Z"));
    expect(state2).not.toBeNull();
    expect(state2!.reps).toBe(7);
    expect(state2!.intervalDays).toBe(15);
    expect(state2!.due).toBe("2026-07-19T00:00:00.000Z");

    // Not due until then: practice-only, nothing to persist.
    expect(applyGrade(state2, 4, new Date("2026-07-05T12:00:00Z"))).toBeNull();
  });

  it("keeps counting answers to a word that has not reached production yet", () => {
    // The other half of §5: a word answered right once is due tomorrow, so
    // the practice-only rule alone would refuse the rest of its first
    // session and it could never reach level 3 in one sitting.
    const morning = new Date("2026-07-04T09:00:00Z");
    const evening = new Date("2026-07-04T21:00:00Z");
    const first = applyGrade(null, 4, morning);
    expect(first!.reps).toBe(1);
    const second = applyGrade(first, 4, morning);
    expect(second!.reps).toBe(2);
    const third = applyGrade(second, 4, evening);
    expect(third!.reps).toBe(3);
    // And there it stops for the day: the fourth win would arrive at
    // production, which the day guard refuses.
    expect(applyGrade(third, 4, evening)!.reps).toBe(3);
  });
});

describe("cloze blanks schedule independently (plan 0002 done-criterion)", () => {
  it("day 0 grade both blanks; day 1 blank 1 correct/blank 2 wrong; day 2 the queue holds only blank 2, blank 1 due again ~day 7", () => {
    const sentence: Item = {
      id: "t-item-sentence",
      kind: "sentence",
      payload: { text: "{{c1::one}} {{c2::two}} three", translation: "t" },
      sourceRef: "t-resource-1",
    };
    const blank1: SchedulingUnit = {
      id: `${sentence.id}::c1`,
      item: sentence,
      blankNumber: 1,
    };
    const blank2: SchedulingUnit = {
      id: `${sentence.id}::c2`,
      item: sentence,
      blankNumber: 2,
    };

    // Both blanks start at level 7 — 15 days on Balanced — because that is
    // where one right answer and one wrong one part company. Under the
    // level scheduler the first four levels are all daily (plan 0025 §3),
    // so a brand-new pair of blanks would be due together whatever they
    // scored, and the independence would be invisible rather than absent.
    const day0 = new Date("2026-07-04T00:00:00Z");
    const seeded = atLevel(7, "2026-07-04T00:00:00.000Z");
    const states = new Map<string, SrsState>();
    states.set(blank1.id, seeded);
    states.set(blank2.id, seeded);
    expect(reviewQueue([blank1, blank2], states, day0)).toEqual([
      blank1,
      blank2,
    ]);

    states.set(blank1.id, applyGrade(states.get(blank1.id)!, 4, day0)!);
    states.set(blank2.id, applyGrade(states.get(blank2.id)!, 2, day0)!);
    // Right: level 8, 30 days. Wrong: two levels back to 5, 5 days — the
    // §5 fall-back, not a reset to the start.
    expect(states.get(blank1.id)!.reps).toBe(8);
    expect(states.get(blank2.id)!.reps).toBe(5);

    const day5 = new Date("2026-07-09T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day5)).toEqual([blank2]);

    const blank1Due = new Date(states.get(blank1.id)!.due).getTime();
    expect(blank1Due - day5.getTime()).toBeGreaterThanOrEqual(
      20 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("applyGrade under the default pace", () => {
  const sentence: Item = {
    id: "t-item-ladder-sentence",
    kind: "sentence",
    payload: { text: "{{c1::one}} {{c2::two}} three", translation: "t" },
    sourceRef: "t-resource-1",
  };
  const blank1: SchedulingUnit = {
    id: `${sentence.id}::c1`,
    item: sentence,
    blankNumber: 1,
  };
  const blank2: SchedulingUnit = {
    id: `${sentence.id}::c2`,
    item: sentence,
    blankNumber: 2,
  };

  it("walks a new blank up the daily levels, one day at a time after that", () => {
    const day0 = new Date("2026-08-05T00:00:00Z");
    const states = new Map<string, SrsState>();
    states.set(blank1.id, applyGrade(null, 4, day0)!);
    states.set(blank2.id, applyGrade(null, 4, day0)!);
    // A first Good is level 1 — due tomorrow, because difficulty is what
    // climbs through the first four levels, not spacing.
    expect(states.get(blank1.id)!.due).toBe("2026-08-06T00:00:00.000Z");

    const day1 = new Date("2026-08-06T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day1)).toEqual([
      blank1,
      blank2,
    ]);
    states.set(blank1.id, applyGrade(states.get(blank1.id)!, 4, day1)!);
    states.set(blank2.id, applyGrade(states.get(blank2.id)!, 2, day1)!);
    expect(states.get(blank1.id)!.reps).toBe(2);
    // Two levels back from 1 floors at 0 — the bottom, not a punishment.
    expect(states.get(blank2.id)!.reps).toBe(0);
  });

  it("still refuses to advance a not-due card at the production levels", () => {
    const state = atLevel(6, "2026-08-05T00:00:00.000Z");
    const advanced = applyGrade(state, 4, new Date("2026-08-05T00:00:00Z"))!;
    expect(
      applyGrade(advanced, 4, new Date("2026-08-06T00:00:00Z")),
    ).toBeNull();
  });
});

describe("due counts per unit and lesson (plan 0022 §7)", () => {
  const sentence: Item = {
    id: "t-item-s",
    kind: "sentence",
    payload: { text: "{{c1::a}} {{c2::b}}", translation: "t" },
    sourceRef: "t-resource-1",
  };
  const lexeme: Item = {
    id: "t-item-l",
    kind: "lexeme",
    payload: { script: "суу", transliteration: "suu", gloss: "water" },
    sourceRef: "t-resource-1",
  };
  const unitA = makeUnit({
    id: "t-unit-a",
    itemIds: [sentence.id, lexeme.id],
    noteIds: ["t-note-1"],
  });
  const unitB = makeUnit({ id: "t-unit-b", itemIds: [lexeme.id] });
  const lessonA = makeLesson({
    id: "t-lesson-a",
    unitIds: [unitA.id, unitB.id],
  });
  const lessonB = makeLesson({ id: "t-lesson-b", unitIds: [] });

  const due: SchedulingUnit[] = [
    { id: `${sentence.id}::c1`, item: sentence, blankNumber: 1 },
    { id: `${sentence.id}::c2`, item: sentence, blankNumber: 2 },
    { id: lexeme.id, item: lexeme },
    { id: "note:t-note-1", note: { id: "t-note-1", stem: "n1" } },
  ];

  it("counts each cloze blank, each item and each note, per unit", () => {
    const counts = dueCountsByUnit(due, [unitA, unitB]);
    // Unit A: two blanks + the lexeme + the note. Unit B: the same lexeme,
    // which is genuinely due on both cards it appears on.
    expect(counts.get(unitA.id)).toBe(4);
    expect(counts.get(unitB.id)).toBe(1);
  });

  it("omits units with nothing due, rather than storing zeros", () => {
    const counts = dueCountsByUnit([], [unitA, unitB]);
    expect(counts.size).toBe(0);
    expect(counts.get(unitA.id)).toBeUndefined();
  });

  it("rolls up to lessons over unitIds, omitting empty ones", () => {
    const byUnit = dueCountsByUnit(due, [unitA, unitB]);
    const byLesson = dueCountsByLesson(byUnit, [lessonA, lessonB]);
    expect(byLesson.get(lessonA.id)).toBe(5);
    expect(byLesson.has(lessonB.id)).toBe(false);
  });

  it("ignores a due card that belongs to no unit of this Book", () => {
    const stranger: SchedulingUnit[] = [
      { id: "t-item-elsewhere", item: { ...lexeme, id: "t-item-elsewhere" } },
    ];
    expect(dueCountsByUnit(stranger, [unitA, unitB]).size).toBe(0);
  });
});
