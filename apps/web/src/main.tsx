import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BootScreen } from "./components/BootScreen";
import { recordNav } from "./nav-diary";
import { installBackTrap, isStandalone } from "./back-trap";
import { bundledDomainIds, bundledBookDomainIds } from "./content/bundled";
import { initContentSource } from "./content/source";
import { runStorageMigrations } from "./progress/migrations";
import "./theme"; // registers the live OS-follow listener for the "system" theme
import "./styles.css";

if (navigator.storage?.persist !== undefined) {
  void navigator.storage.persist();
}

// Must run before any screen reads the new per-domain keys (plan 0006).
runStorageMigrations(bundledBookDomainIds(), bundledDomainIds());

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

recordNav("boot", `standalone=${isStandalone()} len=${history.length}`);

// Before anything that can wait. The hardware-back trap used to be armed by
// an effect inside `App`, which never runs if the boot below stalls — so a
// stalled boot left the app unguarded and the next back press exited it
// (docs/STATUS.md, 2026-08-21: thirteen boots in the nav diary, no back
// presses at all). Guarding the history is not something that should depend
// on the app having started successfully.
installBackTrap();

// Async boot (plan 0012): the content source reads the IndexedDB document
// cache before first render — milliseconds, and never the network.
//
// The `catch` is not decoration: nothing renders until this promise settles,
// so a rejection here leaves an empty `<div id="root">` and a blank page with
// no error anywhere — the same symptom as a crash and as the back bug. Every
// path that can end in a blank screen now has to explain itself.
const root = createRoot(rootElement);

// Something on screen from the first frame. Nothing used to render until the
// promise below settled, so every way it could fail to settle produced the
// same thing: an empty root, which on the dark theme is an unexplained black
// screen. The splash also carries the watchdog — it does not cancel the boot
// (a slow device deserves to finish), it just stops the wait from being
// silent and offers the reload that used to require killing the app.
root.render(<BootScreen />);

initContentSource().then(
  (contentInit) => {
    recordNav("content-ready");
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App contentInit={contentInit} />
        </ErrorBoundary>
      </StrictMode>,
    );
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    recordNav("boot-failed", message);
    root.render(
      <main>
        <header className="screen-header">
          <h1>BetterBeaver could not start</h1>
        </header>
        <section className="card">
          <p>
            The content store on this device could not be opened, so there is
            nothing to show yet. Your progress has not been touched.
          </p>
          <p className="error-text">{message}</p>
          <button className="primary" onClick={() => location.reload()}>
            Try again
          </button>
        </section>
      </main>,
    );
  },
);
