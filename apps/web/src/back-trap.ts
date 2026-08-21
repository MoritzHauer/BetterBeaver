/**
 * Hardware-back plumbing: the history entries the app parks on so a back
 * press moves up a screen instead of leaving the app. `App.tsx` owns the
 * policy (which screen's back action runs); this owns the history mechanics.
 *
 * **Two entries, not one.** A single trap has to be re-pushed inside the
 * `popstate` handler, which leaves a window — however short — in which the
 * history is unguarded, and a phone's back button repeats far faster than a
 * script can. The second entry is the buffer: a double press consumes one and
 * still lands on ours. `depth` is carried in the state so arming is
 * idempotent and the stack never grows past two, however many times the
 * arming effect runs.
 */

const TRAP_DEPTH = 2;

type TrapState = { backTrap?: boolean; depth?: number };

/** How many trap entries sit at or below the current one (0 = unguarded). */
export function trapDepth(): number {
  const state = window.history.state as TrapState | null;
  if (state?.backTrap !== true) {
    return 0;
  }
  return typeof state.depth === "number" ? state.depth : 1;
}

/** Tops the history back up to `TRAP_DEPTH` trap entries. Cheap and
 * idempotent: at full depth it pushes nothing, so calling it after every
 * commit costs one `history.state` read. */
export function armBackTrap(): void {
  for (let depth = trapDepth() + 1; depth <= TRAP_DEPTH; depth++) {
    window.history.pushState({ backTrap: true, depth }, "");
  }
}

/** True when the app runs as an installed PWA rather than in browser chrome.
 * No longer gates the trap — it turned out not to be reliable enough on the
 * one device that matters (see `docs/STATUS.md`, 2026-08-21) — but it is
 * recorded in the nav diary, because "what does this phone actually report"
 * is a fact worth having rather than guessing at twice. */
export function isStandalone(): boolean {
  const iosStandalone = (window.navigator as { standalone?: boolean })
    .standalone;
  return (
    iosStandalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}
