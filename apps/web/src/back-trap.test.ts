import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armBackTrap,
  backActionRef,
  installBackTrap,
  isTrapArmed,
} from "./back-trap";
import { readNavDiary } from "./nav-diary";

/**
 * The whole hardware-back mechanism, tested with no React at all — which is
 * the point of it living here. The owner's nav diary showed thirteen boots
 * and not a single back press: the arming used to sit in an `App` effect,
 * which does not run until the content source resolves, so a stalled boot
 * left the history unguarded and the next press exited the app, which then
 * stalled again on relaunch. A guard that needs the app to have started is
 * not a guard, so none of these tests are allowed to start one.
 *
 * `installBackTrap` is idempotent and installs exactly one listener for the
 * life of the module, so ordering matters here: the first test to call it
 * owns the listener and the rest observe it.
 */
describe("back trap", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "");
    backActionRef.current = null;
  });

  it("arms immediately on install, before any app exists", () => {
    expect(isTrapArmed()).toBe(false);

    installBackTrap();

    expect(isTrapArmed()).toBe(true);
  });

  it("re-arms after a press consumed the entry", () => {
    installBackTrap();
    window.history.replaceState(null, "");

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(isTrapArmed()).toBe(true);
  });

  it("runs the screen's published back action", () => {
    installBackTrap();
    const goBack = vi.fn();
    backActionRef.current = goBack;

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(goBack).toHaveBeenCalledOnce();
    expect(isTrapArmed()).toBe(true);
  });

  it("absorbs the press at a root screen instead of releasing it", () => {
    installBackTrap();
    backActionRef.current = null;

    window.dispatchEvent(new PopStateEvent("popstate"));

    // Nothing ran and nothing left: releasing this pop is what walked the app
    // off its own history entry in the first two attempts at this bug.
    expect(isTrapArmed()).toBe(true);
  });

  it("records each press, with what it found, before re-arming", () => {
    installBackTrap();
    window.history.replaceState(null, "");
    backActionRef.current = null;

    window.dispatchEvent(new PopStateEvent("popstate"));

    const back = readNavDiary().filter((entry) => entry.event === "back");
    expect(back).toHaveLength(1);
    expect(back[0]?.detail).toContain("handled=false");
    // The state the press *found*, not the state after topping up — a press
    // arriving at an unarmed history is the thing worth seeing.
    expect(back[0]?.detail).toContain("armed=false");
  });

  it("installs only one listener however many times it is called", () => {
    installBackTrap();
    installBackTrap();
    const goBack = vi.fn();
    backActionRef.current = goBack;

    window.dispatchEvent(new PopStateEvent("popstate"));

    // A second listener would run the back action twice and skip a screen.
    expect(goBack).toHaveBeenCalledOnce();
  });

  it("pushes nothing when the trap is already the current entry", () => {
    armBackTrap();
    const length = window.history.length;

    armBackTrap();
    armBackTrap();

    expect(window.history.length).toBe(length);
    expect(isTrapArmed()).toBe(true);
  });
});
