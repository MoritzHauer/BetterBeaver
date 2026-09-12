import { beforeEach, describe, expect, it } from "vitest";
import type { Content, Exam, Item, Task } from "@betterbeaver/schema";
import {
  fitAnswer,
  readExamState,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "./exam-attempts";
import { exportBackup } from "./backup";

/** A `choice`-type question item: `correctCount` right options, then one wrong one. */
function choiceItem(id: string, correctCount: number): Item {
  return {
    id,
    kind: "question",
    payload: {
      stem: "Stem",
      options: [
        ...Array.from({ length: correctCount }, (_, i) => ({
          text: `Right ${i}`,
          correct: true,
        })),
        { text: "Wrong", correct: false },
      ],
    },
    sourceRef: "res-1",
  };
}

/** An `assign`-type question item with `rowCount` rows. */
function assignItem(id: string, rowCount: number): Item {
  return {
    id,
    kind: "question",
    payload: {
      stem: "Stem",
      options: Array.from({ length: rowCount }, (_, i) => ({
        text: `Row ${i}`,
        correct: i === 0,
      })),
      labels: ["Yes", "No"],
    },
    sourceRef: "res-1",
  };
}

function content(items: Item[], tasks: Task[]): Content {
  return {
    topic: {
      id: "t-topic",
      code: "t",
      domainId: "t",
      title: "Book",
      description: "",
      lessonIds: [],
    },
    lessons: [],
    units: [],
    items,
    tasks,
    resources: [],
    notes: [],
    exams: [],
  };
}

function examWith(questions: Exam["questions"]): Exam {
  return {
    id: "t-exam",
    topicId: "t-topic",
    title: "Exam",
    description: "",
    questions,
    ruleset: {
      passPercent: 60,
      timeLimitMinutes: 75,
      partialCredit: true,
      negativeMarking: true,
    },
  };
}

describe("fitAnswer", () => {
  it("discards a choice answer with an index past the options", () => {
    const item = choiceItem("i1", 1) as Extract<Item, { kind: "question" }>;
    expect(fitAnswer(item, [5])).toBeNull();
  });

  it("discards a choice answer with more selections than correct options", () => {
    const item = choiceItem("i1", 1) as Extract<Item, { kind: "question" }>;
    // 1 correct option, but 2 selections given.
    expect(fitAnswer(item, [0, 1])).toBeNull();
  });

  it("keeps a choice answer within range and selection count", () => {
    const item = choiceItem("i1", 2) as Extract<Item, { kind: "question" }>;
    expect(fitAnswer(item, [0, 1])).toEqual([0, 1]);
  });

  it("discards an assign answer whose length differs from the row count", () => {
    const item = assignItem("i1", 3) as Extract<Item, { kind: "question" }>;
    expect(fitAnswer(item, [0, 1])).toBeNull();
  });

  it("keeps an assign answer whose length matches the row count", () => {
    const item = assignItem("i1", 3) as Extract<Item, { kind: "question" }>;
    expect(fitAnswer(item, [0, 1, null])).toEqual([0, 1, null]);
  });
});

describe("startAttempt / saveAnswer / submitAttempt", () => {
  beforeEach(() => localStorage.clear());

  it("computes the deadline from timeLimitMinutes", () => {
    const exam = examWith([{ taskId: "q1", points: 1 }]);
    const now = new Date("2026-01-01T00:00:00.000Z");
    startAttempt(exam, now);
    const state = readExamState(exam.id);
    expect(state.attempt?.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(state.attempt?.deadlineAt).toBe("2026-01-01T01:15:00.000Z");
  });

  it("submitAttempt writes lastResult with answers and points, and clears attempt", () => {
    const task: Task = { id: "q1", type: "choice", itemIds: ["i1"] };
    const exam = examWith([{ taskId: "q1", points: 2 }]);
    const shown = content([choiceItem("i1", 2)], [task]);
    const now = new Date("2026-01-01T00:00:00.000Z");

    startAttempt(exam, now);
    saveAnswer(exam.id, "q1", [0, 1]);

    const score = submitAttempt(exam, shown, now);
    expect(score.total).toBe(2);

    const state = readExamState(exam.id);
    expect(state.attempt).toBeUndefined();
    expect(state.lastResult).toEqual({
      submittedAt: "2026-01-01T00:00:00.000Z",
      pointsByTaskId: { q1: 2 },
      answersByTaskId: { q1: [0, 1] },
    });
  });

  it("submitAttempt discards an answer that no longer fits before scoring", () => {
    // 1 correct option now, but the stored answer picked 2 — stale content.
    const task: Task = { id: "q1", type: "choice", itemIds: ["i1"] };
    const exam = examWith([{ taskId: "q1", points: 2 }]);
    const shown = content([choiceItem("i1", 1)], [task]);
    const now = new Date("2026-01-01T00:00:00.000Z");

    startAttempt(exam, now);
    saveAnswer(exam.id, "q1", [0, 1]);

    submitAttempt(exam, shown, now);
    const state = readExamState(exam.id);
    // Discarded, so the question reads as unanswered: no entry at all.
    expect(state.lastResult?.answersByTaskId).toEqual({});
    expect(state.lastResult?.pointsByTaskId.q1).toBe(0);
  });
});

describe("bb.exam.* backup coverage", () => {
  beforeEach(() => localStorage.clear());

  it("rides the bb.* export", async () => {
    const exam = examWith([{ taskId: "q1", points: 1 }]);
    startAttempt(exam, new Date("2026-01-01T00:00:00.000Z"));

    // exportBackup triggers a browser download; intercept the Blob it builds
    // via the anchor's object URL rather than actually clicking through.
    const originalCreateObjectURL = URL.createObjectURL;
    let blob: Blob | null = null;
    URL.createObjectURL = (b: Blob) => {
      blob = b;
      return "blob:test";
    };
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    try {
      await exportBackup();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevoke;
    }
    expect(blob).not.toBeNull();
    const text = await (blob as unknown as Blob).text();
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(data)).toContain(`bb.exam.${exam.id}`);
  });
});
