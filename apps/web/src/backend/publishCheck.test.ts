import { describe, expect, it, vi } from "vitest";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";

/**
 * The two things a real publish got wrong (found browser-verifying spec
 * 0021-9/10 in maintain mode): a lexicon publish that deleted a word the
 * Book's task points at reported success, and every error line was prefixed
 * with the Book's own id, which sent slice 10's deep-link to the Book screen
 * instead of the exercise.
 *
 * Both configurations of the catalog are exercised: EMPTY (the unlisted Book
 * an admin has not listed yet, which the `catalog` view's `where listed` does
 * not carry, so both documents reach the check only through the arguments)
 * and populated (a listed Book, where `also` overlays the row).
 */
const state = vi.hoisted(() => ({
  catalog: [] as {
    id: string;
    kind: "topic" | "domain";
    published: unknown;
    schema_version: number;
  }[],
}));
vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: async () => ({ data: state.catalog, error: null }),
    }),
  }),
}));
vi.mock("./storage", () => ({
  listDocumentAssets: async () => [],
  assetStemsFromListing: () => ({
    audioByBook: new Map(),
    imageByBook: new Map(),
    audioByDomain: new Map(),
    imageByDomain: new Map(),
  }),
}));

const { validateForPublish } = await import("./publishCheck");

const BOOK: BookDocument = {
  topic: {
    id: "bk",
    code: "bk",
    domainId: "dm",
    title: "Book",
    description: "",
    lessonIds: ["bk-l1"],
  },
  lessons: [
    { id: "bk-l1", topicId: "bk", title: "L", goal: "", unitIds: ["bk-u1"] },
  ],
  units: [
    {
      id: "bk-u1",
      lessonId: "bk-l1",
      title: "U",
      goal: "",
      itemIds: ["bk-con-kit"],
      taskIds: ["bk-task-recognize"],
      noteIds: [],
    },
  ],
  items: [],
  tasks: [
    {
      id: "bk-task-recognize",
      type: "recall",
      itemIds: ["bk-con-kit"],
      instructions: "i",
    },
  ],
  resources: [{ id: "bk-res", title: "R", path: "internal://r" }],
  notes: [],
};

const domainWith = (terms: string[]): DomainDocument => ({
  domain: {
    id: "dm",
    code: "bk",
    kind: "general",
    title: "D",
    glossLanguage: "en",
  },
  entries: terms.map((term) => ({
    id: `bk-con-${term}`,
    kind: "concept",
    payload: { term, definition: `${term} definition` },
    sourceRef: "bk-res",
  })),
  families: [],
});

describe("validateForPublish", () => {
  it("passes when the pair is consistent", async () => {
    expect(
      await validateForPublish("topic:bk", "topic", BOOK, [
        { docId: "domain:dm", kind: "domain", doc: domainWith(["kit"]) },
      ]),
    ).toEqual([]);
  });

  it("catches a word deleted out from under a task in the other document", async () => {
    const errors = await validateForPublish("topic:bk", "topic", BOOK, [
      { docId: "domain:dm", kind: "domain", doc: domainWith([]) },
    ]);
    expect(errors.some((e) => e.includes("bk-task-recognize"))).toBe(true);
  });

  it("leads each line with the entity id, not the Book's — the deep-link takes the first id it can own", async () => {
    const errors = await validateForPublish("topic:bk", "topic", BOOK, [
      { docId: "domain:dm", kind: "domain", doc: domainWith([]) },
    ]);
    for (const error of errors) {
      expect(error.startsWith("bk:")).toBe(false);
    }
    expect(errors.some((e) => e.startsWith("bk-task-recognize:"))).toBe(true);
  });

  it("catches it on the LISTED path too, where the catalog carries the Book", async () => {
    // The real shape of a lexicon-only publish once an admin has listed the
    // Book: the Book is not a target, so it arrives as its published copy —
    // which is also the catalog row `also` overlays.
    state.catalog = [
      { id: "topic:bk", kind: "topic", published: BOOK, schema_version: 1 },
      {
        id: "domain:dm",
        kind: "domain",
        published: domainWith(["kit"]),
        schema_version: 1,
      },
    ];
    try {
      const errors = await validateForPublish("topic:bk", "topic", BOOK, [
        { docId: "domain:dm", kind: "domain", doc: domainWith([]) },
      ]);
      expect(errors.some((e) => e.startsWith("bk-task-recognize:"))).toBe(true);
    } finally {
      state.catalog = [];
    }
  });

  it("still names a DIFFERENT Book that breaks — only the one being published loses its prefix", async () => {
    const other = JSON.parse(JSON.stringify(BOOK)) as BookDocument;
    (other.topic as { id: string; code: string; domainId: string }).id = "bk2";
    (other.topic as { code: string }).code = "bk2";
    (other.topic as { domainId: string }).domainId = "dm2";
    state.catalog = [
      { id: "topic:bk2", kind: "topic", published: other, schema_version: 1 },
      {
        id: "domain:dm2",
        kind: "domain",
        // `bk2` is a copy under a new code, so its entity ids no longer
        // match its prefix and it breaks on its own account — which is all
        // this needs: some error attributed to a Book nobody is publishing.
        published: {
          ...domainWith([]),
          domain: {
            id: "dm2",
            code: "bk2",
            kind: "general",
            title: "D2",
            glossLanguage: "en",
          },
        },
        schema_version: 1,
      },
    ];
    try {
      const errors = await validateForPublish("topic:bk", "topic", BOOK, [
        { docId: "domain:dm", kind: "domain", doc: domainWith([]) },
      ]);
      expect(errors.some((e) => e.startsWith("bk2:"))).toBe(true);
      expect(errors.some((e) => e.startsWith("bk-task-recognize:"))).toBe(true);
    } finally {
      state.catalog = [];
    }
  });
});
