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

  it("defaults to the ladder on Balanced, skipping a week", () => {
    expect(getLearning()).toEqual({
      scheduler: "ladder",
      pace: "balanced",
      skip: "week",
    });
    expect(getLearning()).toEqual(DEFAULT_LEARNING);
  });

  it("writes one field and leaves the others as stored", () => {
    setLearning({ pace: "light" });
    setLearning({ skip: "year" });
    expect(getLearning()).toEqual({
      scheduler: "ladder",
      pace: "light",
      skip: "year",
    });
  });

  it("falls back per field, so one unrecognised value can't strand the rest", () => {
    localStorage.setItem(
      LEARNING_KEY,
      JSON.stringify({ pace: "turbo", scheduler: "sm2", skip: "decade" }),
    );
    expect(getLearning()).toEqual({
      scheduler: "sm2",
      pace: "balanced",
      skip: "week",
    });
  });

  it("treats a corrupt value as absent", () => {
    localStorage.setItem(LEARNING_KEY, "{not json");
    expect(getLearning()).toEqual(DEFAULT_LEARNING);
  });

  it("hands the scheduler only the two fields it needs", () => {
    setLearning({ scheduler: "sm2", pace: "thorough", skip: "month" });
    expect(schedulingConfig()).toEqual({
      scheduler: "sm2",
      pace: "thorough",
    });
  });

  it("rides the bb.* backup sweep", () => {
    setLearning({ pace: "light" });
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith("bb.")),
    ).toContain(LEARNING_KEY);
  });
});
