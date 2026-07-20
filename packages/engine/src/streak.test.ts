import { describe, it, expect } from "vitest";
import { advanceStreak, combinedStreak, localDay } from "./streak.js";
import type { Streak } from "./streak.js";

// All dates are constructed in local time (no Z suffix) — the streak rule is
// local-calendar by contract.
describe("advanceStreak", () => {
  it("starts a streak of 1 on the first grade", () => {
    expect(advanceStreak(null, new Date(2026, 6, 14, 10, 0))).toEqual({
      lastActiveDay: "2026-07-14",
      length: 1,
    });
  });

  it("is a no-op (same object) on a same-day repeat", () => {
    const prev: Streak = { lastActiveDay: "2026-07-14", length: 3 };
    expect(advanceStreak(prev, new Date(2026, 6, 14, 23, 59))).toBe(prev);
  });

  it("increments on the next calendar day", () => {
    const prev: Streak = { lastActiveDay: "2026-07-14", length: 3 };
    expect(advanceStreak(prev, new Date(2026, 6, 15, 0, 1))).toEqual({
      lastActiveDay: "2026-07-15",
      length: 4,
    });
  });

  it("resets to 1 after a missed day", () => {
    const prev: Streak = { lastActiveDay: "2026-07-14", length: 3 };
    expect(advanceStreak(prev, new Date(2026, 6, 16, 9, 0))).toEqual({
      lastActiveDay: "2026-07-16",
      length: 1,
    });
  });

  it("increments across a month boundary", () => {
    const prev: Streak = { lastActiveDay: "2026-07-31", length: 7 };
    expect(advanceStreak(prev, new Date(2026, 7, 1, 8, 0))).toEqual({
      lastActiveDay: "2026-08-01",
      length: 8,
    });
  });

  it("increments across a year boundary", () => {
    const prev: Streak = { lastActiveDay: "2026-12-31", length: 100 };
    expect(advanceStreak(prev, new Date(2027, 0, 1, 8, 0))).toEqual({
      lastActiveDay: "2027-01-01",
      length: 101,
    });
  });
});

describe("localDay", () => {
  it("zero-pads month and day", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("combinedStreak", () => {
  it("is zero with no streaks", () => {
    expect(combinedStreak([], "2026-07-20")).toBe(0);
  });

  it("returns a single domain's length when it ends today", () => {
    expect(
      combinedStreak(
        [{ lastActiveDay: "2026-07-20", length: 5 }],
        "2026-07-20",
      ),
    ).toBe(5);
  });

  it("unions overlapping runs rather than summing them", () => {
    // A: Jul 16–20 (5), B: Jul 18–20 (3) → union Jul 16–20 = 5, not 8.
    expect(
      combinedStreak(
        [
          { lastActiveDay: "2026-07-20", length: 5 },
          { lastActiveDay: "2026-07-20", length: 3 },
        ],
        "2026-07-20",
      ),
    ).toBe(5);
  });

  it("bridges a gap in one domain with another domain's active day", () => {
    // A: Jul 20 only, B: Jul 18–19 → union Jul 18,19,20 = 3.
    expect(
      combinedStreak(
        [
          { lastActiveDay: "2026-07-20", length: 1 },
          { lastActiveDay: "2026-07-19", length: 2 },
        ],
        "2026-07-20",
      ),
    ).toBe(3);
  });

  it("stops at a day with no activity in any domain", () => {
    // A: Jul 17–18, B: Jul 20 → Wed(19) is empty, so from today = just Jul 20.
    expect(
      combinedStreak(
        [
          { lastActiveDay: "2026-07-18", length: 2 },
          { lastActiveDay: "2026-07-20", length: 1 },
        ],
        "2026-07-20",
      ),
    ).toBe(1);
  });

  it("stays alive when the latest active day is yesterday", () => {
    expect(
      combinedStreak(
        [{ lastActiveDay: "2026-07-19", length: 4 }],
        "2026-07-20",
      ),
    ).toBe(4);
  });

  it("is zero after a two-day gap", () => {
    expect(
      combinedStreak(
        [{ lastActiveDay: "2026-07-18", length: 9 }],
        "2026-07-20",
      ),
    ).toBe(0);
  });
});
