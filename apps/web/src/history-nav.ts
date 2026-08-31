import { recordNav } from "./nav-diary";
import { fromPath, toPath, type View } from "./route";

/**
 * Hardware back, done through the URL.
 *
 * **Why not `pushState`.** Five attempts parked entries on the history with
 * `pushState` and waited for `popstate`. On the owner's phone that event
 * never arrived once, across ~30 launches. The reason is a browser
 * intervention against back-trapping: entries a script inserts through the
 * History API without user interaction are *skipped* by a real back press
 * (whatwg/html#7832), while `history.back()` still traverses them — which is
 * exactly the split observed, since the app's own Back button always worked.
 * Firefox for Android has it filed as fenix#25328, naming
 * `pushState`/`replaceState` specifically.
 *
 * So the History API is out of the navigation path entirely. Screens are
 * fragments (`route.ts`), and moving between them is a **navigation the
 * browser performs**, not an entry the app fabricates — the same provenance
 * as clicking a link on any ordinary site, which is the one thing known to
 * work here. Hash routing is also old and ubiquitous enough that a browser
 * skipping fragment entries would be a famous bug rather than an obscure one.
 *
 * `hashchange` replaces `popstate` as the signal. It fires for back, forward
 * and a manually edited URL, and no history entry had to be faked to get it.
 *
 * The one piece of bookkeeping is `stack`, which mirrors the entries this
 * module created so that a move *back* to the view we came from — what the
 * on-screen Back button produces, since its handlers name their parent screen
 * rather than saying "go back" — becomes a real `history.back()` instead of a
 * new forward entry. `history.back()` is safe to use: it is the traversal the
 * intervention explicitly exempts, and it is why the in-app button worked
 * throughout.
 */

export type HistoryNav = {
  /** Called after every commit with the current view; navigates when the URL
   * no longer matches it. Cheap and idempotent. */
  sync: (view: View) => void;
  dispose: () => void;
};

const pathOfUrl = (): string => window.location.hash.replace(/^#/, "");

/** The view the current URL describes, for the app's initial state. `null`
 * when the URL says nothing this build understands. */
export function viewFromUrl(): View | null {
  return fromPath(pathOfUrl());
}

export function installHistoryNav(
  initial: View,
  restore: (view: View) => void,
): HistoryNav {
  const stack: (string | undefined)[] = [toPath(initial)];
  let index = 0;

  // Not navigation — this only labels the entry the app launched on, so a
  // reload or a shared link lands where it should. Nothing about back
  // depends on it.
  if (pathOfUrl() !== stack[0]) {
    window.history.replaceState(
      window.history.state,
      "",
      `#${stack[0] ?? "/"}`,
    );
  }

  function onHashChange(): void {
    const path = pathOfUrl();
    if (path === stack[index]) {
      // Our own navigation, already accounted for in `sync`.
      return;
    }

    const view = fromPath(path);
    // The line five builds never produced. `known=false` means the URL is one
    // this build cannot render — a link from a newer version, or a typo.
    recordNav(
      "back",
      `known=${view !== null} to=${path} len=${history.length}`,
    );

    if (path === stack[index - 1]) {
      index -= 1;
    } else if (path === stack[index + 1]) {
      index += 1;
    } else {
      // Somewhere else entirely: a deep link followed from outside, or a URL
      // typed by hand. Treat it as the new top rather than pretending to know
      // where it sits.
      index += 1;
      stack.length = index;
      stack[index] = path;
    }

    if (view !== null) {
      restore(view);
    }
  }

  window.addEventListener("hashchange", onHashChange);

  return {
    sync(view: View): void {
      const next = toPath(view);
      if (next === stack[index]) {
        return;
      }
      if (index > 0 && stack[index - 1] === next) {
        // Going back to where we came from: traverse, do not stack a new
        // entry, or hardware back would walk *into* the screen just left.
        index -= 1;
        window.history.back();
        return;
      }
      index += 1;
      stack.length = index;
      stack[index] = next;
      // A fragment navigation performed by the browser. Assigning `hash`
      // rather than calling `pushState` is the entire point of this module.
      window.location.hash = next;
    },
    dispose(): void {
      window.removeEventListener("hashchange", onHashChange);
    },
  };
}
