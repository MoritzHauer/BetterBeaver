import { beforeEach, describe, expect, it } from "vitest";
import { armBackTrap, installBackTrap, trapDepth } from "./back-trap";

/**
 * `installBackTrap` is the half the React-effect version was missing. The
 * owner's nav diary showed thirteen boots and not a single back press: the
 * arming lived in an `App` effect, which does not run until the content
 * source has resolved, so a stalled boot left the history unguarded and the
 * next back press exited the app — which then stalled again on relaunch.
 *
 * The guard cannot depend on the app having started, so these tests use no
 * React at all.
 */
describe("back trap", () => {
  beforeEach(() => {
    window.history.replaceState(null, "");
  });

  it("arms to full depth immediately, before any app exists", () => {
    expect(trapDepth()).toBe(0);

    installBackTrap();

    expect(trapDepth()).toBe(2);
  });

  it("tops the history back up on every pop", () => {
    installBackTrap();

    window.history.replaceState({ backTrap: true, depth: 1 }, "");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(trapDepth()).toBe(2);

    window.history.replaceState(null, "");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(trapDepth()).toBe(2);
  });

  it("pushes nothing when already at full depth", () => {
    armBackTrap();
    const length = window.history.length;

    armBackTrap();
    armBackTrap();

    // The arming effect runs after every commit; an unguarded push there
    // would grow the session history once per render.
    expect(window.history.length).toBe(length);
    expect(trapDepth()).toBe(2);
  });
});
