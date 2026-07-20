import { describe, it, expect } from "vitest";
import type { Item } from "@betterbeaver/schema";
import { itemDisplayText } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import { availableModes, buildAdhocSession } from "./adhoc.js";
import type { Rng } from "./session.js";
import type { ProgressStore } from "./interfaces.js";
import { recordGrade } from "./store.js";

/** Lexeme fixture: id/script/transliteration derive from `n`, gloss is given. */
function lexeme(n: number, gloss: string, extra?: { audioRef?: string }): Item {
  return {
    id: `t-item-l${n}`,
    kind: "lexeme",
    payload: {
      script: `скрипт${n}`,
      transliteration: `script${n}`,
      gloss,
      ...extra,
    },
    sourceRef: "t-resource-1",
  };
}

/** Always-zero rng: Fisher-Yates degenerates deterministically, correctIndex is 0. */
const zeroRng: Rng = () => 0;

describe("availableModes", () => {
  it("gates everything on an empty set", () => {
    const modes = availableModes([], { ttsAvailable: true });
    expect(modes.recall).not.toBeNull();
    expect(modes.recognize).not.toBeNull();
    expect(modes.matching).not.toBeNull();
    expect(modes.listen).not.toBeNull();
  });

  it("gates recognize/listen below 4 distinct display texts, recall/matching stay available", () => {
    const items = [lexeme(1, "one"), lexeme(2, "two"), lexeme(3, "three")];
    const modes = availableModes(items, { ttsAvailable: true });
    expect(modes.recall).toBeNull();
    expect(modes.matching).toBeNull();
    expect(modes.recognize).toContain("distinct");
    expect(modes.listen).toContain("distinct");
  });

  it("counts distinct texts, not items: 5 items with a duplicate gloss pass recognize but fail matching", () => {
    const items = [
      lexeme(1, "one"),
      lexeme(2, "two"),
      lexeme(3, "two"),
      lexeme(4, "three"),
      lexeme(5, "four"),
    ];
    const modes = availableModes(items, { ttsAvailable: true });
    expect(modes.recognize).toBeNull();
    expect(modes.matching).toContain("same text");
  });

  it("gates matching above 8 items", () => {
    const items = Array.from({ length: 9 }, (_, i) => lexeme(i, `gloss ${i}`));
    const modes = availableModes(items, { ttsAvailable: true });
    expect(modes.matching).toContain("2 to 8");
  });

  it("gates listen when an item lacks audio and TTS is unavailable, but not when TTS is available", () => {
    const items = [
      lexeme(1, "one", { audioRef: "a1" }),
      lexeme(2, "two", { audioRef: "a2" }),
      lexeme(3, "three", { audioRef: "a3" }),
      lexeme(4, "four"),
    ];
    expect(availableModes(items, { ttsAvailable: false }).listen).toContain(
      "read-aloud",
    );
    expect(availableModes(items, { ttsAvailable: true }).listen).toBeNull();
    expect(availableModes(items, { ttsAvailable: false }).recognize).toBeNull();
  });
});

describe("buildAdhocSession", () => {
  it("throws when the mode's floor is unmet", () => {
    const items = [lexeme(1, "one"), lexeme(2, "two"), lexeme(3, "three")];
    expect(() => buildAdhocSession("recognize", items, zeroRng)).toThrow(
      /distinct/,
    );
  });

  it("recognize: samples distractors from the set's distinct display texts (no duplicate choices)", () => {
    const items = [
      lexeme(1, "one"),
      lexeme(2, "two"),
      lexeme(3, "two"),
      lexeme(4, "three"),
      lexeme(5, "four"),
    ];
    const questions = buildAdhocSession("recognize", items, zeroRng);
    expect(questions).toHaveLength(5);
    for (const [index, question] of questions.entries()) {
      if (question.kind !== "recognize") {
        throw new Error("expected recognize questions");
      }
      expect(question.unitId).toBe(items[index]!.id);
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices).size).toBe(4);
      expect(question.choices[question.correctIndex]).toBe(
        itemDisplayText(items[index]!),
      );
    }
  });

  it("recall: appends a synonym line to the reveal from resolved synonym-type links (plan 0006)", () => {
    const items = [lexeme(1, "good"), lexeme(2, "bad")];
    const resolvedLinks = new Map([
      [
        "t-item-l1",
        [
          { type: "synonym" as const, script: "мыкты" },
          { type: "synonym" as const, script: "сонун" },
          { type: "antonym" as const, script: "жаман" },
        ],
      ],
    ]);
    const questions = buildAdhocSession(
      "recall",
      items,
      zeroRng,
      resolvedLinks,
    );
    expect(questions[0]).toEqual({
      kind: "recall",
      unitId: "t-item-l1",
      prompt: "good",
      reveal: ["скрипт1", "script1", "also: мыкты, сонун"],
    });
    expect(questions[1]).toEqual({
      kind: "recall",
      unitId: "t-item-l2",
      prompt: "bad",
      reveal: ["скрипт2", "script2"],
    });
  });

  it("recall: omits the also-line when resolvedLinks is absent", () => {
    const items = [lexeme(1, "good")];
    const questions = buildAdhocSession("recall", items, zeroRng);
    expect(questions[0]).toEqual({
      kind: "recall",
      unitId: "t-item-l1",
      prompt: "good",
      reveal: ["скрипт1", "script1"],
    });
  });

  it("matching: one board over the set, prompts by script, answers by gloss", () => {
    const items = [lexeme(1, "one"), lexeme(2, "two")];
    const questions = buildAdhocSession("matching", items, zeroRng);
    expect(questions).toHaveLength(1);
    const board = questions[0]!;
    if (board.kind !== "matching") {
      throw new Error("expected a matching board");
    }
    expect(new Set(board.prompts.map((p) => p.text))).toEqual(
      new Set(["скрипт1", "скрипт2"]),
    );
    expect(new Set(board.answers.map((a) => a.text))).toEqual(
      new Set(["one", "two"]),
    );
    expect(board.prompts.map((p) => p.unitId).sort()).toEqual(
      board.answers.map((a) => a.unitId).sort(),
    );
  });

  it("listen: emits stem audio for items with audioRef, speak audio (item script) otherwise", () => {
    const items = [
      lexeme(1, "one", { audioRef: "a1" }),
      lexeme(2, "two"),
      lexeme(3, "three"),
      lexeme(4, "four"),
    ];
    const questions = buildAdhocSession("listen", items, zeroRng);
    if (questions[0]?.kind !== "listen" || questions[1]?.kind !== "listen") {
      throw new Error("expected listen questions");
    }
    expect(questions[0].audio).toEqual({ kind: "stem", stem: "a1" });
    expect(questions[1].audio).toEqual({ kind: "speak", text: "скрипт2" });
  });
});

describe("ad-hoc grading enters scheduling (plan 0004 amendment)", () => {
  it("recordGrade on a stateless item's unitId from an ad-hoc question schedules it", async () => {
    const states = new Map<string, SrsState>();
    const store: ProgressStore = {
      getItemState: async (id) => states.get(id) ?? null,
      setItemState: async (id, state) => void states.set(id, state),
      getAttemptedTaskIds: async () => [],
      markTaskAttempted: async () => undefined,
      getStreak: async () => null,
      setStreak: async () => undefined,
      incrementReps: async () => undefined,
    };
    const items = [lexeme(1, "good"), lexeme(2, "bad")];
    const [question] = buildAdhocSession("recall", items, zeroRng);
    if (question?.kind !== "recall") {
      throw new Error("expected a recall question");
    }

    const next = await recordGrade(
      store,
      question.unitId,
      4,
      new Date("2026-07-15T12:00:00Z"),
      "t-domain",
    );

    expect(next).not.toBeNull();
    expect(states.get("t-item-l1")).toEqual(next);
  });
});
