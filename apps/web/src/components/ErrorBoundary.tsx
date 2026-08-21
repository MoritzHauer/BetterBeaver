import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordNav } from "../nav-diary";

/**
 * Catches a render/lifecycle throw anywhere below it.
 *
 * Without one, React 19 unmounts the entire root on an uncaught render error
 * — the page becomes a bare `<body>`, which on a dark theme is an unexplained
 * black screen with no way out but killing the app. That is indistinguishable
 * from the navigation bug this app has been chasing, so the boundary earns
 * its place twice over: it makes a crash *say* it crashed, and it makes the
 * two failure modes tell themselves apart.
 *
 * The message is shown, not swallowed: there is no error reporting backend
 * (and by design there will not be one — see the privacy page), so the only
 * route from a crash on the owner's phone to a fix here is a legible screen
 * they can read out.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Into the diary as well as the screen: a crash the learner dismisses by
    // restarting is still visible afterwards under About → Diagnostics.
    recordNav("crash", error.message);
    console.error("BetterBeaver crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return (
      <main>
        <header className="screen-header">
          <h1>Something broke</h1>
        </header>
        <section className="card">
          <p>
            The app hit an error and stopped drawing this screen. Your Books and
            progress are stored separately and are not affected.
          </p>
          <p className="error-text">{error.message}</p>
          <button className="primary" onClick={() => location.reload()}>
            Reload the app
          </button>
          <p className="status">
            If this keeps happening, the details under About → Diagnostics are
            what a bug report needs.
          </p>
        </section>
      </main>
    );
  }
}
