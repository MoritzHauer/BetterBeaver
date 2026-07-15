import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bundledDomainIds, bundledTopicDomainIds } from "./content/bundled";
import { runStorageMigrations } from "./progress/migrations";
import "./styles.css";

if (navigator.storage?.persist !== undefined) {
  void navigator.storage.persist();
}

// Must run before any screen reads the new per-domain keys (plan 0006).
runStorageMigrations(bundledTopicDomainIds(), bundledDomainIds());

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
