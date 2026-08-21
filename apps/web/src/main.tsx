import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { recordNav } from "./nav-diary";
import { isStandalone } from "./back-trap";
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

// Async boot (plan 0012): the content source reads the IndexedDB document
// cache before first render — milliseconds, and never the network.
//
// The `catch` is not decoration: nothing renders until this promise settles,
// so a rejection here leaves an empty `<div id="root">` and a blank page with
// no error anywhere — the same symptom as a crash and as the back bug. Every
// path that can end in a blank screen now has to explain itself.
const root = createRoot(rootElement);
initContentSource().then(
  (contentInit) => {
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
