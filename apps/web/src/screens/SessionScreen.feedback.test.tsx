import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DomainContent, Question } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";

/**
 * The header 👎 names the card on screen (`feedbackFor`), so the authoring
 * loop's `pull-feedback.ts` can tell which card was bad — and it re-reads the
 * device's vote per card instead of carrying one card's vote onto the next.
 */

const rpc = vi.fn(() => Promise.resolve({ error: null }));
vi.mock("../backend/supabase", () => ({ getSupabase: () => ({ rpc }) }));

const questions: Question[] = [
  { kind: "recall", unitId: "t-item-a", prompt: "a", reveal: ["a-answer"] },
  { kind: "recall", unitId: "t-item-b", prompt: "b", reveal: ["b-answer"] },
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

beforeEach(() => {
  localStorage.clear();
  rpc.mockClear();
});
afterEach(cleanup);

describe("session feedback", () => {
  it("votes on the current card's item, and starts the next card unvoted", async () => {
    render(
      <SessionScreen
        title="Daily Review"
        questions={questions}
        bookId="t-topic"
        lookup={lookup}
        feedbackFor={(index) => ({
          docId: "domain:t-domain",
          contentKind: "item",
          contentId: index === 0 ? "t-item-a" : "t-item-b",
        })}
        onGrade={() => Promise.resolve()}
        onSkip={() => Promise.resolve()}
        onFinished={() => {}}
        onExit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Thumbs down" }));
    expect(rpc).toHaveBeenCalledWith(
      "cast_vote",
      expect.objectContaining({
        p_doc_id: "domain:t-domain",
        p_content_kind: "item",
        p_content_id: "t-item-a",
        p_value: -1,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(await screen.findByText("b")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Thumbs down" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows no widget when nothing names the card", () => {
    render(
      <SessionScreen
        title="Daily Review"
        questions={questions}
        bookId="t-topic"
        lookup={lookup}
        onGrade={() => Promise.resolve()}
        onFinished={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Thumbs down" })).toBeNull();
  });
});
