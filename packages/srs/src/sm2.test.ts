import { describe, it, expect } from "vitest";
import {
  isDue,
  recallQuality,
  recognizeQuality,
  schedule,
  type SrsState,
} from "./sm2.js";

describe("grade mappings", () => {
  it("recognizeQuality maps correct/wrong to 4/2", () => {
    expect(recognizeQuality(true)).toBe(4);
    expect(recognizeQuality(false)).toBe(2);
  });

  it("recallQuality maps again/hard/good to 2/3/5", () => {
    expect(recallQuality("again")).toBe(2);
    expect(recallQuality("hard")).toBe(3);
    expect(recallQuality("good")).toBe(5);
  });
});

describe("schedule oracle sequences", () => {
  it("sequence 1: grades 4, 4, 4 from new -> intervals 1, 6, 15; ease stays 2.5", () => {
    const t = new Date("2026-07-03T15:30:00Z");

    const s1 = schedule(null, 4, t);
    expect(s1.intervalDays).toBe(1);
    expect(s1.reps).toBe(1);
    expect(s1.ease).toBe(2.5);

    const s2 = schedule(s1, 4, t);
    expect(s2.intervalDays).toBe(6);
    expect(s2.reps).toBe(2);
    expect(s2.ease).toBe(2.5);

    const s3 = schedule(s2, 4, t);
    expect(s3.intervalDays).toBe(15);
    expect(s3.reps).toBe(3);
    expect(s3.ease).toBe(2.5);
  });

  it("sequence 2: grade 2 then grade 4 from new -> interval 1 (reps 1), then 6 (reps 2), ease unchanged", () => {
    const t = new Date("2026-07-03T15:30:00Z");

    const s1 = schedule(null, 2, t);
    expect(s1.intervalDays).toBe(1);
    expect(s1.reps).toBe(1);
    expect(s1.ease).toBe(2.5);

    const s2 = schedule(s1, 4, t);
    expect(s2.intervalDays).toBe(6);
    expect(s2.reps).toBe(2);
    expect(s2.ease).toBe(2.5);
  });
});

describe("due date, day granularity", () => {
  it("due is the start of the UTC day of gradedAt plus intervalDays days", () => {
    const state = schedule(null, 4, new Date("2026-07-03T15:30:00Z"));
    expect(state.due).toBe("2026-07-04T00:00:00.000Z");
  });
});

describe("isDue", () => {
  const state: SrsState = {
    due: "2026-07-05T00:00:00.000Z",
    intervalDays: 1,
    ease: 2.5,
    reps: 1,
  };

  it("is true when due is strictly before `at`", () => {
    expect(isDue(state, new Date("2026-07-06T00:00:00Z"))).toBe(true);
  });

  it("is true when due is exactly equal to `at` (inclusive boundary)", () => {
    expect(isDue(state, new Date("2026-07-05T00:00:00.000Z"))).toBe(true);
  });

  it("is false when due is strictly after `at`", () => {
    expect(isDue(state, new Date("2026-07-04T00:00:00Z"))).toBe(false);
  });

  it("is true for an unparseable due string", () => {
    const corrupted: SrsState = { ...state, due: "not-a-date" };
    expect(isDue(corrupted, new Date("2026-07-04T00:00:00Z"))).toBe(true);
  });
});

describe("ease floor", () => {
  it("repeated hard (quality 3) grades from new eventually pin ease at exactly 1.3, never below", () => {
    const t = new Date("2026-07-03T15:30:00Z");
    let state: SrsState | null = null;
    for (let i = 0; i < 50; i++) {
      state = schedule(state, 3, t);
      expect(state.ease).toBeGreaterThanOrEqual(1.3);
    }
    expect(state?.ease).toBe(1.3);
  });
});
