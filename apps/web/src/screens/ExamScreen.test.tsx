import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Content, Exam, Item, Task } from "@betterbeaver/schema";
import { ExamScreen } from "./ExamScreen";
import { examKey, readExamRecord } from "../progress/exam-attempts";

/**
 * The exam run (plan 0027 §6). Three things here exist nowhere else in the
 * app and so are worth pinning by test rather than by browser pass: nothing
 * grades before Submit, the clock is wall-clock and absolute, and the run
 * writes no SRS state at all.
 */

const choiceItem: Item = {
  id: "t-item-q1",
  kind: "question",
  payload: {
    stem: "Which of these are views?",
    options: [
      { text: "Bausteinsicht", correct: true },
      { text: "Laufzeitsicht", correct: true },
      { text: "Dienstagssicht", correct: false },
    ],
  },
  sourceRef: "t-resource-1",
};
const assignItem: Item = {
  id: "t-item-q2",
  kind: "question",
  payload: {
    stem: "Richtig oder falsch?",
    options: [
      { text: "A blackbox hides its internals", correct: true },
      { text: "A whitebox hides its internals", correct: false },
    ],
    labels: ["Richtig", "Falsch"],
  },
  sourceRef: "t-resource-1",
};
const choiceTask: Task = {
  id: "t-task-q1",
  type: "choice",
  itemIds: [choiceItem.id],
};
const assignTask: Task = {
  id: "t-task-q2",
  type: "assign",
  itemIds: [assignItem.id],
};

const exam: Exam = {
  id: "t-exam-mock",
  topicId: "t-topic",
  title: "Beispielprüfung",
  description: "Quelle: iSAQB® e.V.",
  questions: [
    { taskId: choiceTask.id, points: 2 },
    { taskId: assignTask.id, points: 2 },
  ],
  ruleset: {
    passPercent: 60,
    timeLimitMinutes: 75,
    partialCredit: true,
    negativeMarking: true,
  },
};

const content: Content = {
  topic: {
    id: "t-topic",
    code: "t",
    domainId: "t",
    title: "Book",
    description: "",
    lessonIds: [],
    examIds: [exam.id],
  },
  lessons: [],
  units: [],
  items: [choiceItem, assignItem],
  tasks: [choiceTask, assignTask],
  exams: [exam],
  resources: [],
  notes: [],
};

function renderExam(props: Partial<Parameters<typeof ExamScreen>[0]> = {}) {
  const onOpenQuestion = vi.fn();
  const onOpenReport = vi.fn();
  const onPracticeMissed = vi.fn();
  render(
    <ExamScreen
      content={content}
      exam={exam}
      onOpenQuestion={onOpenQuestion}
      onOpenIntro={vi.fn()}
      onOpenReport={onOpenReport}
      onPracticeMissed={onPracticeMissed}
      onBack={vi.fn()}
      {...props}
    />,
  );
  return { onOpenQuestion, onOpenReport, onPracticeMissed };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the exam intro", () => {
  it("shows the ruleset the exam will be scored under", () => {
    renderExam();
    expect(screen.getByText("2 Fragen")).toBeTruthy();
    expect(screen.getByText("4 Punkte")).toBeTruthy();
    expect(screen.getByText("Bestanden ab 60%")).toBeTruthy();
    expect(screen.getByText("75 Minuten, am Stück")).toBeTruthy();
  });

  it("starts an attempt with an absolute deadline", () => {
    const { onOpenQuestion } = renderExam();
    fireEvent.click(screen.getByText("Prüfung starten"));
    const record = readExamRecord(exam.id);
    expect(record.attempt).toBeDefined();
    expect(record.attempt!.deadlineAt - record.attempt!.startedAt).toBe(
      75 * 60_000,
    );
    expect(onOpenQuestion).toHaveBeenCalledWith(0);
  });

  it("offers Resume, not Start, while an attempt is still running", () => {
    localStorage.setItem(
      examKey(exam.id),
      JSON.stringify({
        attempt: {
          startedAt: Date.now(),
          deadlineAt: Date.now() + 60 * 60_000,
          answers: {},
        },
      }),
    );
    renderExam();
    expect(screen.queryByText("Prüfung starten")).toBeNull();
    expect(screen.getByText("Weitermachen")).toBeTruthy();
  });

  it("badges an exam whose every question is model-written", () => {
    const generated: Content = {
      ...content,
      items: content.items.map((item) =>
        item.kind === "question"
          ? { ...item, payload: { ...item.payload, generated: true } }
          : item,
      ),
    };
    renderExam({ content: generated });
    expect(screen.getByText("KI-generiert")).toBeTruthy();
  });

  it("does not badge an exam with one expert-reviewed question", () => {
    // Derived, never stored: one un-flagged question is enough.
    const mixed: Content = {
      ...content,
      items: content.items.map((item) =>
        item.id === choiceItem.id && item.kind === "question"
          ? { ...item, payload: { ...item.payload, generated: true } }
          : item,
      ),
    };
    renderExam({ content: mixed });
    expect(screen.queryByText("KI-generiert")).toBeNull();
  });
});

describe("the exam runner", () => {
  function startedRecord(deadlineOffsetMs = 60 * 60_000) {
    localStorage.setItem(
      examKey(exam.id),
      JSON.stringify({
        attempt: {
          startedAt: Date.now(),
          deadlineAt: Date.now() + deadlineOffsetMs,
          answers: {},
        },
      }),
    );
  }

  it("grades nothing before Submit — no verdict, no Check", () => {
    // The one genuinely new interaction in the app: every other question in
    // BetterBeaver grades the moment it is answered.
    startedRecord();
    renderExam({ questionIndex: 0 });
    fireEvent.click(screen.getByText("Bausteinsicht"));
    expect(screen.queryByText("Correct!")).toBeNull();
    expect(screen.queryByText("Check")).toBeNull();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("caps selection at the derived selectCount", () => {
    // Over-selection is unreachable rather than penalised (plan 0027 §4).
    startedRecord();
    renderExam({ questionIndex: 0 });
    fireEvent.click(screen.getByText("Bausteinsicht"));
    fireEvent.click(screen.getByText("Laufzeitsicht"));
    fireEvent.click(screen.getByText("Dienstagssicht"));
    const answer = readExamRecord(exam.id).attempt?.answers[choiceTask.id];
    expect(answer).toEqual({ kind: "choice", selected: [0, 1] });
  });

  it("keeps an answer across a remount — the attempt is the state", () => {
    startedRecord();
    renderExam({ questionIndex: 0 });
    fireEvent.click(screen.getByText("Bausteinsicht"));
    cleanup();
    renderExam({ questionIndex: 0 });
    expect(
      screen
        .getByRole("button", { name: /Bausteinsicht/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("marks answered questions in the navigator", () => {
    startedRecord();
    renderExam({ questionIndex: 0 });
    expect(screen.getByLabelText("Frage 1, offen")).toBeTruthy();
    fireEvent.click(screen.getByText("Bausteinsicht"));
    expect(screen.getByLabelText("Frage 1, beantwortet")).toBeTruthy();
    expect(screen.getByLabelText("Frage 2, offen")).toBeTruthy();
  });

  it("submits and moves the attempt to the last result", () => {
    startedRecord();
    const { onOpenReport } = renderExam({ questionIndex: 0 });
    fireEvent.click(screen.getByText("Bausteinsicht"));
    fireEvent.click(screen.getByText("Abgeben"));
    const record = readExamRecord(exam.id);
    expect(record.attempt).toBeUndefined();
    expect(record.lastResult?.answers[choiceTask.id]).toEqual({
      kind: "choice",
      selected: [0],
    });
    expect(onOpenReport).toHaveBeenCalled();
  });

  it("submits immediately when opened past its deadline", () => {
    // The whole point of an absolute deadline: the run ends at its own
    // wall-clock time whether or not anything was watching.
    localStorage.setItem(
      examKey(exam.id),
      JSON.stringify({
        attempt: {
          startedAt: Date.now() - 2 * 60 * 60_000,
          deadlineAt: Date.now() - 60 * 60_000,
          answers: { [choiceTask.id]: { kind: "choice", selected: [0, 1] } },
        },
      }),
    );
    const { onOpenReport } = renderExam({ questionIndex: 0 });
    expect(onOpenReport).toHaveBeenCalled();
    const record = readExamRecord(exam.id);
    expect(record.attempt).toBeUndefined();
    expect(record.lastResult?.answers[choiceTask.id]).toEqual({
      kind: "choice",
      selected: [0, 1],
    });
  });

  it("writes no SRS state, no attempted entry and no streak day", () => {
    // Plan 0027 §6's hard rule: exam scoring never touches the scheduler.
    // Only the practice session the report offers does.
    startedRecord();
    renderExam({ questionIndex: 0 });
    fireEvent.click(screen.getByText("Bausteinsicht"));
    fireEvent.click(screen.getByText("Abgeben"));
    const keys = Object.keys(localStorage);
    expect(keys.filter((key) => key.startsWith("bb.item."))).toEqual([]);
    expect(keys.filter((key) => key.startsWith("bb.streak."))).toEqual([]);
    expect(keys).not.toContain("bb.attempted");
    expect(keys).toEqual([examKey(exam.id)]);
  });
});

describe("the exam report", () => {
  it("says there is no result yet when nothing was submitted", () => {
    renderExam({ atEnd: true });
    expect(
      screen.getByText("Für diese Prüfung gibt es noch kein Ergebnis."),
    ).toBeTruthy();
  });

  it("reports the arithmetic of §4 and offers the missed questions", () => {
    // choice: 2 of 2 right, 0 wrong -> 2 points.
    // assign: 1 of 2 rows right, 1 wrong -> 2 × (1−1)/2 = 0.
    // Total 2 of 4 = 50%, below the 60% pass mark.
    localStorage.setItem(
      examKey(exam.id),
      JSON.stringify({
        lastResult: {
          submittedAt: Date.now(),
          answers: {
            [choiceTask.id]: { kind: "choice", selected: [0, 1] },
            [assignTask.id]: { kind: "assign", chosen: [0, 0] },
          },
        },
      }),
    );
    const { onPracticeMissed } = renderExam({ atEnd: true });
    expect(screen.getByText("Nicht bestanden")).toBeTruthy();
    expect(
      screen.getByText(/2 von 4 Punkten · 50\.0% · bestanden ab 60%/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Falsche Fragen üben (1)"));
    expect(onPracticeMissed).toHaveBeenCalledWith([assignTask.id]);
  });

  it("passes at exactly the pass mark and offers nothing to practise", () => {
    localStorage.setItem(
      examKey(exam.id),
      JSON.stringify({
        lastResult: {
          submittedAt: Date.now(),
          answers: {
            [choiceTask.id]: { kind: "choice", selected: [0, 1] },
            [assignTask.id]: { kind: "assign", chosen: [0, 1] },
          },
        },
      }),
    );
    renderExam({ atEnd: true });
    expect(screen.getByText("Bestanden")).toBeTruthy();
    expect(screen.queryByText(/Falsche Fragen üben/)).toBeNull();
  });
});
