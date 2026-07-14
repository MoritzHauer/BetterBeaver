import { describe, it, expect } from "vitest";
import { advanceStreak, localDay } from "./streak.js";
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
