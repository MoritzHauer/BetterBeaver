import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHistoryNav, type HistoryNav } from "./history-nav";
import { readNavDiary } from "./nav-diary";

/**
 * The router, tested with no React at all.
 *
 * What matters here is the *shape of the history*, not the screens: the
 * three previous attempts at hardware back all parked a dummy entry and
 * intercepted `popstate`, and the device never delivered one. Real entries,
 * one per view, pushed from the commit that follows the tap, are the thing
 * this file exists to hold in place — plus the bookkeeping that keeps the
 * on-screen Back button from pushing a forward entry when it means "go back".
 */
type View = { at: string };

let nav: HistoryNav<View> | null = null;
let restored: View[] = [];

function install(initial: View): void {
  nav = installHistoryNav<View>(initial, (view) => restored.push(view));
}

/** jsdom runs `history.back()` as a queued task, so the pop lands a few
 * milliseconds later rather than synchronously. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "");
  restored = [];
});

afterEach(() => {
  nav?.dispose();
  nav = null;
});

describe("installHistoryNav", () => {
  it("puts the first view on the current entry without adding one", () => {
    const before = window.history.length;

    install({ at: "cover" });

    expect(window.history.state).toEqual({ bbNav: { at: "cover" } });
    expect(window.history.length).toBe(before);
  });

  it("pushes a real entry for each new view", () => {
    install({ at: "cover" });
    const before = window.history.length;

    nav?.sync({ at: "home" });
    nav?.sync({ at: "book" });

    expect(window.history.length).toBe(before + 2);
    expect(window.history.state).toEqual({ bbNav: { at: "book" } });
  });

  it("ignores a sync that does not change the view", () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });
    const before = window.history.length;

    // `sync` runs after every commit, and most commits are not navigations.
    nav?.sync({ at: "home" });
    nav?.sync({ at: "home" });

    expect(window.history.length).toBe(before);
  });

  it("restores the popped view on a back press", async () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });
    nav?.sync({ at: "book" });

    window.history.back();
    await settle();

    expect(restored).toEqual([{ at: "home" }]);
  });

  it("goes back rather than forward when a view returns to the previous one", async () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });
    nav?.sync({ at: "book" });
    const deep = window.history.length;

    // What the on-screen Back button produces: its handler names the parent
    // screen, so this arrives as an ordinary view change. Pushing here would
    // leave hardware back walking *into* the screen just left.
    nav?.sync({ at: "home" });
    await settle();

    expect(window.history.length).toBe(deep);
    expect(window.history.state).toEqual({ bbNav: { at: "home" } });
    // The state was already correct, so that pop must not re-apply it.
    expect(restored).toEqual([]);
  });

  it("keeps hardware back working after an on-screen back", async () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });
    nav?.sync({ at: "book" });
    nav?.sync({ at: "home" });
    await settle();

    window.history.back();
    await settle();

    expect(restored).toEqual([{ at: "cover" }]);
  });

  it("drops forward entries when navigating somewhere new after a back", async () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });
    nav?.sync({ at: "book" });
    window.history.back();
    await settle();
    const atHome = window.history.length;

    nav?.sync({ at: "stats" });

    expect(window.history.length).toBe(atHome);
    expect(window.history.state).toEqual({ bbNav: { at: "stats" } });
  });

  it("leaves a pop it did not create alone", async () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });

    // An entry belonging to whatever was open before the app: the press is
    // on its way out of the app and there is nothing to restore.
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(restored).toEqual([]);
  });

  it("records every press in the nav diary, ours or not", () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    const back = readNavDiary().filter((entry) => entry.event === "back");
    expect(back).toHaveLength(1);
    // A diary with no `back` lines at all is the signature of the bug this
    // module replaced — the press never reaching the page.
    expect(back[0]?.detail).toContain("ours=false");
  });

  it("stops listening once disposed", async () => {
    install({ at: "cover" });
    nav?.sync({ at: "home" });

    nav?.dispose();
    window.history.back();
    await settle();

    expect(restored).toEqual([]);
  });
});
