import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Question } from "@betterbeaver/engine";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";

/**
 * The practice session's back-swipe (owner request, 2026-07-30): a rightward
 * swipe leaves the quiz for the Unit trail's last content page, the same
 * direction `UnitScreen`'s own `goPrev` uses.
 *
 * The summary panel is the case worth a test: leaving there must go through
 * Done or `nextAction`, which is what advances the lesson — a swipe that
 * still fired would silently skip lesson progression, and nothing else in the
 * app would notice.
 */

const questions: Question[] = [
  {
    kind: "recall",
    unitId: "t-unit-a",
    prompt: "суу",
    reveal: ["water"],
  },
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

/** Finger down on the left, up on the right — `UnitScreen`'s back gesture. */
function swipeRight() {
  const main = document.querySelector("main.session")!;
  fireEvent.touchStart(main, { touches: [{ clientX: 60, clientY: 400 }] });
  fireEvent.touchEnd(main, {
    changedTouches: [{ clientX: 260, clientY: 400 }],
  });
}

// No `globals: true` in this project, so RTL's auto-cleanup never runs.
afterEach(cleanup);

describe("SessionScreen back-swipe", () => {
  it("leaves a question, but never the summary", async () => {
    const onSwipeBack = vi.fn();
    render(
      <SessionScreen
        title="Unit A"
        questions={questions}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={() => {}}
        onExit={() => {}}
        onSwipeBack={onSwipeBack}
      />,
    );

    swipeRight();
    expect(onSwipeBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByRole("button", { name: "Done" });

    swipeRight();
    expect(onSwipeBack).toHaveBeenCalledTimes(1);
  });
});
