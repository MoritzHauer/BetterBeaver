import { recordNav } from "./nav-diary";

/**
 * Hardware back, whole. One history entry the app parks on, one `popstate`
 * listener, installed at module load by `main.tsx`.
 *
 * **Installed before the app, not by it.** The arming used to live in an
 * effect inside `App`, which does not run until `initContentSource()` has
 * resolved and React has rendered — so a stalled boot left the history
 * unguarded, the next back press exited the app outright, and the relaunch
 * stalled the same way. The owner's nav diary showed the result exactly:
 * thirteen boots, not one back press. A guard that depends on the thing it
 * guards having started is not a guard.
 *
 * **Unconditional.** Earlier versions released the pop at a root screen, then
 * released it only when `display-mode: standalone` was not reported. Both
 * were verified green in a desktop browser that agreed with them and both
 * were wrong on the device. Nothing is released now: back inside the app
 * moves up a screen, back at the root does nothing. The cost is real and
 * accepted — leaving an installed app is Home or the app switcher, and in a
 * browser tab the back button no longer leaves this one site.
 *
 * One entry, not two: an earlier version kept a spare against a fast second
 * press arriving before the re-push, but the re-push is synchronous inside
 * the handler, and the diary showed the failure was never a race — it was no
 * `popstate` at all. The spare bought nothing and is gone.
 */

const TRAP = { backTrap: true };

/**
 * The current screen's back action — whatever its visible Back (or
 * done/cancel) button does, or `null` at a root screen. `App` publishes it
 * during render; this module is the only reader. It lives here rather than
 * as a `useRef` inside `App` so that the listener does not have to wait for
 * a React tree to exist before it can be useful.
 */
export const backActionRef: { current: (() => void) | null } = {
  current: null,
};

export function isTrapArmed(): boolean {
  const state = window.history.state as { backTrap?: boolean } | null;
  return state?.backTrap === true;
}

/** Pushes the trap entry unless it is already the current one. */
export function armBackTrap(): void {
  if (!isTrapArmed()) {
    window.history.pushState(TRAP, "");
  }
}

let installed = false;

/** Arms the trap and keeps it armed for the life of the document. Idempotent
 * — a second call would otherwise stack a second listener, and every pop
 * would run the back action twice. */
export function installBackTrap(): void {
  if (installed) {
    return;
  }
  installed = true;
  armBackTrap();
  window.addEventListener("popstate", () => {
    const goBack = backActionRef.current;
    // Recorded before re-arming, so `armed` says what the press actually
    // found. `handled=false` with no screen above the cover is normal; a
    // diary with no `back` lines at all is the signature of the bug this
    // module exists for — the press never reached the page.
    recordNav(
      "back",
      `handled=${goBack !== null} armed=${isTrapArmed()} len=${history.length}`,
    );
    if (goBack !== null) {
      goBack();
    }
    armBackTrap();
  });
}

/** True when the app runs as an installed PWA rather than in browser chrome.
 * Gates nothing — it proved unreliable on the one device that matters, which
 * is why the trap is unconditional — but the nav diary records it, because
 * "what does this phone actually report" turned out to be worth knowing
 * rather than assuming. */
export function isStandalone(): boolean {
  const iosStandalone = (window.navigator as { standalone?: boolean })
    .standalone;
  return (
    iosStandalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}
