import { describe, it, expect } from "vitest";
import { EXERCISE_LEVEL, MAX_EXERCISE_LEVEL } from "@betterbeaver/schema";
import { MAX_WORD_LEVEL, REVIEW_PACES } from "@betterbeaver/srs";

/**
 * The word level and the exercise level are deliberately the same scale
 * (plan 0025 §1): a word at level 6 is asked exercises up to level 6. The
 * two constants live in different packages — `srs` has no dependency on
 * `schema`, and giving it one for a single number would be a heavier price
 * than this test — so the agreement is pinned here, in the one package that
 * depends on both.
 */
describe("the word level and the exercise ladder are one scale", () => {
  it("share a ceiling", () => {
    expect(MAX_WORD_LEVEL).toBe(MAX_EXERCISE_LEVEL);
  });

  it("give every exercise level an interval to be scheduled on", () => {
    for (const level of Object.values(EXERCISE_LEVEL)) {
      if (level === null) {
        continue;
      }
      for (const row of Object.values(REVIEW_PACES)) {
        expect(row[level]).toBeGreaterThan(0);
      }
    }
  });
});
