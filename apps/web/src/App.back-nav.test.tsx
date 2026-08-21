import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * Guards the hardware-back trap's two invariants (`App.tsx`, "Mobile back
 * button / edge-swipe fix"):
 *
 * 1. Whenever a screen with its own back action is showing, the current
 *    history entry is the trap entry. This stopped holding once already —
 *    the popstate handler only refilled the trap when it actually ran a back
 *    action, so the root's pop consumed it with nothing left to pop, and the
 *    next hardware back walked off the app's own history entry.
 * 2. At a root screen (no back action) the trap is kept armed **only in an
 *    installed PWA**, where the entry underneath is the launcher's blank
 *    document — that pop is the reported Android "back opens an empty page".
 *    In a browser tab the entry underneath is a real page the visitor came
 *    from, so the pop is left alone and back leaves the site.
 *
 * `replaceState` models a consumed trap directly, and a dispatched
 * `popstate` models the press — jsdom emulates neither cross-entry
 * navigation nor the hardware button.
 */

function trapArmed(): boolean {
  return (
    (window.history.state as { backTrap?: boolean } | null)?.backTrap === true
  );
}

/** Replaces `matchMedia` for the display-mode query `isStandalone` reads. */
function setStandalone(standalone: boolean): void {
  window.matchMedia = (query: string) =>
    ({
      matches: standalone && query === "(display-mode: standalone)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

describe("App hardware-back trap", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "");
    setStandalone(false);
  });
  afterEach(cleanup);

  it("re-arms the trap once a screen with a back action renders", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");

    // Armed while My Books (back → the welcome cover) is showing.
    await waitFor(() => expect(trapArmed()).toBe(true));

    // The root's pop consumed it and left no replacement.
    window.history.replaceState(null, "");
    expect(window.history.state).toBeNull();

    // Any further navigation must arm it again, or the next back leaves the app.
    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });
    await waitFor(() => expect(trapArmed()).toBe(true));
  });

  it("leaves a root pop alone in a browser tab", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    // The cover has no back action, so nothing is armed to begin with.
    await screen.findByText("Get Started");
    expect(trapArmed()).toBe(false);

    // A back press here must stay unhandled: the entry underneath is the
    // page the visitor came from, and leaving the site is what back means.
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(trapArmed()).toBe(false);
  });

  it("keeps the trap armed at the root when installed as a PWA", async () => {
    setStandalone(true);
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    // Armed on the cover itself — there is no real page underneath an
    // installed app, only the launcher's blank document.
    await screen.findByText("Get Started");
    await waitFor(() => expect(trapArmed()).toBe(true));

    // And re-armed by the press that consumed it, without waiting for a
    // commit: a root pop changes no state, so no commit is coming.
    window.history.replaceState(null, "");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(trapArmed()).toBe(true);
  });
});
