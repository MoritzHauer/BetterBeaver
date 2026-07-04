import { describe, it, expect } from "vitest";
import type { Item, Unit } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import {
  isUnitComplete,
  isUnitUnlocked,
  reviewQueue,
  applyGrade,
} from "./progress.js";

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

describe("reviewQueue", () => {
  it("includes only items with due <= now, sorted by due ascending", () => {
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
      reviewQueue([item1, item2], states, new Date("2026-07-06T00:00:00Z")),
    ).toEqual([item2, item1]);
  });

  it("excludes items without state", () => {
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
      reviewQueue([item1, item2], states, new Date("2026-07-06T00:00:00Z")),
    ).toEqual([item1]);
  });
});

describe("reviewQueue / applyGrade boundary: due exactly equal to now", () => {
  it("an item due exactly at `now` is included in reviewQueue", () => {
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
      reviewQueue([item1], states, new Date("2026-07-05T00:00:00.000Z")),
    ).toEqual([item1]);
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
      reviewQueue([item1, item2], states, new Date("2026-07-06T00:00:00Z")),
    ).toEqual([item2, item1]);
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
      reviewQueue([item1], states, new Date("2026-07-04T12:00:00Z")),
    ).toEqual([]);
    expect(
      reviewQueue([item1], states, new Date("2026-07-05T01:00:00Z")),
    ).toEqual([item1]);

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
