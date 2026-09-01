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
/**
 * Puts every word of the demo Book's first unit well up the ladder (plan
 * 0025 §4), so the session opens on an exercise that maps to one item.
 *
 * Level 1, so the new attempt lands on `recognize` — whose prompt is the
 * word's own Term, which is the field these tests type into.
 *
 * At level 0 every word draws `matching`, and a board's Edit button
 * deliberately targets the owning *task* rather than an item — it has no
 * single word to name. These tests are about an edit reaching the question
 * underneath, so they need a question with a word behind it.
 */
function seedLevels(): void {
  for (const id of [
    "dx-con-dam",
    "dx-con-lodge",
    "dx-con-incisors",
    "dx-con-kit",
    "dx-con-scent-mound",
  ]) {
    localStorage.setItem(
      `bb.item.${id}`,
      JSON.stringify({
        due: "2999-01-01T00:00:00.000Z",
        intervalDays: 1,
        ease: 2.5,
        reps: 1,
        levelDay: "2020-01-01",
      }),
    );
  }
}

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
  beforeEach(() => {
    localStorage.clear();
    seedLevels();
  });
  afterEach(async () => {
    cleanup();
    // Closing the sheet returns the view to the previous entry, so the router
    // traverses for real — and jsdom runs that as a task. Let it land here,
    // with no app listening, or it arrives during the next test and restores
    // this one's session over its cover.
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

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
    // navigable document tree the form editor put here. Awaited, not read
    // once: the Book's slot settles before the lexicon's, so a word's fields
    // arrive a commit after the sheet does.
    const field = await waitFor(() => {
      const found = sheet.querySelector<HTMLInputElement>('input[type="text"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(
      screen.queryByRole("button", { name: "Validate & publish" }),
    ).toBeNull();

    fireEvent.change(field, { target: { value: "edited in the sheet" } });
    expect(field.value).toBe("edited in the sheet");
  });

  it("shows the edit on the question underneath, with no publish", async () => {
    const contentInit = await initContentSource();
    const { container } = render(<App contentInit={contentInit} />);
    await startUnitSession();

    const before = container.querySelector(".question")?.textContent ?? "";
    expect(before).not.toBe("");

    screen.getByRole("button", { name: /Edit/ }).click();
    const sheet = await screen.findByRole("dialog");
    // The card's Term, which is what this question kind puts on screen as
    // its answer choices — a `picture` question prompts with the image and
    // answers in the target language (plan 0025 §2), so the Definition in
    // the textarea below never reaches the board.
    const field = await waitFor(() => {
      const found = sheet.querySelector<HTMLInputElement>('input[type="text"]');
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.change(field, { target: { value: "ZZ-EDITED" } });

    // Closing the sheet is the moment that used to lose it: `sessionEdit`
    // clears, and with it went the only thing holding the draft — so the
    // question reverted to published content and the author had to publish
    // and take a content update to see their own typo fix.
    screen.getByRole("button", { name: "Back to the question" }).click();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // The whole session subtree rather than `.question` alone, so this keeps
    // holding whichever element the edited text lands in as the shuffle's
    // first question changes.
    await waitFor(() => {
      expect(container.querySelector("main.session")?.textContent).toContain(
        "ZZ-EDITED",
      );
    });
    expect(before).not.toContain("ZZ-EDITED");
    // Nothing was published to get there.
    expect(
      screen.queryByRole("button", { name: "Validate & publish" }),
    ).toBeNull();
  });

  it("re-deriving the questions does not reshuffle them", async () => {
    const contentInit = await initContentSource();
    const { container } = render(<App contentInit={contentInit} />);
    await startUnitSession();

    const progress = () =>
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow");
    const at = progress();

    // Opening and closing the sheet swaps the session's content source from
    // published to draft, which rebuilds the question list. The builders seed
    // their rng from the unit id precisely so that rebuild is positionally
    // identical — without it the author would be thrown to a different
    // question, which is why the content was frozen in the first place.
    screen.getByRole("button", { name: /Edit/ }).click();
    await screen.findByRole("dialog");
    screen.getByRole("button", { name: "Back to the question" }).click();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(progress()).toBe(at);
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuemax"),
    ).not.toBe("0");
  });
});
