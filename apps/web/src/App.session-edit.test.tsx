import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
 * shuffle, mid-session answers gone). The fix layers an editing surface over
 * the session and keeps the session mounted; this asserts the mounted part,
 * which is what makes resuming possible at all.
 *
 * Since spec 0021-11 §3 that surface is the **scoped sheet** of plan
 * decision 13: only the tapped item or exercise, over a session that is no
 * longer even hidden (a modal `<dialog>` inerts what is behind it). The
 * sheet carries no Publish — a scoped fix is saved to the draft like any
 * other edit, and publishing is the `[⋮]` menu's job on the Book screen.
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

  it("opens the sheet over the session and resumes it on close", async () => {
    const contentInit = await initContentSource();
    const { container } = render(<App contentInit={contentInit} />);
    await startUnitSession();

    const question = container.querySelector(".question")?.textContent ?? "";
    expect(question).not.toBe("");

    screen.getByRole("button", { name: /Edit/ }).click();
    await screen.findByRole("dialog");

    // Still mounted — this is what carries the session's shuffle and
    // answered-so-far state across the detour.
    expect(container.querySelector("main.session")).not.toBeNull();

    screen.getByRole("button", { name: "Back to the question" }).click();

    // Back on the very same question, and nowhere near the authoring area.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(container.querySelector(".question")?.textContent).toBe(question);
  });

  it("holds only the tapped entity, and writes what is typed into it", async () => {
    const contentInit = await initContentSource();
    render(<App contentInit={contentInit} />);
    await startUnitSession();

    screen.getByRole("button", { name: /Edit/ }).click();
    const sheet = await screen.findByRole("dialog");

    // Scoped (decision 13): the tapped entity's own fields, and none of the
    // navigable document tree the form editor put here.
    expect(sheet.querySelector("input, textarea")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Validate & publish" }),
    ).toBeNull();

    const field = sheet.querySelector<HTMLInputElement>('input[type="text"]')!;
    fireEvent.change(field, { target: { value: "edited in the sheet" } });
    expect(field.value).toBe("edited in the sheet");
  });
});
