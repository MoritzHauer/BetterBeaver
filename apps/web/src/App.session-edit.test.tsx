import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CONTENT_SCHEMA_VERSION } from "@betterbeaver/schema";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import type { AuthorDocSummary } from "./backend/supabase";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * Guards the session ✎ button's whole point: it is a detour, not an exit.
 *
 * It used to navigate to `screen: "edit"`, which unmounts the running
 * session — so the editor's Back landed on the authoring document list, and
 * getting back to practice rebuilt the session from question one (a fresh
 * shuffle, mid-session answers gone). The fix layers the editor over the
 * session and keeps the session mounted, hidden; this asserts the mounted
 * part, which is what makes resuming possible at all.
 */
vi.mock("./backend/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backend/supabase")>();
  const { bundledBookDocuments, bundledDomainDocuments } =
    await import("./content/bundled");
  const summaries: AuthorDocSummary[] = [
    {
      id: "topic:demo",
      kind: "topic",
      published_version: 1,
      schema_version: CONTENT_SCHEMA_VERSION,
      listed: true,
    },
    {
      id: "domain:demo",
      kind: "domain",
      published_version: 1,
      schema_version: CONTENT_SCHEMA_VERSION,
      listed: true,
    },
  ];
  const published = new Map<string, BookDocument | DomainDocument | null>([
    ["topic:demo", bundledBookDocuments().get("demo") ?? null],
    ["domain:demo", bundledDomainDocuments().get("demo") ?? null],
  ]);
  return {
    ...actual,
    // Non-null so App runs the author lookup at all; nothing in this test
    // reaches a query through it.
    getSupabase: () => ({}) as ReturnType<typeof actual.getSupabase>,
    currentUser: async () => ({ id: "author" }),
    listMyDocuments: async () => summaries,
    loadDocument: async (id: string) => {
      const summary = summaries.find((doc) => doc.id === id);
      if (summary === undefined) {
        throw new Error(`unexpected document: ${id}`);
      }
      return { ...summary, draft: null, published: published.get(id) ?? null };
    },
    listOpenProposals: async () => [],
    publishDocument: async () => {},
  };
});

// Publishing itself is not what's under test here — only what the editor
// does once it succeeds.
vi.mock("./backend/publishCheck", () => ({
  validateForPublish: async () => [],
}));

/** The trail's Practice button starts the pooled unit session (plan 0020). */
async function startUnitSession(): Promise<void> {
  await screen.findByText("Get Started");
  screen.getByText("Get Started").click();
  const play = await screen.findByRole("button", { name: "Continue" });
  play.click();
  const practice = await screen.findByRole("button", { name: "Practice" });
  practice.click();
  await screen.findByRole("button", { name: /Edit/ });
}

describe("session Edit button", () => {
  // No `globals: true` in this project, so RTL's auto-cleanup never runs and
  // each test would otherwise query a body holding the previous test's app.
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("layers the editor over the session and resumes it on close", async () => {
    const contentInit = await initContentSource();
    const { container } = render(<App contentInit={contentInit} />);
    await startUnitSession();

    const question = container.querySelector(".question")?.textContent ?? "";
    expect(question).not.toBe("");

    screen.getByRole("button", { name: /Edit/ }).click();
    const editor = await waitFor(() => {
      const found = container.querySelector("main.editor");
      expect(found).not.toBeNull();
      return found!;
    });

    // Hidden, not unmounted — this is what carries the session's shuffle and
    // answered-so-far state across the detour.
    const session = container.querySelector("main.session");
    expect(session).not.toBeNull();
    expect(session?.closest("[hidden]")).not.toBeNull();

    const back = editor.querySelector<HTMLButtonElement>(
      'button[title="Back to learning"]',
    );
    expect(back).not.toBeNull();
    back!.click();

    // Back on the very same question, and nowhere near the authoring area.
    await waitFor(() => {
      expect(container.querySelector("main.editor")).toBeNull();
    });
    expect(container.querySelector("main.session")?.closest("[hidden]")).toBe(
      null,
    );
    expect(container.querySelector(".question")?.textContent).toBe(question);
  });

  it("closes itself once the edit is published, back into the session", async () => {
    const contentInit = await initContentSource();
    const { container } = render(<App contentInit={contentInit} />);
    await startUnitSession();

    const question = container.querySelector(".question")?.textContent ?? "";
    screen.getByRole("button", { name: /Edit/ }).click();
    await waitFor(() => {
      expect(container.querySelector("main.editor")).not.toBeNull();
    });

    screen.getByRole("button", { name: "Validate & publish" }).click();

    await waitFor(() => {
      expect(container.querySelector("main.editor")).toBeNull();
    });
    expect(container.querySelector("main.session")?.closest("[hidden]")).toBe(
      null,
    );
    expect(container.querySelector(".question")?.textContent).toBe(question);
  });
});
