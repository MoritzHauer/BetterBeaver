import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Question } from "@betterbeaver/engine";
import type { DomainContent } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";
import type { SessionOutcome } from "./session/useSessionQueue";

/**
 * A drill-driven session (plan 0025 §6): one whose questions are decided as
 * it goes rather than known before it starts.
 *
 * Worth its own test because the queue is the one piece of session state the
 * props no longer fully determine — the session ends when the drill says so,
 * and getting that wrong either ends it early or never ends it at all. This
 * replaces plan 0022 §4's same-session requeue, which §11 retired: that one
 * re-showed the identical card, in Daily Review only.
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

/** A drill that hands out `queued` in order and reports what it was told. */
function fakeDrill(queued: Question[], setQuestions: (q: Question[]) => void) {
  const seen: SessionOutcome[][] = [];
  let shown: Question[] = [];
  const drill = {
    answered: 0,
    remaining: queued.length + 1,
    extend(outcomes: SessionOutcome[]) {
      seen.push(outcomes);
      const next = queued.shift();
      if (next === undefined) {
        return false;
      }
      shown = [...shown, next];
      setQuestions(shown);
      return true;
    },
  };
  return { drill, seen, start: (first: Question) => (shown = [first]) };
}

function DrillHarness({
  first,
  rest,
  onOutcomes,
  onFinished = () => {},
}: {
  first: Question;
  rest: Question[];
  onOutcomes: (seen: SessionOutcome[][]) => void;
  onFinished?: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([first]);
  const queued = useRef(fakeDrill([...rest], setQuestions));
  queued.current.start(first);
  onOutcomes(queued.current.seen);
  return (
    <SessionScreen
      title="Beaver basics"
      questions={questions}
      bookId="t-topic"
      lookup={lookup}
      onGrade={() => Promise.resolve()}
      onFinished={onFinished}
      onExit={() => {}}
      drill={queued.current.drill}
    />
  );
}

describe("a drill-driven session", () => {
  it("asks for the next question only once the current one is answered", async () => {
    render(
      <DrillHarness
        first={recall("a", "a")}
        rest={[recall("b", "b")]}
        onOutcomes={() => {}}
      />,
    );
    expect(await answer("Good")).toBe("a");
    // The appended card lands a commit later — the queue picks it up in the
    // effect that syncs to `questions`, not in the same tick as the answer.
    await waitFor(() => {
      expect(document.querySelector("main.session p.prompt")?.textContent).toBe(
        "b",
      );
    });
    await answer("Good");
    await screen.findByRole("button", { name: "Done" });
  });

  it("ends when the drill says there is nothing left", async () => {
    const onFinished = vi.fn();
    render(
      <DrillHarness
        first={recall("a", "a")}
        rest={[]}
        onOutcomes={() => {}}
        onFinished={onFinished}
      />,
    );
    await answer("Good");
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("tells the drill what each card graded, and whether it was right", async () => {
    // The drill decides the next card from this: a miss comes back at an
    // expanding gap and a level lower (plan 0025 §6), which it can only do
    // if the outcome reaches it.
    let seen: SessionOutcome[][] = [];
    render(
      <DrillHarness
        first={recall("a", "a")}
        rest={[recall("b", "b")]}
        onOutcomes={(s) => (seen = s)}
      />,
    );
    await answer("Again");
    await answer("Good");
    expect(seen[0]).toEqual([{ unitId: "a", correct: false }]);
    expect(seen[1]).toEqual([{ unitId: "b", correct: true }]);
  });

  it("counts a Hard as not-yet-correct, so the word stays owed", async () => {
    // §6: the remaining count decrements only on a correct answer, and Hard
    // steps the level *back* — it is not a win.
    let seen: SessionOutcome[][] = [];
    render(
      <DrillHarness
        first={recall("a", "a")}
        rest={[]}
        onOutcomes={(s) => (seen = s)}
      />,
    );
    await answer("Hard");
    expect(seen[0]).toEqual([{ unitId: "a", correct: false }]);
  });

  it("shows correct answers owed, not cards queued", async () => {
    // A miss must not make the session read as getting longer.
    render(
      <DrillHarness
        first={recall("a", "a")}
        rest={[recall("b", "b")]}
        onOutcomes={() => {}}
      />,
    );
    const bar = document.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuemax")).toBe("2");
  });
});
