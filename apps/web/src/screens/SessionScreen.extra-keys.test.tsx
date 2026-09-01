import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DomainContent, Question } from "@betterbeaver/engine";
import type { Quality } from "@betterbeaver/srs";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";
import { setLearning } from "../learning";

/**
 * The extra-key row (plan 0025 §10). Kyrgyz is the Russian layout plus
 * exactly three letters — ң, ө, ү — that no Russian keyboard produces, so
 * without this row a cloze blank or dictation target containing one is
 * unanswerable: grading is against the exact script, and
 * `normalizeTypedInput` deliberately never folds ң onto н
 * (`packages/engine/src/normalize.test.ts`).
 *
 * The row is driven by the domain's optional `extraChars`, so the
 * no-field case is tested too — that is every domain shipping today.
 */

const clozeQuestion: Question[] = [
  {
    kind: "cloze",
    unitId: "t-item::c1",
    prompt: "мен ___ ичем",
    target: "сүт",
  },
];

function lookupWith(extraChars?: string[]): TapLookup {
  return {
    domainContent: {
      domain: {
        id: "t-domain",
        code: "t",
        kind: "language",
        title: "Domain",
        glossLanguage: "en",
        ...(extraChars === undefined ? {} : { extraChars }),
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
}

function renderSession(extraChars?: string[]) {
  render(
    <SessionScreen
      title="Practice"
      questions={clozeQuestion}
      bookId="t-topic"
      lookup={lookupWith(extraChars)}
      onGrade={() => Promise.resolve()}
      onFinished={() => {}}
      onExit={() => {}}
    />,
  );
}

/** Renders a blank whose answer needs one of the declared characters, so a
 * learner on a Russian keyboard cannot type it without the row. */
function renderKeyed(
  extraChars: string[],
  onGrade: (unitId: string, quality: Quality) => Promise<void>,
) {
  render(
    <SessionScreen
      title="Practice"
      questions={[
        {
          kind: "cloze",
          unitId: "t-item::c1",
          prompt: "___ жыл",
          target: "жаңы",
        },
      ]}
      bookId="t-topic"
      lookup={lookupWith(extraChars)}
      onGrade={onGrade}
      onFinished={() => {}}
      onExit={() => {}}
    />,
  );
}

/** The answer field, narrowed — the caret assertions below need
 * `setSelectionRange`, which `getByRole` alone does not give us. */
function answerInput(): HTMLInputElement {
  const el = screen.getByRole("textbox");
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("expected the answer field to be an <input>");
  }
  return el;
}

// The row is off by default (plan 0025 §10) — the platform keyboard is the
// real fix and this is the fallback — so every test that expects keys has to
// opt in, and the default itself is asserted below.
beforeEach(() => {
  localStorage.clear();
  setLearning({ extraKeys: true });
});
afterEach(cleanup);

describe("extra-key row", () => {
  it("stays hidden by default, even where the domain declares extraChars", () => {
    localStorage.clear();
    renderSession(["ң", "ө", "ү"]);
    expect(screen.queryByRole("button", { name: "ң" })).toBeNull();
  });

  it("renders no row when the domain declares no extraChars", () => {
    renderSession();
    expect(screen.queryByRole("button", { name: "ң" })).toBeNull();
  });

  it("renders one key per declared character", () => {
    renderSession(["ң", "ө", "ү"]);
    for (const char of ["ң", "ө", "ү"]) {
      expect(screen.getByRole("button", { name: char })).not.toBeNull();
    }
  });

  it("inserts the character into the answer input", () => {
    renderSession(["ң", "ө", "ү"]);
    const input = answerInput();
    fireEvent.change(input, { target: { value: "сү" } });
    fireEvent.click(screen.getByRole("button", { name: "ү" }));
    expect(input.value).toBe("сүү");
  });

  it("inserts at the caret, not only at the end", () => {
    renderSession(["ң"]);
    const input = answerInput();
    fireEvent.change(input, { target: { value: "мее" } });
    input.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole("button", { name: "ң" }));
    expect(input.value).toBe("меңе");
  });

  it("replaces the selection when the learner has one", () => {
    renderSession(["ө"]);
    const input = answerInput();
    fireEvent.change(input, { target: { value: "кооз" } });
    input.setSelectionRange(1, 3);
    fireEvent.click(screen.getByRole("button", { name: "ө" }));
    expect(input.value).toBe("көз");
  });

  // The point of the whole row: an answer only reachable through it grades
  // correct (quality 4), and the Russian look-alike does not (quality 2).
  it("grades an answer completed from the key row as correct", async () => {
    const onGrade = vi.fn(() => Promise.resolve());
    renderKeyed(["ң"], onGrade);
    const input = answerInput();
    fireEvent.change(input, { target: { value: "жа" } });
    fireEvent.click(screen.getByRole("button", { name: "ң" }));
    fireEvent.change(input, { target: { value: input.value + "ы" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await vi.waitFor(() => expect(onGrade).toHaveBeenCalled());
    expect(onGrade).toHaveBeenCalledWith("t-item::c1", 4);
  });

  it("grades the Russian look-alike н as wrong", async () => {
    const onGrade = vi.fn(() => Promise.resolve());
    renderKeyed(["ң"], onGrade);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "жаны" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await vi.waitFor(() => expect(onGrade).toHaveBeenCalled());
    expect(onGrade).toHaveBeenCalledWith("t-item::c1", 2);
  });

  it("hides the row once the question is answered", () => {
    renderSession(["ң", "ө", "ү"]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "сүт" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.queryByRole("button", { name: "ң" })).toBeNull();
  });
});
