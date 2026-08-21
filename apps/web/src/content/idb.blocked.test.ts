import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openContentDb } from "./idb";
import { readNavDiary } from "../nav-diary";

/**
 * The boot awaits this open before anything is rendered, and
 * `readCachedDocuments` wraps it in a try/catch — which rescues a rejection
 * and cannot rescue a promise that never settles. That difference is the
 * whole bug: on the owner's phone the app came up black and only an app
 * restart cleared it, with a `boot` line in the nav diary and nothing after.
 *
 * So what is asserted here is not "opening works" but "opening always ends":
 * `blocked` (which is not an error event, and without a handler waits for as
 * long as the other connection lives) and a request that never fires anything
 * at all both have to come back as rejections.
 */
type OpenRequest = Partial<IDBOpenDBRequest> & { error?: DOMException | null };

let request: OpenRequest;

/** Invokes one of the handlers `openContentDb` installed. The cast is the
 * price of a stub: the DOM types bind these callbacks to a real request, and
 * the code under test never looks at `this`. */
function fire(name: "onsuccess" | "onerror" | "onblocked"): void {
  const handler = request[name] as ((event: Event) => void) | null | undefined;
  handler?.(new Event(name.slice(2)));
}

beforeEach(() => {
  localStorage.clear();
  request = { error: null };
  vi.stubGlobal("indexedDB", { open: () => request });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("openContentDb", () => {
  it("rejects when the open is blocked by another connection", async () => {
    const opened = openContentDb();
    fire("onblocked");

    await expect(opened).rejects.toThrow(/in use by another window/);
  });

  it("records a blocked open in the nav diary", async () => {
    const opened = openContentDb();
    fire("onblocked");
    await expect(opened).rejects.toThrow();

    expect(readNavDiary().map((entry) => entry.event)).toContain("idb-blocked");
  });

  it("rejects a request that never fires an event at all", async () => {
    vi.useFakeTimers();
    const opened = openContentDb();
    const settled = vi.fn();
    void opened.catch(settled);

    // Nothing has happened yet — this is exactly the state that used to
    // persist for the life of the app.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(opened).rejects.toThrow(/did not respond/);
  });

  it("does not fire the timeout once the open has succeeded", async () => {
    vi.useFakeTimers();
    const db = { name: "bb-content" } as IDBDatabase;
    const opened = openContentDb();
    Object.defineProperty(request, "result", { value: db });
    fire("onsuccess");

    await expect(opened).resolves.toBe(db);
    // A late timer firing on a settled promise would be a silent no-op here,
    // but a leaked timer keeps the page alive on a phone; `finish` clears it.
    expect(vi.getTimerCount()).toBe(0);
  });
});
