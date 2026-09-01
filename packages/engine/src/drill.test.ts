import { describe, expect, it } from "vitest";
import {
  advanceDrill,
  nextVisit,
  startDrill,
  unfinished,
  visitLevel,
} from "./drill.js";

const ok = (unitId: string) => [{ unitId, correct: true }];
const miss = (unitId: string) => [{ unitId, correct: false }];

describe("startDrill", () => {
  it("owes one correct answer per word per repetition, known up front", () => {
    // Plan 0011's decision survives: the unit card can still promise a
    // number before the session starts.
    const state = startDrill(["a", "b", "c"], 2);
    expect(state.remaining).toBe(6);
    expect(state.queue).toHaveLength(6);
  });

  it("makes the first appearance of each word the new attempt", () => {
    const state = startDrill(["a", "b"], 2);
    expect(state.queue.slice(0, 2).map((v) => v.slot)).toEqual(["new", "new"]);
    expect(state.queue.slice(2).map((v) => v.slot)).toEqual([
      "repetition",
      "repetition",
    ]);
  });
});

describe("advanceDrill", () => {
  it("decrements the count only on a correct answer", () => {
    const state = startDrill(["a", "b"], 2);
    expect(advanceDrill(state, ok("a")).remaining).toBe(3);
  });

  it("leaves the count untouched on a wrong answer, so it never grows", () => {
    // The learner is owed the same number of correct answers as before —
    // a struggling session stalls rather than reading as getting longer.
    const state = startDrill(["a", "b"], 2);
    expect(advanceDrill(state, miss("a")).remaining).toBe(4);
  });

  it("reinserts a missed word later, never immediately", () => {
    const state = startDrill(["a", "b", "c", "d"], 2);
    const after = advanceDrill(state, miss("a"));
    expect(after.queue[0]?.unitId).not.toBe("a");
    const index = after.queue.findIndex((v) => v.unitId === "a");
    expect(index).toBeGreaterThanOrEqual(2);
  });

  it("brings a missed word back one level lower", () => {
    const state = startDrill(["a", "b", "c"], 2);
    const after = advanceDrill(state, miss("a"));
    const back = after.queue.find((v) => v.unitId === "a");
    expect(back?.levelOffset).toBe(-1);
    expect(back?.slot).toBe("repetition");
  });

  it("widens the gap each time the same word is missed", () => {
    let state = startDrill(["a", "b", "c", "d", "e", "f"], 3);
    const gapFor = (s: typeof state) =>
      s.queue.findIndex((v) => v.unitId === "a");
    state = advanceDrill(state, miss("a"));
    const firstGap = gapFor(state);
    while (nextVisit(state)?.unitId !== "a") {
      state = advanceDrill(state, ok(nextVisit(state)!.unitId));
    }
    state = advanceDrill(state, miss("a"));
    expect(gapFor(state)).toBeGreaterThan(firstGap - 1);
  });

  it("credits every word a matching board graded", () => {
    // One board answers for up to five words. Crediting only the word whose
    // turn it was would throw the other four answers away and ask them again.
    const state = startDrill(["a", "b", "c", "d"], 1);
    const after = advanceDrill(state, [
      { unitId: "a", correct: true },
      { unitId: "b", correct: true },
      { unitId: "c", correct: true },
      { unitId: "d", correct: false },
    ]);
    expect(after.remaining).toBe(1);
    expect(after.done.sort()).toEqual(["a", "b", "c"]);
    expect(after.queue.map((v) => v.unitId)).toEqual(["d"]);
  });

  it("counts one answer against the cap however many words a board credited", () => {
    const state = startDrill(["a", "b", "c", "d"], 1);
    const after = advanceDrill(state, [
      { unitId: "a", correct: true },
      { unitId: "b", correct: true },
    ]);
    expect(after.answers).toBe(1);
  });

  it("ends the session at the cap even if a word never lands", () => {
    let state = startDrill(["a"], 1);
    for (let i = 0; i < 20 && nextVisit(state) !== null; i++) {
      state = advanceDrill(state, miss("a"));
    }
    expect(nextVisit(state)).toBeNull();
    expect(unfinished(state)).toContain("a");
  });

  it("finishes when every word has met its repetitions", () => {
    let state = startDrill(["a", "b"], 1);
    state = advanceDrill(state, ok("a"));
    state = advanceDrill(state, ok("b"));
    expect(nextVisit(state)).toBeNull();
    expect(state.remaining).toBe(0);
  });
});

describe("visitLevel", () => {
  it("floors the in-session level at 0", () => {
    expect(
      visitLevel({ unitId: "a", slot: "repetition", levelOffset: -3 }, 1),
    ).toBe(0);
  });
});
