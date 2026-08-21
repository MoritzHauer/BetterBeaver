import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initContentSource } from "./content/source";
import { trapDepth } from "./back-trap";
import { readNavDiary } from "./nav-diary";

/**
 * Guards the hardware-back trap (`App.tsx`, "Mobile back button / edge-swipe
 * fix", and `back-trap.ts`). The rule is now one line: **the history is
 * always guarded, on every screen, in every display mode.**
 *
 * It got there by elimination. Version one released the pop at any root
 * screen and the next back walked off the app's own entry. Version two
 * released it only when the app was not detected as installed, and the phone
 * still went black from every screen — including the cover, where the handler
 * runs no React code at all, so nothing but the document going away can
 * explain it. Both versions were "verified" in a desktop browser that agreed
 * with them, which is why these tests assert the invariant (depth) rather
 * than the mechanism, and why the diary entry is part of the contract: the
 * next disagreement has to leave evidence on the device.
 *
 * `replaceState` models a consumed trap directly, and a dispatched `popstate`
 * models the press — jsdom emulates neither cross-entry navigation nor the
 * hardware button.
 */
describe("App hardware-back trap", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "");
  });
  afterEach(cleanup);

  it("guards the history on the very first screen", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    // The cover has no back action of its own, and is still guarded: this is
    // exactly the case both earlier versions left open.
    await screen.findByText("Get Started");
    await waitFor(() => expect(trapDepth()).toBe(2));
  });

  it("keeps the guard through a navigation and a back press", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });
    await waitFor(() => expect(trapDepth()).toBe(2));

    // A press consumes one entry; the handler must top it straight back up
    // without waiting for a commit, since a root pop produces no commit.
    window.history.replaceState({ backTrap: true, depth: 1 }, "");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(trapDepth()).toBe(2);

    // And the same when the trap was consumed entirely.
    window.history.replaceState(null, "");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(trapDepth()).toBe(2);
  });

  it("re-arms after a commit that finds the guard gone", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);
    await screen.findByText("Get Started");

    window.history.replaceState(null, "");
    expect(trapDepth()).toBe(0);

    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    await waitFor(() => expect(trapDepth()).toBe(2));
  });

  it("records every back press in the nav diary", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);
    await screen.findByText("Get Started");

    window.dispatchEvent(new PopStateEvent("popstate"));

    const entries = readNavDiary().filter((entry) => entry.event === "back");
    expect(entries).toHaveLength(1);
    // Whether a back action ran is the fact that tells a black screen at the
    // cover (no handler, so the pop escaped) apart from one deeper in.
    expect(entries[0]?.detail).toContain("handled=false");
  });
});
