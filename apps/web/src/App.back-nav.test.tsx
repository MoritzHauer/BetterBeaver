import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * `App`'s half of hardware back: the session history mirrors the view, so a
 * real back press walks up the screens the learner actually visited.
 *
 * The mechanism (entries, ordering, the on-screen-Back dedupe) is covered in
 * `history-nav.test.ts`. What is asserted here is the composition — that
 * navigating adds entries and that popping them puts the right screen back —
 * because the three attempts this replaced all failed at exactly that seam:
 * the history said one thing and the app showed another.
 */
async function back(): Promise<void> {
  window.history.back();
  // jsdom queues the traversal; the pop lands a few ms later.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe("App history navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "");
  });
  afterEach(cleanup);

  it("puts the current view on the history from the first render", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    await waitFor(() =>
      expect(window.history.state).toMatchObject({
        bbNav: { started: false },
      }),
    );
  });

  it("adds an entry for each screen the learner opens", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    const atCover = window.history.length;

    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ bbNav: { started: true } }),
    );

    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });
    await waitFor(() =>
      expect(window.history.state).toMatchObject({
        bbNav: { screen: { screen: "settings" } },
      }),
    );
    expect(window.history.length).toBe(atCover + 2);
  });

  it("walks back up the screens on a back press", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });

    await back();
    await screen.findByText("BetterBeaver");

    // ...and again, to the cover the learner started on.
    await back();
    await screen.findByText("Get Started");
  });

  it("does not push a forward entry when the on-screen Back is used", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });
    const deep = window.history.length;

    screen.getByRole("button", { name: "Back" }).click();
    await screen.findByText("BetterBeaver");
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Tapping Back means "go back", so it consumes the entry rather than
    // adding one — otherwise the next hardware back would return *into*
    // Settings, which is the opposite of what the learner just asked for.
    expect(window.history.length).toBe(deep);
    await back();
    await screen.findByText("Get Started");
  });
});
