import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHistoryNav, viewFromUrl, type HistoryNav } from "./history-nav";
import type { View } from "./route";
import { readNavDiary } from "./nav-diary";

/**
 * The router, with no React involved.
 *
 * Five previous versions parked entries with `pushState` and waited for
 * `popstate`; the device never delivered one, because a real back press skips
 * script-inserted History API entries (whatwg/html#7832, fenix#25328). What
 * is held in place here is that the app navigates — `location.hash` — rather
 * than fabricating history, and that going back to the previous view
 * traverses instead of stacking a forward entry.
 */
const view = (path: string): View => ({
  started: true,
  screen:
    path === "books" ? { screen: "books" } : { screen: "book", bookId: path },
  sheet: false,
});

let nav: HistoryNav | null = null;
let restored: View[] = [];

function install(initial: View): void {
  nav = installHistoryNav(initial, (v) => restored.push(v));
}

/** jsdom dispatches hashchange asynchronously, as browsers do. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  restored = [];
});

afterEach(() => {
  nav?.dispose();
  nav = null;
});

describe("installHistoryNav", () => {
  it("labels the launch entry without navigating", () => {
    const before = window.history.length;

    install(view("books"));

    expect(window.location.hash).toBe("#/books");
    expect(window.history.length).toBe(before);
  });

  it("navigates by fragment, never by pushState", async () => {
    install(view("books"));

    nav?.sync(view("demo"));
    await settle();

    // The URL is the navigation. If this were `pushState`, the entry would be
    // the kind a real back press skips.
    expect(window.location.hash).toBe("#/books/demo");
  });

  it("restores the view the URL moved to", async () => {
    install(view("books"));
    nav?.sync(view("demo"));
    await settle();
    restored = [];

    window.history.back();
    await settle();

    expect(restored).toEqual([view("books")]);
  });

  it("traverses rather than stacking when returning to the previous view", async () => {
    install(view("books"));
    nav?.sync(view("demo"));
    await settle();
    const deep = window.history.length;
    restored = [];

    // What the on-screen Back button produces: its handler names the parent
    // screen, so it arrives as an ordinary view change.
    nav?.sync(view("books"));
    await settle();

    expect(window.history.length).toBe(deep);
    expect(window.location.hash).toBe("#/books");
    // The state was already correct; re-applying it would be a wasted render.
    expect(restored).toEqual([]);
  });

  it("keeps back working after an on-screen back", async () => {
    install(view("books"));
    nav?.sync(view("demo"));
    await settle();
    nav?.sync(view("kyrgyz"));
    await settle();
    nav?.sync(view("demo"));
    await settle();
    restored = [];

    window.history.back();
    await settle();

    expect(restored).toEqual([view("books")]);
  });

  it("ignores a sync that does not change the view", async () => {
    install(view("books"));
    nav?.sync(view("demo"));
    await settle();
    const before = window.history.length;

    // `sync` runs after every commit, and most commits are not navigations.
    nav?.sync(view("demo"));
    nav?.sync(view("demo"));
    await settle();

    expect(window.history.length).toBe(before);
  });

  it("records every arrival in the nav diary", async () => {
    install(view("books"));
    nav?.sync(view("demo"));
    await settle();

    window.history.back();
    await settle();

    const back = readNavDiary().filter((entry) => entry.event === "back");
    expect(back.length).toBeGreaterThan(0);
    expect(back.at(-1)?.detail).toContain("known=true");
  });

  it("records a route it cannot render rather than rewriting it", async () => {
    install(view("books"));

    window.location.hash = "#/nonsense";
    await settle();

    const back = readNavDiary().filter((entry) => entry.event === "back");
    expect(back.at(-1)?.detail).toContain("known=false");
    expect(restored).toEqual([]);
  });

  it("stops listening once disposed", async () => {
    install(view("books"));
    nav?.sync(view("demo"));
    await settle();
    restored = [];

    nav?.dispose();
    window.history.back();
    await settle();

    expect(restored).toEqual([]);
  });
});

describe("viewFromUrl", () => {
  it("reads the view the address bar is showing", () => {
    window.location.hash = "#/books/kyrgyz";

    expect(viewFromUrl()).toEqual(view("kyrgyz"));
  });

  it("is null for a route this build does not know", () => {
    window.location.hash = "#/nonsense";

    expect(viewFromUrl()).toBeNull();
  });
});
