import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initContentSource } from "./content/source";
import { backActionRef, installBackTrap, isTrapArmed } from "./back-trap";

/**
 * `App`'s half of hardware back: publishing the current screen's back action
 * into `backActionRef`, and clearing it when it goes away. The history entry
 * and the listener belong to `back-trap.ts` and are tested there — this
 * models what `main.tsx` does by installing the trap first, because that
 * order is the fix: the guard exists before the app that uses it.
 */
describe("App hardware-back wiring", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "");
    backActionRef.current = null;
    installBackTrap();
  });
  afterEach(cleanup);

  it("guards the history before the app has rendered anything", () => {
    // `installBackTrap` already ran, as it does at module load in main.tsx.
    // Nothing below this line needs the app to have started.
    expect(isTrapArmed()).toBe(true);
  });

  it("publishes no back action on the cover, and one once inside", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    expect(backActionRef.current).toBeNull();

    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    await waitFor(() => expect(backActionRef.current).not.toBeNull());
  });

  it("walks up a screen on a back press, leaving the trap armed", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    screen.getByRole("button", { name: "Settings" }).click();
    await screen.findByRole("heading", { name: "Settings" });

    window.history.replaceState(null, "");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await screen.findByText("BetterBeaver");
    expect(isTrapArmed()).toBe(true);
  });

  it("keeps publishing across a re-render, as StrictMode's remount does", async () => {
    const contentInit = await initContentSource();
    const { rerender } = render(<App contentInit={contentInit} />);

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();
    await screen.findByText("BetterBeaver");
    await waitFor(() => expect(backActionRef.current).not.toBeNull());

    // An unmount cleanup clearing the ref would be run by StrictMode's dev
    // remount with no render after it, leaving hardware back dead. The ref
    // is published during render, so it must survive effects re-running.
    rerender(<App contentInit={contentInit} />);
    expect(backActionRef.current).not.toBeNull();
  });
});
