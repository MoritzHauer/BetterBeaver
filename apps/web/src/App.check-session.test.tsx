import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BookDocument } from "@betterbeaver/schema";
import type { SrsState } from "@betterbeaver/srs";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * Plan 0027 §12, "Grading: once per question, ever": a Check answer is
 * graded into SRS only for a question whose level was 0 when the session
 * opened. This drives the app end to end over a tiny two-question Check
 * (mocked in place of the bundled demo Book, which has no choice/assign
 * content) and checks the SRS write each question actually produced.
 */

const BOOK: BookDocument = {
  topic: {
    id: "demo",
    code: "dx",
    domainId: "demo",
    title: "Check test book",
    description: "",
    lessonIds: ["dx-lesson-1"],
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
      taskIds: ["dx-task-choice"],
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
    {
      id: "dx-task-choice",
      type: "choice",
      itemIds: ["dx-item-q1", "dx-item-q2"],
    },
  ],
  resources: [
    { id: "dx-resource-1", title: "Source", path: "internal://test" },
    // The real demo domain's lexicon entries validate their `sourceRef`
    // against the *Book's* resource pool too — carried over unchanged so
    // replacing the Book here doesn't strand them.
    {
      id: "dx-resource-intro",
      path: "internal://betterbeaver-intro",
      title: "BetterBeaver introduction content",
    },
  ],
  notes: [],
  exams: [],
};

// The bundled demo Book carries no choice/assign content yet, so the Check
// under test is a mocked stand-in — same mechanism `bundled.ts`'s own
// callers use to seed "demo" when nothing is cached (`source.ts`'s
// `buildMembers`). The domain half is left as the real bundled one.
vi.mock("./content/bundled", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content/bundled")>();
  return {
    ...actual,
    bundledBookDocuments: () => new Map([["demo", BOOK]]),
  };
});

describe("Check session grading (plan 0027 §12)", () => {
  // No `globals: true` in this project, so RTL's auto-cleanup never runs.
  beforeEach(() => {
    localStorage.clear();
    // dx-item-q1 is already at level 1 ("previously at level ≥ 1");
    // dx-item-q2 is untouched (level 0). Same shape `seedLevels()` uses in
    // App.session-edit.test.tsx.
    localStorage.setItem(
      "bb.item.dx-item-q1",
      JSON.stringify({
        due: "2999-01-01T00:00:00.000Z",
        intervalDays: 1,
        ease: 2.5,
        reps: 1,
        levelDay: "2020-01-01",
      }),
    );
  });
  afterEach(cleanup);

  it("grades both questions, but writes bb.item.* only for the level-0 one", async () => {
    const contentInit = await initContentSource();
    window.location.hash =
      "#/books/demo/lessons/dx-lesson-1/units/dx-unit-1/check";
    render(<App contentInit={contentInit} />);

    // `unit.taskIds` order: dx-item-q1 first, dx-item-q2 second.
    await screen.findByText("Question one?");
    fireEvent.click(screen.getByText("Right one"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await screen.findByText("Question two?");
    fireEvent.click(screen.getByText("Right two"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await screen.findByText("Session complete!");

    // The level-0 question graded for real…
    const q2 = localStorage.getItem("bb.item.dx-item-q2");
    expect(q2).not.toBeNull();
    expect((JSON.parse(q2 ?? "{}") as SrsState).reps).toBeGreaterThan(0);

    // …the already-passed one's stored state is exactly what it was before
    // this session — `recordGrade` was never called for it.
    const q1 = localStorage.getItem("bb.item.dx-item-q1");
    expect(JSON.parse(q1 ?? "{}") as SrsState).toEqual({
      due: "2999-01-01T00:00:00.000Z",
      intervalDays: 1,
      ease: 2.5,
      reps: 1,
      levelDay: "2020-01-01",
    });
  });
});
