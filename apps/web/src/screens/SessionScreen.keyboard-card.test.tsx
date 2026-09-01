import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DomainContent, Question } from "@betterbeaver/engine";
import type { TapLookup } from "../components/TappableText";
import { SessionScreen } from "./SessionScreen";
import { keyboardPlatform } from "../components/KeyboardSetupCard";
import { getLearning } from "../learning";

/**
 * The keyboard setup card (plan 0025 §10). The platform keyboard is the real
 * fix for a script whose characters a learner's keyboard lacks, so the card
 * leads with the walkthrough and offers the in-app key row underneath as the
 * fallback — for iOS without a native layout, for managed or Play-less
 * devices, and for anyone who simply will not install one.
 */

const clozeQuestion: Question[] = [
  {
    kind: "cloze",
    unitId: "t-item::c1",
    prompt: "___ жыл",
    target: "жаңы",
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

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("keyboardPlatform", () => {
  it("routes each family to the walkthrough that describes its settings", () => {
    expect(
      keyboardPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("ios");
    expect(
      keyboardPlatform("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"),
    ).toBe("ios");
    expect(
      keyboardPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120"),
    ).toBe("android");
    expect(keyboardPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "desktop",
    );
  });

  it("does not read an iPhone into Android's Linux", () => {
    // Android's own user agent contains "Linux", and iOS's contains
    // "Mac OS X" — neither substring can be the one that decides.
    expect(
      keyboardPlatform("Mozilla/5.0 (Linux; Android 14; SM-S911B) Chrome/120"),
    ).toBe("android");
    expect(
      keyboardPlatform("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0)"),
    ).toBe("ios");
  });
});

describe("the keyboard setup card", () => {
  it("appears on a typed answer whose script declares extra characters", () => {
    renderSession(["ң", "ө", "ү"]);
    expect(screen.getByText("Typing ң ө ү")).toBeTruthy();
    // Steps, not a wall of prose: the walkthrough is the primary fix.
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(2);
  });

  it("stays away for a domain that declares none — every domain shipping today", () => {
    renderSession();
    expect(screen.queryByText(/^Typing /)).toBeNull();
  });

  it("offers the key row as the fallback, and turning it on shows the keys", () => {
    renderSession(["ң", "ө", "ү"]);
    // Off by default, so there are no keys to press yet.
    expect(screen.queryByRole("button", { name: "ң" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(getLearning().extraKeys).toBe(true);
    expect(screen.getByRole("button", { name: "ң" })).toBeTruthy();
  });

  it("stays dismissed once dismissed", () => {
    renderSession(["ң", "ө", "ү"]);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Typing ң ө ү")).toBeNull();
    expect(getLearning().keyboardHelpDismissed).toBe(true);

    cleanup();
    renderSession(["ң", "ө", "ү"]);
    expect(screen.queryByText("Typing ң ө ү")).toBeNull();
  });

  it("leaves the key row it turned on behind when it is dismissed", () => {
    // Dismissing the walkthrough must not take the fallback with it — a
    // learner who cannot add a layout has just chosen the only thing that
    // makes those blanks answerable.
    renderSession(["ң", "ө", "ү"]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Typing ң ө ү")).toBeNull();
    expect(screen.getByRole("button", { name: "ң" })).toBeTruthy();
  });

  it("goes away once the answer is in", () => {
    renderSession(["ң", "ө", "ү"]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "жаңы" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.queryByText("Typing ң ө ү")).toBeNull();
  });
});
