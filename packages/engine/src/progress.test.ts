import { describe, it, expect } from "vitest";
import type { Item, Unit } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import {
  isUnitComplete,
  isUnitUnlocked,
  reviewQueue,
  applyGrade,
} from "./progress.js";
import type { SchedulingUnit } from "./units.js";

function makeUnit(overrides: Partial<Unit> & Pick<Unit, "id">): Unit {
  return {
    topicId: "t-topic",
    title: "Unit",
    goal: "Goal",
    itemIds: [],
    taskIds: [],
    noteIds: [],
    ...overrides,
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
    const result = applyGrade(corrupted, 4, new Date("2026-07-06T00:00:00Z"));
    expect(result).not.toBeNull();
    expect(result!.due).toBe("2026-07-12T00:00:00.000Z");
  });
});

describe("clock-injected review cycle", () => {
  it("first grading schedules the item, review queue reflects due, re-grading while not due is practice-only, grading when due advances", () => {
    const firstGrade = new Date("2026-07-04T10:00:00Z");
    const state1 = applyGrade(null, 4, firstGrade);
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
    expect(applyGrade(state1, 4, new Date("2026-07-04T12:00:00Z"))).toBeNull();

    // Due by 2026-07-05T01:00:00Z: grading advances state.
    const secondGrade = new Date("2026-07-05T01:00:00Z");
    const state2 = applyGrade(state1, 4, secondGrade);
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
    states.set(blank1.id, applyGrade(null, 4, day0)!);
    states.set(blank2.id, applyGrade(null, 4, day0)!);
    // First SM-2 grade always yields a 1-day interval, so both blanks are
    // due at day 1 regardless of quality.
    expect(states.get(blank1.id)!.due).toBe("2026-07-05T00:00:00.000Z");
    expect(states.get(blank2.id)!.due).toBe("2026-07-05T00:00:00.000Z");

    const day1 = new Date("2026-07-05T00:00:00Z");
    expect(reviewQueue([blank1, blank2], states, day1)).toEqual([
      blank1,
      blank2,
    ]);
    states.set(blank1.id, applyGrade(states.get(blank1.id)!, 4, day1)!);
    states.set(blank2.id, applyGrade(states.get(blank2.id)!, 2, day1)!);

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
