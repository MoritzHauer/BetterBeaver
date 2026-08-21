import { recordNav } from "./nav-diary";

/**
 * Session history that mirrors the app's own screen stack, so that hardware
 * back is an ordinary history traversal instead of something the app has to
 * intercept.
 *
 * **Why this replaces the "back trap".** Three earlier attempts parked a
 * dummy entry on the history and ran the current screen's back action from
 * `popstate`. On the owner's phone that never once fired — four builds of
 * nav-diary evidence, thirteen-plus boots, not a single recorded press —
 * while every desktop test passed. The likeliest explanation is Chrome's
 * history-manipulation intervention: an entry pushed **without user
 * activation** is marked skippable, and a real back press skips it silently
 * (no `popstate`), which is exactly what a dummy entry pushed at module load
 * is. Playwright's `goBack()` is a programmatic traversal and does not
 * reproduce it, which is why this box kept disagreeing with the phone.
 *
 * So: stop fighting the browser. Every entry here is pushed from the commit
 * that follows the tap that navigated — inside the user-activation window —
 * so the entries are real, back traverses them, and nothing needs to be
 * trapped. Back at the first screen leaves the app, which is what an
 * installed app is supposed to do.
 *
 * The one piece of bookkeeping: `stack` mirrors the entries this module
 * pushed, so that a *forward* navigation to the view we came from (the
 * on-screen Back button, whose handlers name their parent screen rather than
 * saying "go back") is turned into a real `history.back()` instead of a new
 * entry. Without it, tapping Back would push, and hardware back would then
 * walk *into* the screen just left.
 */

type NavState<V> = { bbNav: V };

export type HistoryNav<V> = {
  /** Called after every commit with the current view. Cheap and idempotent:
   * an unchanged view does nothing. */
  sync: (view: V) => void;
  dispose: () => void;
};

function readNav<V>(state: unknown): V | undefined {
  return (state as Partial<NavState<V>> | null)?.bbNav;
}

export function installHistoryNav<V>(
  initial: V,
  restore: (view: V) => void,
): HistoryNav<V> {
  const key = (view: V): string => JSON.stringify(view);

  // Mirrors our own entries. Browser *forward* would desynchronise it, but
  // no surface in the app offers forward and Android has no forward button;
  // a drift only costs a redundant entry, never a wrong screen, because the
  // view always comes from the popped state rather than from here.
  const stack: (string | undefined)[] = [key(initial)];
  let index = 0;
  // Set when `sync` itself called `history.back()`: the state is already
  // correct, so that pop must not re-apply it.
  let selfIssuedBack = false;

  window.history.replaceState({ bbNav: initial } satisfies NavState<V>, "");

  function onPopState(event: PopStateEvent): void {
    const view = readNav<V>(event.state);
    // The one line four builds never produced. `ours=false` means the press
    // reached a history entry that is not the app's — the app is on its way
    // out, legitimately or not.
    recordNav(
      "back",
      `ours=${view !== undefined} step=${index} len=${history.length}`,
    );
    index = Math.max(0, index - 1);
    if (selfIssuedBack) {
      selfIssuedBack = false;
      return;
    }
    if (view !== undefined) {
      restore(view);
    }
  }

  window.addEventListener("popstate", onPopState);

  return {
    sync(view: V): void {
      const next = key(view);
      if (next === stack[index]) {
        return;
      }
      if (index > 0 && stack[index - 1] === next) {
        selfIssuedBack = true;
        window.history.back();
        return;
      }
      index += 1;
      stack.length = index;
      stack[index] = next;
      // Pushed from the commit that the tap produced, so the entry carries
      // user activation. That is the whole point — see the note above.
      window.history.pushState({ bbNav: view } satisfies NavState<V>, "");
    },
    dispose(): void {
      window.removeEventListener("popstate", onPopState);
    },
  };
}
