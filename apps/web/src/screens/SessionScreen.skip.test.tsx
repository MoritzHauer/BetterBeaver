import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Question } from "@betterbeaver/engine";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";
import { setLearning } from "../learning";

/**
 * The Skip verb (plan 0022 §5): tap skips by the configured default,
 * long-press (`contextmenu`) offers 1 week / 1 month / 1 year.
 *
 * The control renders only where `onSkip` is passed — review sessions — so
 * the absence case is tested too: unit practice is not due-driven, and a
 * skip there would do nothing visible while looking like it did something.
 */

const questions: Question[] = [
  { kind: "recall", unitId: "t-unit-a", prompt: "a", reveal: ["a-answer"] },
  { kind: "recall", unitId: "t-unit-b", prompt: "b", reveal: ["b-answer"] },
];

const lookup: TapLookup = {
  domainContent: {
    domain: {
      id: "t-domain",
      code: "t",
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

function renderSession(
  onSkip?: (ids: string[], days: number) => Promise<void>,
) {
  render(
    <SessionScreen
      title="Daily Review"
      questions={questions}
      bookId="t-topic"
      lookup={lookup}
      onGrade={() => Promise.resolve()}
      onSkip={onSkip}
      onFinished={() => {}}
      onExit={() => {}}
      requeueOnAgain
    />,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Skip", () => {
  it("tap skips by the configured default and moves on without grading", async () => {
    const onSkip = vi.fn(() => Promise.resolve());
    const onGrade = vi.fn(() => Promise.resolve());
    setLearning({ skip: "month" });
    render(
      <SessionScreen
        title="Daily Review"
        questions={questions}
        bookId="t-topic"
        lookup={lookup}
        onGrade={onGrade}
        onSkip={onSkip}
        onFinished={() => {}}
        onExit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(onSkip).toHaveBeenCalledWith(["t-unit-a"], 30);
    expect(onGrade).not.toHaveBeenCalled();
    // Moved to the next card.
    expect(await screen.findByText("b")).toBeTruthy();
  });

  it("long-press offers the three lengths, and each skips by its own", async () => {
    const onSkip = vi.fn(() => Promise.resolve());
    renderSession(onSkip);

    fireEvent.contextMenu(screen.getByRole("button", { name: /Skip/ }));
    const sheet = await screen.findByRole("dialog", { name: "Skip this card" });
    expect(sheet).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "1 year" }));
    expect(onSkip).toHaveBeenCalledWith(["t-unit-a"], 365);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is absent from a session that passes no onSkip (unit practice)", () => {
    renderSession(undefined);
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
  });

  it("does not strand the learner when the write fails", async () => {
    renderSession(() => Promise.reject(new Error("quota")));

    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(await screen.findByText("b")).toBeTruthy();
  });
});
