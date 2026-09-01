import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULING,
  isDue,
  MAX_WORD_LEVEL,
  recallQuality,
  recognizeQuality,
  REVIEW_PACES,
  schedule,
  utcDay,
  type SchedulingConfig,
  type SrsState,
} from "./scheduler.js";

const GOOD = 5;
const HARD = 3;
const AGAIN = 2;

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

describe("due date, day granularity", () => {
  it("due is the start of the UTC day of gradedAt plus intervalDays days", () => {
    const state = schedule(null, GOOD, new Date("2026-01-15T23:45:00Z"));
    expect(state.intervalDays).toBe(1);
    expect(state.due).toBe("2026-01-16T00:00:00.000Z");
  });

  it("utcDay is the same day the due date is measured from", () => {
    expect(utcDay(new Date("2026-01-15T23:45:00Z"))).toBe("2026-01-15");
    expect(utcDay(new Date("2026-01-16T00:00:00Z"))).toBe("2026-01-16");
  });
});

describe("isDue", () => {
  const at = new Date("2026-01-15T12:00:00Z");
  function withDue(due: string): SrsState {
    return { due, intervalDays: 1, ease: 2.5, reps: 1 };
  }

  it("is true when due is strictly before `at`", () => {
    expect(isDue(withDue("2026-01-14T12:00:00Z"), at)).toBe(true);
  });

  it("is true when due is exactly equal to `at` (inclusive boundary)", () => {
    expect(isDue(withDue("2026-01-15T12:00:00Z"), at)).toBe(true);
  });

  it("is false when due is strictly after `at`", () => {
    expect(isDue(withDue("2026-01-16T12:00:00Z"), at)).toBe(false);
  });

  it("is true for an unparseable due string", () => {
    expect(isDue(withDue("not a date"), at)).toBe(true);
  });
});

describe("the pace rows (plan 0025 §3)", () => {
  it("publishes Balanced exactly as the plan's table prints it", () => {
    // Levels 1–10. Index 0 is the un-learned card, which is due tomorrow
    // like any other fresh one.
    expect([...REVIEW_PACES.balanced].slice(1)).toEqual([
      1, 1, 1, 2, 5, 8, 15, 30, 90, 365,
    ]);
    expect(REVIEW_PACES.balanced[0]).toBe(1);
  });

  it("is eleven levels long, positive and never shortens, on every pace", () => {
    for (const row of Object.values(REVIEW_PACES)) {
      expect(row).toHaveLength(MAX_WORD_LEVEL + 1);
      for (const [level, days] of row.entries()) {
        expect(days).toBeGreaterThan(0);
        if (level > 0) {
          expect(days).toBeGreaterThanOrEqual(row[level - 1]!);
        }
      }
    }
  });

  it("keeps the first four levels daily on every pace", () => {
    // Difficulty is what climbs there, not spacing — the pace shifts the
    // spaced half of the row.
    for (const row of Object.values(REVIEW_PACES)) {
      expect([...row].slice(0, 4)).toEqual([1, 1, 1, 1]);
    }
  });

  it("defaults to Balanced", () => {
    expect(DEFAULT_SCHEDULING).toEqual({ pace: "balanced" });
    expect(schedule(null, GOOD, new Date("2026-08-05T10:00:00Z"))).toEqual(
      schedule(null, GOOD, new Date("2026-08-05T10:00:00Z"), {
        pace: "balanced",
      }),
    );
  });
});

describe("the word level (plan 0025 §1, §5)", () => {
  const day1 = new Date("2026-08-05T09:00:00Z");
  const day1Later = new Date("2026-08-05T21:00:00Z");
  const day2 = new Date("2026-08-06T09:00:00Z");

  /** A card this scheduler wrote: `levelDay` present, interval off the row. */
  function atLevel(level: number, levelDay = "2026-08-04"): SrsState {
    return {
      due: "2026-08-05T00:00:00.000Z",
      intervalDays: REVIEW_PACES.balanced[level]!,
      ease: 2.5,
      reps: level,
      levelDay,
    };
  }

  it("runs a brand-new word up to level 3 in one sitting, and no further", () => {
    // §4: levels 1–3 are matching, recognize and listen — all recognition,
    // with the answer on screen — so meeting a word is enough to pass them.
    let state = schedule(null, GOOD, day1);
    expect(state.reps).toBe(1);
    state = schedule(state, GOOD, day1);
    expect(state.reps).toBe(2);
    state = schedule(state, GOOD, day1Later);
    expect(state.reps).toBe(3);
    expect(state.intervalDays).toBe(1);

    // The fourth win of the day would arrive at production. It is refused.
    state = schedule(state, GOOD, day1Later);
    expect(state.reps).toBe(3);
  });

  it("lets the same word reach production the next day", () => {
    const state = schedule(atLevel(3, "2026-08-05"), GOOD, day2);
    expect(state.reps).toBe(4);
    expect(state.intervalDays).toBe(2);
    expect(state.levelDay).toBe("2026-08-06");
  });

  it("allows one level per UTC day from level 4 up, however many answers", () => {
    let state = schedule(atLevel(6), GOOD, day1);
    expect(state.reps).toBe(7);
    for (const at of [day1, day1Later, day1Later]) {
      state = schedule(state, GOOD, at);
      expect(state.reps).toBe(7);
      // Refused, not punished: the interval still reads off the level.
      expect(state.intervalDays).toBe(REVIEW_PACES.balanced[7]);
    }
    state = schedule(state, GOOD, day2);
    expect(state.reps).toBe(8);
  });

  it("stamps levelDay on every advance, including the unguarded ones", () => {
    // Load-bearing twice over: the guard reads it, and so does the
    // migration marker, which takes an absent stamp to mean "written before
    // this plan".
    const first = schedule(null, GOOD, day1);
    expect(first.levelDay).toBe("2026-08-05");
    expect(schedule(first, GOOD, day1).levelDay).toBe("2026-08-05");
  });

  it("leaves levelDay alone when the level does not advance", () => {
    const held = schedule(atLevel(6, "2026-08-01"), AGAIN, day1);
    expect(held.reps).toBe(4);
    expect(held.levelDay).toBe("2026-08-01");
  });

  it("steps back two on a wrong answer, and the interval falls with it", () => {
    const state = schedule(atLevel(8), AGAIN, day1);
    expect(state.reps).toBe(6);
    expect(state.intervalDays).toBe(8);
    expect(state.due).toBe("2026-08-13T00:00:00.000Z");
  });

  it("never drops below zero", () => {
    expect(schedule(atLevel(1), AGAIN, day1).reps).toBe(0);
    expect(schedule(atLevel(0), AGAIN, day1).reps).toBe(0);
    expect(schedule(null, AGAIN, day1).reps).toBe(0);
  });

  it("takes an auto-graded wrong answer as a wrong answer", () => {
    expect(schedule(atLevel(8), recognizeQuality(false), day1).reps).toBe(6);
    expect(schedule(atLevel(8), recognizeQuality(true), day1).reps).toBe(9);
  });

  it("Hard steps back one, and Hard then Good is not a promotion", () => {
    const hard = schedule(atLevel(7), HARD, day1);
    expect(hard.reps).toBe(6);
    const good = schedule(hard, GOOD, day2);
    expect(good.reps).toBe(7);
    expect(good.intervalDays).toBe(REVIEW_PACES.balanced[7]);
  });

  it("holds at the top level forever", () => {
    const state = schedule(atLevel(MAX_WORD_LEVEL), GOOD, day1);
    expect(state.reps).toBe(MAX_WORD_LEVEL);
    expect(state.intervalDays).toBe(365);
  });

  it("follows the configured pace", () => {
    const light: SchedulingConfig = { pace: "light" };
    expect(schedule(atLevel(7), GOOD, day1, light).intervalDays).toBe(
      REVIEW_PACES.light[8],
    );
  });

  it("writes a constant ease, since nothing reads it any more", () => {
    const state = schedule({ ...atLevel(5), ease: 1.3 }, GOOD, day1);
    expect(state.ease).toBe(2.5);
  });
});

describe("migration by interval (plan 0025 §11)", () => {
  const day = new Date("2026-08-05T09:00:00Z");

  /** A card written by plan 0022's ladder: a rung in `reps`, no `levelDay`. */
  function atRung(rung: number, intervalDays: number): SrsState {
    return {
      due: "2026-08-05T00:00:00.000Z",
      intervalDays,
      ease: 2.5,
      reps: rung,
    };
  }

  it("reads the level off the interval, not off the stored number", () => {
    // The plan's own two examples: 30 days is level 8, 1 day is level 1.
    expect(schedule(atRung(3, 30), HARD, day).reps).toBe(7);
    expect(schedule(atRung(0, 1), HARD, day).reps).toBe(0);
    // Every rung of the Balanced ladder it could have been sitting on, each
    // one step back because Hard is what was graded. Rung 0 is the
    // exception and not a migration at all: zero is level 0 either way.
    const ladder = [1, 5, 15, 30, 90, 180, 365];
    expect(
      ladder.map((days, rung) => schedule(atRung(rung, days), HARD, day).reps),
    ).toEqual([0, 4, 6, 7, 8, 8, 9]);
  });

  it("migrates an SM-2 card by its interval too, however many reps it counted", () => {
    // SM-2 counted repetitions without a ceiling, so the stored number is
    // not a level in any sense; the interval is the only comparable thing
    // either retired scheduler wrote.
    const sm2 = { ...atRung(14, 30) };
    expect(schedule(sm2, GOOD, day).reps).toBe(9);
  });

  it("may advance a level on the first answer after the upgrade", () => {
    // Correct, and deliberate (§11): the stamp is absent, and it is a new
    // day for a card that has not been answered since the upgrade.
    const state = schedule(atRung(3, 30), GOOD, day);
    expect(state.reps).toBe(9);
    expect(state.levelDay).toBe("2026-08-05");
  });

  it("re-derives the same level when the first answer was wrong", () => {
    // A wrong answer advances nothing, so no stamp is written and the card
    // arrives here unmigrated a second time. The interval it now carries is
    // its own level's, so the second derivation has to agree with the first.
    const once = schedule(atRung(3, 30), AGAIN, day);
    expect(once.reps).toBe(6);
    expect(once.levelDay).toBeUndefined();
    const twice = schedule(once, HARD, day);
    expect(twice.reps).toBe(5);
  });

  it("leaves a card that never got anything right alone", () => {
    // reps 0 is not a rung to migrate: it is level 0 under either reading.
    const state = schedule(atRung(0, 1), GOOD, day);
    expect(state.reps).toBe(1);
  });
});
