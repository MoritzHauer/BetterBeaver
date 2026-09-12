import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Content, Exam, Item, Task } from "@betterbeaver/schema";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "./components/TappableText";
import { ExamReviewSession } from "./App";

/**
 * Review mode (plan 0027 §6 amendment): the exam's questions, untimed,
 * immediate feedback, writing nothing at all — no SM-2 state, no attempt, no
 * `lastResult`, no streak day. `App.tsx`'s preview mechanism (`PREVIEW_STORE`)
 * is what makes that true, and this pins it for the exam's own entry point.
 */

const choiceItem: Item = {
  id: "r-item-1",
  kind: "question",
  payload: {
    stem: "Which of these are architectural views?",
    options: [
      { text: "Right answer", correct: true },
      { text: "Wrong answer", correct: false },
    ],
  },
  sourceRef: "r-src",
};
const choiceTask: Task = {
  id: "r-task-1",
  type: "choice",
  itemIds: [choiceItem.id],
};

const exam: Exam = {
  id: "r-exam",
  topicId: "r-topic",
  title: "Mock Exam",
  description: "",
  questions: [{ taskId: choiceTask.id, points: 2 }],
  ruleset: {
    passPercent: 60,
    timeLimitMinutes: 75,
    partialCredit: true,
    negativeMarking: true,
  },
};

const content: Content = {
  topic: {
    id: "r-topic",
    code: "r",
    domainId: "r-domain",
    title: "Book",
    description: "",
    lessonIds: [],
    examIds: [exam.id],
  },
  lessons: [],
  units: [],
  items: [choiceItem],
  tasks: [choiceTask],
  exams: [exam],
  resources: [],
  notes: [],
};

const lookup: TapLookup = {
  domainContent: {
    domain: {
      id: "r-domain",
      code: "r",
      kind: "language",
      title: "Domain",
      glossLanguage: "en",
    },
    entries: [],
    families: [],
    linksByEntryId: new Map(),
  } satisfies DomainContent,
  listStore: {
    getLists: () => Promise.resolve([]),
    saveList: () => Promise.resolve(),
    deleteList: () => Promise.resolve(),
  },
  userEntryStore: {
    getEntries: () => Promise.resolve([]),
    saveEntry: () => Promise.resolve(),
    deleteEntry: () => Promise.resolve(),
  },
};

afterEach(cleanup);

describe("Review mode (plan 0027 §6 amendment)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("leaves bb.item.*, bb.streak.* and bb.exam.* untouched", async () => {
    render(
      <ExamReviewSession
        content={content}
        exam={exam}
        lookup={lookup}
        onDone={() => {}}
      />,
    );
    await screen.findByText(choiceItem.payload.stem);

    fireEvent.click(screen.getByText("Right answer"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Session complete!")).toBeTruthy();
    });

    expect(
      Object.keys(localStorage).filter((key) => key.startsWith("bb.")),
    ).toEqual([]);
  });
});
