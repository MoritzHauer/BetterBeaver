import { describe, it, expect } from "vitest";
import {
  EXERCISES,
  EXERCISE_LEVEL,
  MAX_EXERCISE_LEVEL,
  MIN_EXERCISE_LEVEL,
  TASK_EXERCISES,
  TASK_TYPES,
  type Exercise,
} from "./entities.js";

describe("the exercise level table (plan 0025 §2)", () => {
  it("ranks every exercise except the one nothing checks", () => {
    // Pinned by value: this table *is* the design decision, so a change to
    // it should have to be made here too.
    expect(EXERCISE_LEVEL).toEqual({
      shadowing: null,
      matching: 1,
      recognize: 2,
      listen: 3,
      "minimal-pair": 3,
      "recognize-produce": 4,
      picture: 4,
      scramble: 5,
      build: 6,
      cloze: 7,
      recall: 8,
      write: 9,
      dictation: 10,
    });
  });

  it("covers every exercise, and only levels in range", () => {
    for (const exercise of EXERCISES) {
      const level = EXERCISE_LEVEL[exercise];
      if (level === null) {
        continue;
      }
      expect(level).toBeGreaterThanOrEqual(MIN_EXERCISE_LEVEL);
      expect(level).toBeLessThanOrEqual(MAX_EXERCISE_LEVEL);
      expect(Number.isInteger(level)).toBe(true);
    }
    expect(Object.keys(EXERCISE_LEVEL).sort()).toEqual([...EXERCISES].sort());
  });

  it("leaves no level unreachable", () => {
    // §4 draws the next attempt at exactly `level + 1` and §8 needs 100% to
    // be attainable, so a level with no exercise at all would be a hole
    // nothing could climb through.
    const ranked = new Set(Object.values(EXERCISE_LEVEL));
    for (let level = MIN_EXERCISE_LEVEL; level <= MAX_EXERCISE_LEVEL; level++) {
      expect(ranked.has(level)).toBe(true);
    }
  });

  it("gives every task type at least one exercise", () => {
    for (const type of TASK_TYPES) {
      expect(TASK_EXERCISES[type].length).toBeGreaterThan(0);
    }
  });

  it("claims each authored exercise once, and leaves the derived one unclaimed", () => {
    const claimed: Exercise[] = TASK_TYPES.flatMap((type) => [
      ...TASK_EXERCISES[type],
    ]);
    expect(new Set(claimed).size).toBe(claimed.length);
    // `write` is derived from lexeme/concept items (§9); no Book has ever
    // been able to author a task of that type, which is the whole point.
    expect(claimed.sort()).toEqual(
      EXERCISES.filter((exercise) => exercise !== "write").sort(),
    );
  });

  it("orders a task type's own directions by level", () => {
    for (const type of TASK_TYPES) {
      const levels = TASK_EXERCISES[type].map(
        (exercise) => EXERCISE_LEVEL[exercise] ?? 0,
      );
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    }
  });

  it("puts production above recognition for the same word", () => {
    // The three placements §2 argues for, as inequalities rather than
    // absolute numbers, so a future re-tuning of the ladder still has to
    // keep them.
    expect(EXERCISE_LEVEL.matching!).toBeLessThan(EXERCISE_LEVEL.recognize!);
    expect(EXERCISE_LEVEL.recognize!).toBeLessThan(
      EXERCISE_LEVEL["recognize-produce"]!,
    );
    expect(EXERCISE_LEVEL.recall!).toBeLessThan(EXERCISE_LEVEL.write!);
    expect(EXERCISE_LEVEL.picture!).toBeGreaterThan(EXERCISE_LEVEL.recognize!);
  });
});
