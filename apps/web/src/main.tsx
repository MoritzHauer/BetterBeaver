import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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

// Async boot (plan 0012): the content source reads the IndexedDB document
// cache before first render — milliseconds, and never the network.
void initContentSource().then((contentInit) => {
  createRoot(rootElement).render(
    <StrictMode>
      <App contentInit={contentInit} />
    </StrictMode>,
  );
});
