import { describe, it, expect } from "vitest";
import type { Exam, ExamRuleset } from "@betterbeaver/schema";
import { scoreExam, type ExamAnswer } from "./exam.js";
import type { AssignQuestion, ChoiceQuestion } from "./session.js";

/** The iSAQB CPSA-F record (plan 0027 §3) — one ruleset value, not a code path. */
const iSAQB: ExamRuleset = {
  passPercent: 60,
  timeLimitMinutes: 75,
  partialCredit: true,
  negativeMarking: true,
};

function choice(
  id: string,
  correctCount: number,
  total: number,
): ChoiceQuestion {
  return {
    kind: "choice",
    unitId: id,
    stem: `stem ${id}`,
    choices: Array.from({ length: total }, (_, i) => `option ${i}`),
    correctIndices: Array.from({ length: correctCount }, (_, i) => i),
    selectCount: correctCount,
  };
}

function assign(id: string, correctLabelIndex: number[]): AssignQuestion {
  return {
    kind: "assign",
    unitId: id,
    stem: `stem ${id}`,
    rows: correctLabelIndex.map((_, i) => `row ${i}`),
    labels: ["Richtig", "Falsch"],
    correctLabelIndex,
  };
}

function exam(
  questions: { taskId: string; points: number }[],
  ruleset: ExamRuleset = iSAQB,
): Exam {
  return {
    id: "t-exam-1",
    topicId: "t-topic",
    title: "Mock exam",
    description: "iSAQB CPSA-F, © iSAQB e.V.",
    questions,
    ruleset,
  };
}

const map = <T>(entries: [string, T][]) => new Map(entries);

describe("scoreExam (plan 0027 §4)", () => {
  it("scores a wrong single-answer question 0, not −1", () => {
    // The floor at 0 is what "negative marking" means in this ruleset: a
    // question never drags the total below its own zero.
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 1 }]),
      map([["t-task-1", choice("q1", 1, 4)]]),
      map<ExamAnswer>([["t-task-1", { kind: "choice", selected: [2] }]]),
    );
    expect(result.questions[0]?.scored).toBe(0);
    expect(result.total).toBe(0);
  });

  it("scores a right single-answer question its full points", () => {
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 1 }]),
      map([["t-task-1", choice("q1", 1, 4)]]),
      map<ExamAnswer>([["t-task-1", { kind: "choice", selected: [0] }]]),
    );
    expect(result.questions[0]?.scored).toBe(1);
  });

  it("scores 2 of 3 marks right and 1 wrong as points × (2−1)/3", () => {
    // The plan's worked example: a 2-point multiple-response question.
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 2 }]),
      map([["t-task-1", choice("q1", 3, 5)]]),
      map<ExamAnswer>([["t-task-1", { kind: "choice", selected: [0, 1, 4] }]]),
    );
    expect(result.questions[0]?.scored).toBeCloseTo((2 * (2 - 1)) / 3, 10);
  });

  it("scores a fully blank assign question 0, with no penalty", () => {
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 3 }]),
      map([["t-task-1", assign("q1", [0, 1, 0])]]),
      map<ExamAnswer>([
        ["t-task-1", { kind: "assign", chosen: [null, null, null] }],
      ]),
    );
    expect(result.questions[0]).toMatchObject({
      scored: 0,
      right: 0,
      wrong: 0,
    });
  });

  it("charges nothing for a blank assign row and full credit for the rest", () => {
    // Two right, one blank, of three: 3 × 2/3 = 2. A wrong third row would
    // instead give 3 × (2−1)/3 = 1, which is the whole point of the rule.
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 3 }]),
      map([["t-task-1", assign("q1", [0, 1, 0])]]),
      map<ExamAnswer>([["t-task-1", { kind: "assign", chosen: [0, 1, null] }]]),
    );
    expect(result.questions[0]?.scored).toBeCloseTo(2, 10);
  });

  it("charges a wrong assign row under negative marking", () => {
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 3 }]),
      map([["t-task-1", assign("q1", [0, 1, 0])]]),
      map<ExamAnswer>([["t-task-1", { kind: "assign", chosen: [0, 1, 1] }]]),
    );
    expect(result.questions[0]?.scored).toBeCloseTo(1, 10);
  });

  it("ignores wrong marks when negativeMarking is off", () => {
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 3 }], {
        ...iSAQB,
        negativeMarking: false,
      }),
      map([["t-task-1", assign("q1", [0, 1, 0])]]),
      map<ExamAnswer>([["t-task-1", { kind: "assign", chosen: [0, 1, 1] }]]),
    );
    expect(result.questions[0]?.scored).toBeCloseTo(2, 10);
  });

  it("is all-or-nothing when partialCredit is off", () => {
    const ruleset = { ...iSAQB, partialCredit: false };
    const almost = scoreExam(
      exam([{ taskId: "t-task-1", points: 2 }], ruleset),
      map([["t-task-1", choice("q1", 3, 5)]]),
      map<ExamAnswer>([["t-task-1", { kind: "choice", selected: [0, 1] }]]),
    );
    expect(almost.questions[0]?.scored).toBe(0);

    const exact = scoreExam(
      exam([{ taskId: "t-task-1", points: 2 }], ruleset),
      map([["t-task-1", choice("q1", 3, 5)]]),
      map<ExamAnswer>([["t-task-1", { kind: "choice", selected: [0, 1, 2] }]]),
    );
    expect(exact.questions[0]?.scored).toBe(2);
  });

  it("scores an unanswered question 0 without throwing", () => {
    const result = scoreExam(
      exam([{ taskId: "t-task-1", points: 2 }]),
      map([["t-task-1", choice("q1", 2, 4)]]),
      map<ExamAnswer>([]),
    );
    expect(result.questions[0]?.scored).toBe(0);
  });

  it("sums the exam and passes at exactly the pass mark", () => {
    // 3 of 5 points is 60%, and `passPercent` is inclusive.
    const result = scoreExam(
      exam([
        { taskId: "t-task-1", points: 3 },
        { taskId: "t-task-2", points: 2 },
      ]),
      map([
        ["t-task-1", choice("q1", 1, 4)],
        ["t-task-2", choice("q2", 1, 4)],
      ]),
      map<ExamAnswer>([
        ["t-task-1", { kind: "choice", selected: [0] }],
        ["t-task-2", { kind: "choice", selected: [1] }],
      ]),
    );
    expect(result.total).toBe(3);
    expect(result.maxPoints).toBe(5);
    expect(result.percentage).toBeCloseTo(60, 10);
    expect(result.passed).toBe(true);
  });

  it("fails just below the pass mark", () => {
    const result = scoreExam(
      exam([
        { taskId: "t-task-1", points: 2 },
        { taskId: "t-task-2", points: 3 },
      ]),
      map([
        ["t-task-1", choice("q1", 1, 4)],
        ["t-task-2", choice("q2", 1, 4)],
      ]),
      map<ExamAnswer>([
        ["t-task-1", { kind: "choice", selected: [0] }],
        ["t-task-2", { kind: "choice", selected: [1] }],
      ]),
    );
    expect(result.total).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("reproduces a 52-point, 60%-to-pass paper by hand", () => {
    // A miniature of the iSAQB Beispielprüfung's shape: one single-answer,
    // one multiple-response, one row assignment.
    const result = scoreExam(
      exam([
        { taskId: "t-task-a", points: 1 }, // single answer, right -> 1
        { taskId: "t-task-p", points: 2 }, // 3 marks, 2 right 1 wrong -> 2/3
        { taskId: "t-task-k", points: 3 }, // 3 rows, 3 right -> 3
      ]),
      map([
        ["t-task-a", choice("qa", 1, 4)],
        ["t-task-p", choice("qp", 3, 5)],
        ["t-task-k", assign("qk", [0, 1, 0])],
      ]),
      map<ExamAnswer>([
        ["t-task-a", { kind: "choice", selected: [0] }],
        ["t-task-p", { kind: "choice", selected: [0, 1, 4] }],
        ["t-task-k", { kind: "assign", chosen: [0, 1, 0] }],
      ]),
    );
    expect(result.total).toBeCloseTo(1 + 2 / 3 + 3, 10);
    expect(result.maxPoints).toBe(6);
    expect(result.passed).toBe(true);
    expect(result.questions.map((q) => q.correct)).toEqual([true, false, true]);
  });

  it("scores an exam entry whose question is missing as 0", () => {
    const result = scoreExam(
      exam([{ taskId: "t-task-gone", points: 2 }]),
      map([]),
      map<ExamAnswer>([]),
    );
    expect(result.total).toBe(0);
    expect(result.maxPoints).toBe(2);
    expect(result.passed).toBe(false);
  });
});
