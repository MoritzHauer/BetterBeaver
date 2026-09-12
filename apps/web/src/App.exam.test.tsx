import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BookDocument } from "@betterbeaver/schema";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * The exam run end to end (plan 0027 §6, step 8): intro, runner, report,
 * review mode, and "practise what you missed" — mocked in place of the
 * bundled demo Book, which has no exam content, the same mechanism
 * `App.check-session.test.tsx` uses.
 */

const BOOK: BookDocument = {
  topic: {
    id: "demo",
    code: "dx",
    domainId: "demo",
    title: "Exam test book",
    description: "",
    lessonIds: ["dx-lesson-1"],
    examIds: ["dx-exam-1"],
  },
  lessons: [
    {
      id: "dx-lesson-1",
      topicId: "demo",
      title: "Lesson",
      goal: "Goal",
      unitIds: ["dx-unit-1"],
    },
  ],
  units: [
    {
      id: "dx-unit-1",
      lessonId: "dx-lesson-1",
      title: "Unit",
      goal: "Goal",
      itemIds: ["dx-item-q1", "dx-item-q2"],
      taskIds: ["dx-task-q1", "dx-task-q2"],
      noteIds: [],
    },
  ],
  items: [
    {
      id: "dx-item-q1",
      kind: "question",
      payload: {
        stem: "Question one?",
        options: [
          { text: "Right one", correct: true },
          { text: "Wrong one", correct: false },
        ],
        explanation: "Because reasons.",
      },
      sourceRef: "dx-resource-1",
    },
    {
      id: "dx-item-q2",
      kind: "question",
      payload: {
        stem: "Question two?",
        options: [
          { text: "Right two", correct: true },
          { text: "Wrong two", correct: false },
        ],
      },
      sourceRef: "dx-resource-1",
    },
  ],
  tasks: [
    { id: "dx-task-q1", type: "choice", itemIds: ["dx-item-q1"] },
    { id: "dx-task-q2", type: "choice", itemIds: ["dx-item-q2"] },
  ],
  resources: [
    { id: "dx-resource-1", title: "Source", path: "internal://test" },
    {
      id: "dx-resource-intro",
      path: "internal://betterbeaver-intro",
      title: "BetterBeaver introduction content",
    },
  ],
  notes: [],
  exams: [
    {
      id: "dx-exam-1",
      topicId: "demo",
      title: "Sample exam",
      description: "Line one of the description.\nLine two, still visible.",
      questions: [
        { taskId: "dx-task-q1", points: 1, lessonId: "dx-lesson-1" },
        { taskId: "dx-task-q2", points: 1 },
      ],
      ruleset: {
        passPercent: 50,
        timeLimitMinutes: 30,
        partialCredit: true,
        negativeMarking: true,
      },
    },
  ],
};

vi.mock("./content/bundled", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content/bundled")>();
  return {
    ...actual,
    bundledBookDocuments: () => new Map([["demo", BOOK]]),
  };
});

function bbKeys(): string[] {
  return Object.keys(localStorage).filter(
    (key) =>
      key.startsWith("bb.item.") ||
      key.startsWith("bb.streak.") ||
      key.startsWith("bb.exam."),
  );
}

describe("exam run (plan 0027 §6)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the full description on the intro", async () => {
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo/exams/dx-exam-1";
    render(<App contentInit={contentInit} />);

    await screen.findByText("Sample exam");
    expect(screen.getByText(/Line one of the description\./)).not.toBeNull();
  });

  it("submits an attempt whose deadline has passed and lands on the report", async () => {
    localStorage.setItem(
      "bb.exam.dx-exam-1",
      JSON.stringify({
        attempt: {
          startedAt: "2020-01-01T00:00:00.000Z",
          deadlineAt: "2020-01-01T00:01:00.000Z", // long past
          answersByTaskId: { "dx-task-q1": [0] }, // correct
        },
      }),
    );
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo/exams/dx-exam-1";
    render(<App contentInit={contentInit} />);

    // 1 of 2 points = 50%, exactly the pass mark.
    await screen.findByText(/Passed/);
    expect(localStorage.getItem("bb.exam.dx-exam-1")).not.toContain(
      '"attempt"',
    );
  });

  it("the runner never shows correct/incorrect classes before submit", async () => {
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo/exams/dx-exam-1";
    render(<App contentInit={contentInit} />);

    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByText("Question one?");
    fireEvent.click(screen.getByText("Right one"));

    expect(document.querySelector(".correct")).toBeNull();
    expect(document.querySelector(".incorrect")).toBeNull();
  });

  it("the report shows the per-lesson rows and the explanation", async () => {
    localStorage.setItem(
      "bb.exam.dx-exam-1",
      JSON.stringify({
        lastResult: {
          submittedAt: "2020-01-01T00:00:00.000Z",
          pointsByTaskId: { "dx-task-q1": 1, "dx-task-q2": 0 },
          answersByTaskId: {
            "dx-task-q1": [0],
            "dx-task-q2": [1],
          },
        },
      }),
    );
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo/exams/dx-exam-1?end=1";
    render(<App contentInit={contentInit} />);

    await screen.findByText("Because reasons.");
    expect(screen.getByText(/Lesson: 1 \/ 1/)).not.toBeNull();
  });

  it("review mode writes no bb.item.*, bb.streak.* or bb.exam.* key", async () => {
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo/exams/dx-exam-1?review=1";
    render(<App contentInit={contentInit} />);

    await screen.findByText("Question one?");
    fireEvent.click(screen.getByText("Right one"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await screen.findByText("Question two?");
    fireEvent.click(screen.getByText("Right two"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Session complete!");

    expect(bbKeys()).toEqual([]);
  });

  it("running practise-missed twice changes no bb.item.* for a question answered right the first time", async () => {
    localStorage.setItem(
      "bb.exam.dx-exam-1",
      JSON.stringify({
        lastResult: {
          submittedAt: "2020-01-01T00:00:00.000Z",
          pointsByTaskId: { "dx-task-q1": 0, "dx-task-q2": 0 },
          answersByTaskId: {
            "dx-task-q1": [1], // wrong
            "dx-task-q2": [1], // wrong
          },
        },
      }),
    );
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo/exams/dx-exam-1?practice=1";
    render(<App contentInit={contentInit} />);

    // Run 1: both answered right, so both get real SRS state.
    await screen.findByText("Question one?");
    fireEvent.click(screen.getByText("Right one"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await screen.findByText("Question two?");
    fireEvent.click(screen.getByText("Right two"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Session complete!");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const q1AfterRun1 = localStorage.getItem("bb.item.dx-item-q1");
    expect(q1AfterRun1).not.toBeNull();

    // Run 2, from the report: lastResult (and so missedTaskIds) is
    // unchanged, so the button is still offered — but q1 is now at level ≥
    // 1, so this run's grade for it must be a no-op.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Practise the questions you missed",
      }),
    );
    await screen.findByText("Question one?");
    fireEvent.click(screen.getByText("Right one"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByRole("button", { name: "Continue" });

    expect(localStorage.getItem("bb.item.dx-item-q1")).toBe(q1AfterRun1);
  });

  it("shows a Book card with the last result once one exists", async () => {
    localStorage.setItem(
      "bb.exam.dx-exam-1",
      JSON.stringify({
        lastResult: {
          submittedAt: "2020-01-01T00:00:00.000Z",
          pointsByTaskId: { "dx-task-q1": 1, "dx-task-q2": 0 },
          answersByTaskId: {
            "dx-task-q1": [0],
            "dx-task-q2": [1],
          },
        },
      }),
    );
    const contentInit = await initContentSource();
    window.location.hash = "#/books/demo";
    render(<App contentInit={contentInit} />);

    await screen.findByText(/Last: \d+ %/);
    expect(screen.getByText(/weakest: Lesson/)).not.toBeNull();
  });
});
