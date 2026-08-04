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
 * Edit mode is a flag on the `book`/`lesson`/`unit` routes, not a screen
 * (plan 0021 §8). That is the whole point of slice 5 and the only part of it
 * a user could notice: `✎` no longer takes you anywhere, and walking down
 * the Book while editing does not drop you out of it.
 *
 * The document lifecycle underneath (spec 0021-5 §1a) is covered here only
 * where it is observable from the app: both documents loading, a failed
 * lexicon load not blocking the Book, and the unmount flush.
 */
const maintained = new Set(["topic:demo", "domain:demo"]);
let lexiconLoadFails = false;

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
    getSupabase: () => ({}) as ReturnType<typeof actual.getSupabase>,
    currentUser: async () => ({ id: "author" }),
    listMyDocuments: async () =>
      summaries.filter((doc) => maintained.has(doc.id)),
    loadDocument: async (id: string) => {
      if (id === "domain:demo" && lexiconLoadFails) {
        throw new Error("nope");
      }
      const summary = summaries.find((doc) => doc.id === id);
      if (summary === undefined) {
        throw new Error(`unexpected document: ${id}`);
      }
      return { ...summary, draft: null, published: published.get(id) ?? null };
    },
    loadCatalogEntry: async (id: string) => {
      const summary = summaries.find((doc) => doc.id === id);
      return summary === undefined
        ? null
        : { ...summary, published: published.get(id) ?? null };
    },
    listOpenProposals: async () => [],
  };
});

// Storage listing needs a real backend; the session degrades to an empty
// asset list, which is what this suite runs against.
vi.mock("./backend/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend/storage")>()),
  listDocumentAssets: async () => [],
}));

const editBar = () => document.querySelector(".edit-bar");

/** Home → the demo Book → edit mode. */
async function enterEditMode(): Promise<void> {
  const contentInit = await initContentSource();
  render(<App contentInit={contentInit} />);
  (await screen.findByText("Get Started")).click();
  // A real book card, not the always-shown "Create a Book" one (which
  // renders with the `primary` class) — same selector the nav-perf suite uses.
  const bookCard = await waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>(
      ".card-list .card:not(.primary) button",
    );
    expect(button).not.toBeNull();
    return button!;
  });
  bookCard.click();
  (await screen.findByRole("button", { name: "Edit" })).click();
  await waitFor(() => expect(editBar()).not.toBeNull());
}

async function openMenu(): Promise<void> {
  screen.getByRole("button", { name: "Editing menu" }).click();
  await screen.findByRole("heading", { name: "Editing" });
}

describe("edit mode as a route flag", () => {
  beforeEach(() => {
    localStorage.clear();
    lexiconLoadFails = false;
    maintained.clear();
    maintained.add("topic:demo");
    maintained.add("domain:demo");
  });
  afterEach(cleanup);

  it("survives book → lesson → unit and back", async () => {
    await enterEditMode();

    // Down: Book → Lesson.
    (await screen.findByRole("button", { name: /Meet BetterBeaver/ })).click();
    await screen.findByRole("heading", { name: /Meet BetterBeaver/ });
    expect(editBar()).not.toBeNull();

    // Lesson → Unit. Its title is an input, not a heading, from slice 6 on —
    // the unit edits in place.
    (await screen.findByRole("button", { name: /Beaver basics/ })).click();
    expect(await screen.findByDisplayValue("Beaver basics")).toBeTruthy();
    expect(editBar()).not.toBeNull();

    // Up again, by hardware back — which must behave exactly as it does from
    // the same screen without edit mode: one level up, still editing.
    window.dispatchEvent(new PopStateEvent("popstate"));
    await screen.findByRole("heading", { name: /Meet BetterBeaver/ });
    expect(editBar()).not.toBeNull();
  });

  it("leaves the Book editable when its lexicon fails to load", async () => {
    lexiconLoadFails = true;
    await enterEditMode();

    // Not blocked, not an error screen: the session is live and the Book's
    // own fields are reachable.
    await waitFor(() => expect(editBar()?.textContent).toContain("saved"));
    await openMenu();
    screen.getByRole("button", { name: /Edit all fields/ }).click();
    expect(await screen.findByLabelText("Title")).toBeTruthy();
  });

  it("holds the Book and its lexicon together in maintain mode", async () => {
    await enterEditMode();

    await openMenu();
    // The lexicon is only offered once its own document is in hand — the
    // Book names it, so it cannot even be looked up until the Book loads.
    screen.getByRole("button", { name: "Words" }).click();
    expect(await screen.findByLabelText("Title")).toBeTruthy();
    expect(
      screen.queryByText(/you can use them, but not change them/),
    ).toBeNull();
  });

  it("renders the lexicon read-only when the user does not maintain it", async () => {
    // Plan decision 12: the Book is theirs, its lexicon is not.
    maintained.delete("domain:demo");
    await enterEditMode();

    await openMenu();
    screen.getByRole("button", { name: "Words" }).click();
    expect(
      await screen.findByText(/you can use them, but not change them/),
    ).toBeTruthy();
  });

  it("flushes a pending debounced draft when edit mode is left", async () => {
    await enterEditMode();
    await openMenu();
    screen.getByRole("button", { name: /Edit all fields/ }).click();

    const title = await screen.findByLabelText("Title");
    (title as HTMLInputElement).focus();
    // The 400 ms debounce is deliberately still pending when the session
    // unmounts a few lines below — the flush is what has to catch it.
    fireEvent.change(title, { target: { value: "Edited in place" } });
    await waitFor(() =>
      expect((title as HTMLInputElement).value).toBe("Edited in place"),
    );
    expect(localStorage.getItem("bb.author.draft.topic:demo")).toBeNull();

    await openMenu();
    screen.getByRole("button", { name: "Done editing" }).click();

    await waitFor(() => {
      const raw = localStorage.getItem("bb.author.draft.topic:demo");
      expect(raw).not.toBeNull();
      expect(raw).toContain("Edited in place");
    });
    expect(editBar()).toBeNull();
  });
});
