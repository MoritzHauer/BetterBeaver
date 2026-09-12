import { describe, it, expect } from "vitest";
import type {
  Content,
  Exam,
  ExamRuleset,
  Item,
  Task,
} from "@betterbeaver/schema";
import { scoreExam, readinessByLesson, type ExamAnswer } from "./exam.js";

const ISAQB: ExamRuleset = {
  passPercent: 60,
  timeLimitMinutes: 75,
  partialCredit: true,
  negativeMarking: true,
};

/** A `choice`-type question item: `n` correct options up front, one wrong one appended. */
function choiceItem(id: string, correctCount: number, wrongCount = 1): Item {
  const options = [
    ...Array.from({ length: correctCount }, (_, i) => ({
      text: `Right ${i}`,
      correct: true,
    })),
    ...Array.from({ length: wrongCount }, (_, i) => ({
      text: `Wrong ${i}`,
      correct: false,
    })),
  ];
  return {
    id,
    kind: "question",
    payload: { stem: "Stem", options },
    sourceRef: "t-resource-1",
  };
}

/** An `assign`-type question item: one row per entry in `correctness`. */
function assignItem(id: string, correctness: boolean[]): Item {
  return {
    id,
    kind: "question",
    payload: {
      stem: "Stem",
      options: correctness.map((correct, i) => ({ text: `Row ${i}`, correct })),
      labels: ["Yes", "No"],
    },
    sourceRef: "t-resource-1",
  };
}

function taskFor(id: string, itemId: string, type: "choice" | "assign"): Task {
  return { id, type, itemIds: [itemId] };
}

function content(tasks: Task[], items: Item[]): Content {
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

function examWith(
  questions: { taskId: string; points: number; lessonId?: string }[],
  ruleset: ExamRuleset,
): Exam {
  return {
    id: "t-exam",
    topicId: "t-topic",
    title: "Exam",
    description: "",
    questions,
    ruleset,
  };
}

describe("scoreExam", () => {
  it("a wrong single-answer choice scores 0, not negative (iSAQB ruleset)", () => {
    const task = taskFor("q1", "i1", "choice");
    const exam = examWith([{ taskId: "q1", points: 1 }], ISAQB);
    const answers: Record<string, ExamAnswer> = { q1: [1] }; // the wrong option
    const result = scoreExam(
      exam,
      answers,
      content([task], [choiceItem("i1", 1)]),
    );
    expect(result.questions[0]!.points).toBe(0);
  });

  it("a 3-of-3-correct choice answered 2 right + 1 wrong scores 2*(2-1)/3", () => {
    const task = taskFor("q1", "i1", "choice");
    const exam = examWith([{ taskId: "q1", points: 2 }], ISAQB);
    // options: [right0, right1, right2, wrong0]; select right0, right1, wrong0
    const answers: Record<string, ExamAnswer> = { q1: [0, 1, 3] };
    const result = scoreExam(
      exam,
      answers,
      content([task], [choiceItem("i1", 3)]),
    );
    expect(result.questions[0]!.points).toBeCloseTo((2 * (2 - 1)) / 3);
  });

  it("a fully blank assign scores 0", () => {
    const task = taskFor("q1", "i1", "assign");
    const exam = examWith([{ taskId: "q1", points: 2 }], ISAQB);
    // no answer stored for q1 at all: a missing answer counts as empty array
    const result = scoreExam(
      exam,
      {},
      content([task], [assignItem("i1", [true, false])]),
    );
    expect(result.questions[0]!.points).toBe(0);
  });

  it("a 3-row assign with 2 right and 1 blank scores P*2/3", () => {
    const task = taskFor("q1", "i1", "assign");
    const exam = examWith([{ taskId: "q1", points: 3 }], ISAQB);
    // rows: correct=[true, false, true]; answer row0=0 (matches true -> right),
    // row1=1 (matches false -> right), row2=null (blank)
    const answers: Record<string, ExamAnswer> = { q1: [0, 1, null] };
    const result = scoreExam(
      exam,
      answers,
      content([task], [assignItem("i1", [true, false, true])]),
    );
    expect(result.questions[0]!.points).toBeCloseTo((3 * 2) / 3);
  });

  it("partialCredit: false scores 0 for a partial answer and P for a full one", () => {
    const ruleset: ExamRuleset = { ...ISAQB, partialCredit: false };
    const partialTask = taskFor("q1", "i1", "choice");
    const fullTask = taskFor("q2", "i2", "choice");
    const exam = examWith(
      [
        { taskId: "q1", points: 5 },
        { taskId: "q2", points: 5 },
      ],
      ruleset,
    );
    const answers: Record<string, ExamAnswer> = {
      q1: [0, 1], // 2 of 3 right, 0 wrong
      q2: [0, 1, 2], // all 3 right
    };
    const result = scoreExam(
      exam,
      answers,
      content(
        [partialTask, fullTask],
        [choiceItem("i1", 3), choiceItem("i2", 3)],
      ),
    );
    expect(result.questions[0]!.points).toBe(0);
    expect(result.questions[1]!.points).toBe(5);
  });

  it("negativeMarking: false ignores wrong marks: 2 right + 1 wrong on n=3 scores P*2/3", () => {
    const ruleset: ExamRuleset = { ...ISAQB, negativeMarking: false };
    const task = taskFor("q1", "i1", "choice");
    const exam = examWith([{ taskId: "q1", points: 6 }], ruleset);
    const answers: Record<string, ExamAnswer> = { q1: [0, 1, 3] };
    const result = scoreExam(
      exam,
      answers,
      content([task], [choiceItem("i1", 3)]),
    );
    expect(result.questions[0]!.points).toBeCloseTo((6 * 2) / 3);
  });

  it("passes exactly at the pass mark (31.2 = 60% of 52)", () => {
    // 52 one-point choice questions, each with 5 correct options (n=5).
    // 31 answered fully (score 1 each), 1 answered with exactly 1 of 5
    // (score 0.2), 20 left blank (score 0). Total = 31.2 = 60% of 52.
    const items = Array.from({ length: 52 }, (_, i) =>
      choiceItem(`i${i}`, 5, 0),
    );
    const tasks = items.map((item, i) => taskFor(`q${i}`, item.id, "choice"));
    const exam = examWith(
      tasks.map((t) => ({ taskId: t.id, points: 1 })),
      ISAQB,
    );
    const answers: Record<string, ExamAnswer> = {};
    for (let i = 0; i < 31; i++) {
      answers[`q${i}`] = [0, 1, 2, 3, 4]; // full marks
    }
    answers.q31 = [0]; // 1 of 5
    // q32..q51 left unanswered
    const result = scoreExam(exam, answers, content(tasks, items));
    expect(result.total).toBeCloseTo(31.2);
    expect(result.passed).toBe(true);
  });

  it("passes at the pass mark even when float accumulation undershoots it", () => {
    // 156 one-point questions each scoring exactly 1/5: summing 1/5 156
    // times in float gives 31.19999999999992 (plan §4's worked example),
    // just under 31.2 = 20% of 156, which the tolerance must cover.
    const items = Array.from({ length: 156 }, (_, i) =>
      choiceItem(`i${i}`, 5, 0),
    );
    const tasks = items.map((item, i) => taskFor(`q${i}`, item.id, "choice"));
    const ruleset: ExamRuleset = { ...ISAQB, passPercent: 20 };
    const exam = examWith(
      tasks.map((t) => ({ taskId: t.id, points: 1 })),
      ruleset,
    );
    const answers: Record<string, ExamAnswer> = {};
    for (const t of tasks) {
      answers[t.id] = [0]; // 1 of 5 each
    }
    const result = scoreExam(exam, answers, content(tasks, items));
    expect(result.total).toBeLessThan(31.2);
    expect(result.passed).toBe(true);
  });

  it("missedTaskIds lists partial and zero scores, in exam order, and omits full ones", () => {
    const fullTask = taskFor("full", "i-full", "choice");
    const partialTask = taskFor("partial", "i-partial", "choice");
    const zeroTask = taskFor("zero", "i-zero", "choice");
    const exam = examWith(
      [
        { taskId: "full", points: 2 },
        { taskId: "partial", points: 2 },
        { taskId: "zero", points: 2 },
      ],
      ISAQB,
    );
    const answers: Record<string, ExamAnswer> = {
      full: [0, 1, 2],
      partial: [0], // 1 of 3
      zero: [3], // the only wrong option
    };
    const result = scoreExam(
      exam,
      answers,
      content(
        [fullTask, partialTask, zeroTask],
        [
          choiceItem("i-full", 3),
          choiceItem("i-partial", 3),
          choiceItem("i-zero", 3),
        ],
      ),
    );
    expect(result.missedTaskIds).toEqual(["partial", "zero"]);
  });

  it("a dangling taskId scores 0 and does not throw", () => {
    const exam = examWith([{ taskId: "ghost", points: 4 }], ISAQB);
    expect(() => scoreExam(exam, {}, content([], []))).not.toThrow();
    const result = scoreExam(exam, {}, content([], []));
    expect(result.questions[0]).toEqual({
      taskId: "ghost",
      points: 0,
      maxPoints: 4,
    });
    expect(result.missedTaskIds).toEqual(["ghost"]);
  });
});

describe("readinessByLesson", () => {
  const lessonIds = ["L1", "L2", "L3"];

  it("orders buckets by lessonIds, unknown lessons after, Other last; picks the weakest with ties to the earlier bucket; excludes unseen questions", () => {
    const exam = examWith(
      [
        { taskId: "t1", points: 2, lessonId: "L2" },
        { taskId: "t2", points: 2, lessonId: "L1" },
        { taskId: "t3", points: 2, lessonId: "L1" },
        { taskId: "t4", points: 2 }, // Other
        { taskId: "t5", points: 2, lessonId: "Lx" }, // unknown lesson
        { taskId: "t6", points: 2, lessonId: "L3" },
      ],
      ISAQB,
    );
    const pointsByTaskId = {
      t1: 1, // L2: 1/2 = 50%
      t2: 2,
      t3: 0, // L1: 2/4 = 50%
      t4: 0, // Other: 0/2 = 0%, must never be picked as weakest
      t5: 2, // Lx: 2/2 = 100%
      // t6 absent: the learner never saw it, L3 gets no bucket at all
    };
    const { buckets, weakestLessonId } = readinessByLesson(
      exam,
      pointsByTaskId,
      lessonIds,
    );
    expect(buckets.map((b) => b.lessonId)).toEqual(["L1", "L2", "Lx", null]);
    expect(weakestLessonId).toBe("L1"); // ties with L2 at 50%, L1 is earlier
  });

  it("returns weakestLessonId: null when only the Other bucket exists", () => {
    const exam = examWith([{ taskId: "t1", points: 2 }], ISAQB);
    const { buckets, weakestLessonId } = readinessByLesson(
      exam,
      { t1: 1 },
      lessonIds,
    );
    expect(buckets).toEqual([
      { lessonId: null, points: 1, maxPoints: 2, percent: 50 },
    ]);
    expect(weakestLessonId).toBeNull();
  });
});
