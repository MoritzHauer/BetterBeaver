import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULING,
  isDue,
  recallQuality,
  recognizeQuality,
  REVIEW_PACES,
  schedule,
  type SchedulingConfig,
  type SrsState,
} from "./sm2.js";

/** Classic SM-2 is no longer the default (plan 0022), so the oracle
 * sequences below — which pin plan 0001's arithmetic — ask for it by name. */
const SM2: SchedulingConfig = { scheduler: "sm2", pace: "balanced" };

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

    const s1 = schedule(null, 4, t, SM2);
    expect(s1.intervalDays).toBe(1);
    expect(s1.reps).toBe(1);
    expect(s1.ease).toBe(2.5);

    const s2 = schedule(s1, 4, t, SM2);
    expect(s2.intervalDays).toBe(6);
    expect(s2.reps).toBe(2);
    expect(s2.ease).toBe(2.5);

    const s3 = schedule(s2, 4, t, SM2);
    expect(s3.intervalDays).toBe(15);
    expect(s3.reps).toBe(3);
    expect(s3.ease).toBe(2.5);
  });

  it("sequence 2: grade 2 then grade 4 from new -> interval 1 (reps 1), then 6 (reps 2), ease unchanged", () => {
    const t = new Date("2026-07-03T15:30:00Z");

    const s1 = schedule(null, 2, t, SM2);
    expect(s1.intervalDays).toBe(1);
    expect(s1.reps).toBe(1);
    expect(s1.ease).toBe(2.5);

    const s2 = schedule(s1, 4, t, SM2);
    expect(s2.intervalDays).toBe(6);
    expect(s2.reps).toBe(2);
    expect(s2.ease).toBe(2.5);
  });
});

describe("due date, day granularity", () => {
  it("due is the start of the UTC day of gradedAt plus intervalDays days", () => {
    const state = schedule(null, 4, new Date("2026-07-03T15:30:00Z"), SM2);
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
      state = schedule(state, 3, t, SM2);
      expect(state.ease).toBeGreaterThanOrEqual(1.3);
    }
    expect(state?.ease).toBe(1.3);
  });
});

describe("ladder scheduler (plan 0022 §1)", () => {
  const t = new Date("2026-08-05T15:30:00Z");
  const LADDER = REVIEW_PACES.balanced;

  function atRung(rung: number): SrsState {
    return {
      due: "2026-08-05T00:00:00.000Z",
      intervalDays: LADDER[rung] ?? 1,
      ease: 2.5,
      reps: rung,
    };
  }

  it("is the default scheduler", () => {
    expect(DEFAULT_SCHEDULING).toEqual({
      scheduler: "ladder",
      pace: "balanced",
    });
    expect(schedule(null, 5, t)).toEqual(
      schedule(null, 5, t, DEFAULT_SCHEDULING),
    );
  });

  it("Good advances one rung, walking the whole ladder from new", () => {
    let state = schedule(null, 5, t);
    // A new card answered Good goes straight to rung 1 (5 days): rung 0 is
    // only ever reached by Again or Hard.
    expect([state.reps, state.intervalDays]).toEqual([1, 5]);
    for (const rung of [2, 3, 4, 5, 6]) {
      state = schedule(state, 5, t);
      expect([state.reps, state.intervalDays]).toEqual([rung, LADDER[rung]]);
    }
  });

  it("the top rung repeats forever", () => {
    let state = atRung(6);
    for (let i = 0; i < 5; i++) {
      state = schedule(state, 5, t);
      expect([state.reps, state.intervalDays]).toEqual([6, 365]);
    }
  });

  it("Hard steps back one rung and re-asks tomorrow", () => {
    const state = schedule(atRung(4), 3, t);
    expect([state.reps, state.intervalDays]).toEqual([3, 1]);
    expect(state.due).toBe("2026-08-06T00:00:00.000Z");
  });

  it("Hard then Good returns exactly the interval you were on, never a promotion", () => {
    const hard = schedule(atRung(4), 3, t);
    const good = schedule(hard, 5, new Date("2026-08-06T09:00:00Z"));
    expect([good.reps, good.intervalDays]).toEqual([4, LADDER[4]]);
  });

  it("Again resets to rung 0 and re-asks tomorrow", () => {
    const state = schedule(atRung(5), 2, t);
    expect([state.reps, state.intervalDays]).toEqual([0, 1]);
    expect(state.due).toBe("2026-08-06T00:00:00.000Z");
  });

  it("Hard at rung 0 is indistinguishable from Again — the floor, not a defect", () => {
    expect(schedule(atRung(0), 3, t)).toEqual(schedule(atRung(0), 2, t));
  });

  it("carries ease through untouched under every grade", () => {
    const previous = { ...atRung(3), ease: 1.72 };
    for (const quality of [2, 3, 5] as const) {
      expect(schedule(previous, quality, t).ease).toBe(1.72);
    }
    expect(schedule(null, 5, t).ease).toBe(2.5);
  });

  it("auto-graded qualities land on Again and Good with no extra plumbing", () => {
    expect(schedule(atRung(3), recognizeQuality(false), t).reps).toBe(0);
    expect(schedule(atRung(3), recognizeQuality(true), t).reps).toBe(4);
  });

  it("clamps an existing SM-2 card's repetition count to the top rung", () => {
    const mature: SrsState = {
      due: "2026-08-05T00:00:00.000Z",
      intervalDays: 45,
      ease: 2.36,
      reps: 12,
    };
    const state = schedule(mature, 5, t);
    expect([state.reps, state.intervalDays]).toEqual([6, 365]);
  });

  it("follows the configured pace", () => {
    const thorough = schedule(null, 5, t, {
      scheduler: "ladder",
      pace: "thorough",
    });
    expect(thorough.intervalDays).toBe(REVIEW_PACES.thorough[1]);
    const light = schedule(null, 5, t, { scheduler: "ladder", pace: "light" });
    expect(light.intervalDays).toBe(REVIEW_PACES.light[1]);
  });

  it("every pace is ascending, positive and seven rungs long", () => {
    for (const ladder of Object.values(REVIEW_PACES)) {
      expect(ladder.length).toBe(7);
      expect(ladder[0]).toBeGreaterThan(0);
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i]).toBeGreaterThan(ladder[i - 1] ?? 0);
      }
    }
  });

  it("switching schedulers mid-stream consumes the other's state without error", () => {
    // SM-2 for three reps, then ladder, then back — no field either
    // scheduler writes is one the other cannot read.
    let state = schedule(null, 4, t, SM2);
    state = schedule(state, 4, t, SM2);
    state = schedule(state, 4, t, SM2);
    const onLadder = schedule(state, 5, t);
    expect(onLadder.reps).toBe(4);
    expect(onLadder.ease).toBe(state.ease);
    const backOnSm2 = schedule(onLadder, 4, t, SM2);
    expect(backOnSm2.reps).toBe(5);
    expect(backOnSm2.ease).toBeGreaterThan(0);
  });
});
