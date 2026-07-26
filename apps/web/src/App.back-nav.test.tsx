import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * Guards the hardware-back trap's invariant: whenever a screen with its own
 * back action is showing, the current history entry is the trap entry.
 *
 * It stopped holding because the popstate handler only refills the trap when
 * it actually ran a back action — at the root the ref is null, so that pop
 * consumed the trap and nothing replaced it. Navigating back into the app
 * afterwards left it with nothing to pop, and the next hardware back walked
 * off the app's own history entry into a blank page (reproduced in a real
 * browser: back from inside a Book landed on `about:blank`).
 *
 * `replaceState` models that consumed-trap state directly — it's what the
 * history looks like after the root's unrefilled pop, without needing jsdom
 * to emulate a cross-entry navigation.
 */
describe("App hardware-back trap", () => {
  it("re-arms the trap once a screen with a back action renders", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");

    // Armed while My Books (back → the welcome cover) is showing.
    await waitFor(() =>
      expect(
        (window.history.state as { backTrap?: boolean } | null)?.backTrap,
      ).toBe(true),
    );

    // The root's pop consumed it and left no replacement.
    window.history.replaceState(null, "");
    expect(window.history.state).toBeNull();

    // Any further navigation must arm it again, or the next back leaves the app.
    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });
    await waitFor(() =>
      expect(
        (window.history.state as { backTrap?: boolean } | null)?.backTrap,
      ).toBe(true),
    );
  });
});
