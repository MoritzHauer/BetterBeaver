import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LEARNING,
  LEARNING_KEY,
  getLearning,
  schedulingConfig,
  setLearning,
} from "./learning";

describe("learning settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to Balanced, skipping a week, with no key row", () => {
    expect(getLearning()).toEqual({
      pace: "balanced",
      skip: "week",
      extraKeys: false,
      keyboardHelpDismissed: false,
      progression: "normal",
    });
    expect(getLearning()).toEqual(DEFAULT_LEARNING);
  });

  it("writes one field and leaves the others as stored", () => {
    setLearning({ pace: "light" });
    setLearning({ skip: "year" });
    expect(getLearning()).toEqual({
      pace: "light",
      skip: "year",
      extraKeys: false,
      keyboardHelpDismissed: false,
      progression: "normal",
    });
  });

  it("falls back per field, so one unrecognised value can't strand the rest", () => {
    localStorage.setItem(
      LEARNING_KEY,
      JSON.stringify({ pace: "turbo", scheduler: "sm2", skip: "decade" }),
    );
    // `scheduler` is a settings key that no longer exists (plan 0025 §11):
    // a stored one is read past, not migrated away, exactly as an
    // unrecognised pace is.
    expect(getLearning()).toEqual({
      pace: "balanced",
      skip: "week",
      extraKeys: false,
      keyboardHelpDismissed: false,
      progression: "normal",
    });
  });

  it("treats a corrupt value as absent", () => {
    localStorage.setItem(LEARNING_KEY, "{not json");
    expect(getLearning()).toEqual(DEFAULT_LEARNING);
  });

  it("hands the scheduler only the fields it needs", () => {
    setLearning({ pace: "thorough", skip: "month" });
    expect(schedulingConfig()).toEqual({ pace: "thorough", levelsPerDay: 1 });
  });

  it("turns the Fast practice depth into the scheduler's double step", () => {
    // The preset is stored; `levelsPerDay` is derived from it at grade time,
    // so there is exactly one source of truth for how fast a word climbs.
    setLearning({ progression: "fast" });
    expect(schedulingConfig().levelsPerDay).toBe(2);
    setLearning({ progression: "normal" });
    expect(schedulingConfig().levelsPerDay).toBe(1);
    setLearning({ progression: "careful" });
    expect(schedulingConfig().levelsPerDay).toBe(1);
  });

  it("rides the bb.* backup sweep", () => {
    setLearning({ pace: "light" });
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith("bb.")),
    ).toContain(LEARNING_KEY);
  });
});
