import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Question } from "@betterbeaver/engine";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";

/**
 * The same-session requeue (plan 0022 §4): a card failed in Daily Review
 * comes back three cards later, and the session is not over until it has
 * been answered again.
 *
 * Worth its own test because the queue is the one piece of session state the
 * props no longer fully determine — completion now compares against a list
 * that grows under it, and getting that wrong either ends the session early
 * or never ends it at all. The `requeueOnAgain` gate is tested from the
 * other side too: unit practice must be left alone, since its answer counts
 * drive task completion and plan 0020's lesson chaining.
 */

function recall(id: string, prompt: string): Question {
  return { kind: "recall", unitId: id, prompt, reveal: [`${prompt}-answer`] };
}

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

/** Reveals the current card and grades it, returning the prompt it showed.
 * Waits for the next card's reveal button (or the summary) so each call
 * lands on a settled screen. */
async function answer(grade: "Again" | "Hard" | "Good"): Promise<string> {
  const prompt = document.querySelector("main.session p.prompt")?.textContent;
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${grade}`) }),
  );
  await screen.findByRole("button", { name: /^(Show answer|Done)$/ });
  return prompt ?? "";
}

afterEach(cleanup);

describe("Daily Review requeue", () => {
  it("re-shows a failed card three cards later and holds the session open for it", async () => {
    const onFinished = vi.fn();
    render(
      <SessionScreen
        title="Daily Review"
        questions={["a", "b", "c", "d"].map((id) => recall(id, id))}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={onFinished}
        onExit={() => {}}
        requeueOnAgain
      />,
    );

    expect(await answer("Again")).toBe("a");
    // Three cards later, not the next one.
    expect(await answer("Good")).toBe("b");
    expect(await answer("Good")).toBe("c");
    expect(await answer("Good")).toBe("d");
    // The session would have ended here without the requeue.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(await answer("Good")).toBe("a");

    await screen.findByRole("button", { name: "Done" });
  });

  it("appends at the end when fewer than three cards remain", async () => {
    render(
      <SessionScreen
        title="Daily Review"
        questions={[recall("a", "a"), recall("b", "b")]}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={() => {}}
        onExit={() => {}}
        requeueOnAgain
      />,
    );

    expect(await answer("Again")).toBe("a");
    expect(await answer("Good")).toBe("b");
    expect(await answer("Good")).toBe("a");
    await screen.findByRole("button", { name: "Done" });
  });

  it("does not requeue the repeat visit, however it goes", async () => {
    render(
      <SessionScreen
        title="Daily Review"
        questions={[recall("a", "a")]}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={() => {}}
        onExit={() => {}}
        requeueOnAgain
      />,
    );

    expect(await answer("Again")).toBe("a");
    // Failing the repeat ends the session: "answered again" is the bar, not
    // "answered correctly", so a card can never extend a session forever.
    expect(await answer("Again")).toBe("a");
    await screen.findByRole("button", { name: "Done" });
  });

  it("leaves unit practice alone — no prop, no requeue", async () => {
    render(
      <SessionScreen
        title="Unit A"
        questions={[recall("a", "a"), recall("b", "b")]}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={() => {}}
        onExit={() => {}}
      />,
    );

    expect(await answer("Again")).toBe("a");
    expect(await answer("Again")).toBe("b");
    // Reaching Done after exactly two answers is the assertion: neither
    // failure came back.
    await screen.findByRole("button", { name: "Done" });
  });

  it("counts a requeued answer in the summary — it is one", async () => {
    const onFinished = vi.fn();
    render(
      <SessionScreen
        title="Daily Review"
        questions={[recall("a", "a")]}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={onFinished}
        onExit={() => {}}
        requeueOnAgain
      />,
    );

    await answer("Again");
    await answer("Good");
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));

    expect(onFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        recallCounts: { again: 1, hard: 0, good: 1 },
      }),
    );
  });
});
