import { describe, it, expect } from "vitest";
import type { Content, Item, Lesson, Unit } from "@betterbeaver/schema";
import type { SchedulingConfig, SrsState } from "@betterbeaver/srs";
import {
  isUnitComplete,
  isUnitUnlocked,
  isLessonComplete,
  isLessonUnlocked,
  nextUnit,
  reviewQueue,
  applyGrade,
} from "./progress.js";
import type { SchedulingUnit } from "./units.js";

/** The interval oracles below pin plan 0001's SM-2 arithmetic, which plan
 * 0022 made the non-default scheduler — so they ask for it by name. The
 * ladder's own transitions are covered in `packages/srs`, and the
 * default-scheduler path is exercised at the bottom of this file. */
const SM2: SchedulingConfig = { scheduler: "sm2", pace: "balanced" };

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
      intervalDays: 1,
      ease: 2.5,
      reps: 1,
    };
    const result = applyGrade(
      corrupted,
      4,
      new Date("2026-07-06T00:00:00Z"),
      SM2,
    );
    expect(result).not.toBeNull();
    expect(result!.due).toBe("2026-07-12T00:00:00.000Z");
  });
});

describe("clock-injected review cycle", () => {
  it("first grading schedules the item, review queue reflects due, re-grading while not due is practice-only, grading when due advances", () => {
    const firstGrade = new Date("2026-07-04T10:00:00Z");
    const state1 = applyGrade(null, 4, firstGrade, SM2);
    expect(state1).not.toBeNull();
    expect(state1!.due).toBe("2026-07-05T00:00:00.000Z");

    const states = new Map<string, SrsState>([[item1.id, state1!]]);
    expect(
      reviewQueue([unit1], states, new Date("2026-07-04T12:00:00Z")),
    ).toEqual([]);
    expect(
      reviewQueue([unit1], states, new Date("2026-07-05T01:00:00Z")),
    ).toEqual([unit1]);

    // Not due yet at 2026-07-04T12:00:00Z: practice-only, nothing to persist.
    expect(
      applyGrade(state1, 4, new Date("2026-07-04T12:00:00Z"), SM2),
    ).toBeNull();

    // Due by 2026-07-05T01:00:00Z: grading advances state.
    const secondGrade = new Date("2026-07-05T01:00:00Z");
    const state2 = applyGrade(state1, 4, secondGrade, SM2);
    expect(state2).not.toBeNull();
    expect(state2!.reps).toBe(2);
    expect(state2!.intervalDays).toBe(6);
    expect(state2!.due).toBe("2026-07-11T00:00:00.000Z");
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

    const day0 = new Date("2026-07-04T00:00:00Z");
    const states = new Map<string, SrsState>();
    states.set(blank1.id, applyGrade(null, 4, day0, SM2)!);
    states.set(blank2.id, applyGrade(null, 4, day0, SM2)!);
    // First SM-2 grade always yields a 1-day interval, so both blanks are
    // due at day 1 regardless of quality.
    expect(states.get(blank1.id)!.due).toBe("2026-07-05T00:00:00.000Z");
    expect(states.get(blank2.id)!.due).toBe("2026-07-05T00:00:00.000Z");

    const day1 = new Date("2026-07-05T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day1)).toEqual([
      blank1,
      blank2,
    ]);
    states.set(blank1.id, applyGrade(states.get(blank1.id)!, 4, day1, SM2)!);
    states.set(blank2.id, applyGrade(states.get(blank2.id)!, 2, day1, SM2)!);

    const day2 = new Date("2026-07-06T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day2)).toEqual([blank2]);

    // Blank 1 (graded "correct") returns further out (~day 7+); blank 2
    // (graded "wrong") is due again the very next day.
    const blank1Due = new Date(states.get(blank1.id)!.due).getTime();
    const day2Time = day2.getTime();
    expect(blank1Due).toBeGreaterThan(day2Time);
    expect(blank1Due - day2Time).toBeGreaterThanOrEqual(
      4 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("applyGrade under the default (ladder) scheduler", () => {
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

  it("cloze blanks still schedule independently, on ladder intervals", () => {
    const day0 = new Date("2026-08-05T00:00:00Z");
    const states = new Map<string, SrsState>();
    states.set(blank1.id, applyGrade(null, 4, day0)!);
    states.set(blank2.id, applyGrade(null, 4, day0)!);
    // A first Good under the ladder is rung 1 — 5 days, not SM-2's 1.
    expect(states.get(blank1.id)!.due).toBe("2026-08-10T00:00:00.000Z");

    const day5 = new Date("2026-08-10T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day5)).toEqual([
      blank1,
      blank2,
    ]);
    states.set(blank1.id, applyGrade(states.get(blank1.id)!, 4, day5)!);
    states.set(blank2.id, applyGrade(states.get(blank2.id)!, 2, day5)!);

    const day6 = new Date("2026-08-11T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day6)).toEqual([blank2]);
    expect(states.get(blank1.id)!.intervalDays).toBe(15);
    expect(states.get(blank2.id)!.intervalDays).toBe(1);
  });

  it("still refuses to advance a not-due card", () => {
    const day0 = new Date("2026-08-05T00:00:00Z");
    const state = applyGrade(null, 4, day0)!;
    expect(applyGrade(state, 4, new Date("2026-08-06T00:00:00Z"))).toBeNull();
  });
});
