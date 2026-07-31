import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CONTENT_SCHEMA_VERSION } from "@betterbeaver/schema";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * Settings → "Import book…" used to pin `mode: "maintain"` for everyone and
 * write `bb.author.draft.*`. For an account that does not maintain the
 * imported document that opened `MaintainEditScreen`, whose `loadDocument`
 * is a `.single()` over rows RLS hides — the learner saw a bare "Cannot
 * coerce the result to a single JSON object" and the file was unusable.
 *
 * Importing to propose is the whole point of the file being importable at
 * all when you are not a maintainer, so this asserts the storage key and
 * the editor the import lands in.
 */
vi.mock("./backend/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backend/supabase")>();
  const { bundledBookDocuments } = await import("./content/bundled");
  return {
    ...actual,
    getSupabase: () => ({}) as ReturnType<typeof actual.getSupabase>,
    currentUser: async () => ({ id: "someone-else" }),
    // Maintains nothing — the case the old route got wrong.
    listMyDocuments: async () => [],
    loadCatalogEntry: async (id: string) =>
      id === "topic:demo"
        ? {
            id,
            kind: "topic" as const,
            published: bundledBookDocuments().get("demo") ?? null,
            published_version: 7,
            schema_version: CONTENT_SCHEMA_VERSION,
          }
        : null,
    listMyProposals: async () => [],
  };
});

function exportFile(id: string): File {
  return new File(
    [JSON.stringify([{ id, kind: "topic", doc: { topic: { id: "demo" } } }])],
    "books.json",
    { type: "application/json" },
  );
}

async function openSettings(): Promise<void> {
  const contentInit = await initContentSource();
  render(<App contentInit={contentInit} />);
  (await screen.findByText("Get Started")).click();
  (await screen.findByRole("button", { name: "Settings" })).click();
}

describe("Settings book import", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("stores a non-maintained book as a proposal and opens the propose editor", async () => {
    await openSettings();
    const input = (await screen.findByText("Import book…"))
      .closest("div")
      ?.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { files: [exportFile("topic:demo")] } });

    // The propose editor reads `bb.proposal.<id>`, and needs the published
    // version the edit is based on — which the file itself cannot carry.
    const stored = await vi.waitFor(() => {
      const raw = localStorage.getItem("bb.proposal.topic:demo");
      expect(raw).not.toBeNull();
      return JSON.parse(raw!) as { baseVersion: number; doc: unknown };
    });
    expect(stored.baseVersion).toBe(7);
    expect(localStorage.getItem("bb.author.draft.topic:demo")).toBeNull();

    // `ProposeEditScreen`'s resume prompt — reached only in propose mode.
    expect(
      await screen.findByRole("button", { name: "Resume your suggestion" }),
    ).toBeTruthy();
  });

  it("reports a document that has nothing published to propose against", async () => {
    await openSettings();
    const input = (await screen.findByText("Import book…"))
      .closest("div")
      ?.querySelector('input[type="file"]');

    fireEvent.change(input!, {
      target: { files: [exportFile("topic:ghost")] },
    });

    expect(
      await screen.findByText(/nothing to propose an edit against/),
    ).toBeTruthy();
    expect(localStorage.getItem("bb.proposal.topic:ghost")).toBeNull();
  });
});
