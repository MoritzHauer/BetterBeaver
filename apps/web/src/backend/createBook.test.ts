import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { createBookDocuments } from "./supabase";

/**
 * Spec 0021-10 §1c–§4. The inserts are not atomic, so the **order** is the
 * behaviour under test: a lexicon with no Book is inert, while a Book
 * pointing at a lexicon that does not exist has every reference dangling.
 */

const BOOK = { topic: { id: "bk" } } as unknown as BookDocument;
const DOMAIN = { domain: { id: "dm" } } as unknown as DomainDocument;

/** The two calls `createBookDocuments` makes, in order, plus whichever ones
 * are told to fail. */
function fakeClient(failOn?: {
  id: string;
  error: { message: string; code?: string };
}) {
  const inserted: { id: string; kind: string }[] = [];
  const calls: string[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from(table: string) {
      calls.push(table);
      return {
        insert: async (row: { id: string; kind: string }) => {
          if (failOn?.id === row.id) {
            return { error: failOn.error };
          }
          inserted.push({ id: row.id, kind: row.kind });
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserted, calls };
}

describe("creating a Book", () => {
  it("inserts the lexicon first, then the Book", async () => {
    const { client, inserted } = fakeClient();
    await createBookDocuments("topic:bk", BOOK, "domain:dm", DOMAIN, client);

    expect(inserted).toEqual([
      { id: "domain:dm", kind: "domain" },
      { id: "topic:bk", kind: "topic" },
    ]);
  });

  it("aborts before the Book when the lexicon insert fails", async () => {
    // A Book pointing at a lexicon that does not exist is broken; the
    // reverse leaves something inert.
    const { client, inserted } = fakeClient({
      id: "domain:dm",
      error: { message: "network" },
    });
    await expect(
      createBookDocuments("topic:bk", BOOK, "domain:dm", DOMAIN, client),
    ).rejects.toThrow(/could not create this Book/);
    expect(inserted).toEqual([]);
  });

  it("reports a failed Book insert and leaves the orphan alone", async () => {
    // No rollback delete: that needs a `delete` grant this role does not
    // have, and a lexicon with no Book harms nothing.
    const { client, inserted, calls } = fakeClient({
      id: "topic:bk",
      error: { message: "network" },
    });
    await expect(
      createBookDocuments("topic:bk", BOOK, "domain:dm", DOMAIN, client),
    ).rejects.toThrow(/could not create this Book/);
    expect(inserted).toEqual([{ id: "domain:dm", kind: "domain" }]);
    // Two inserts attempted, nothing else — no delete.
    expect(calls).toEqual(["documents", "documents"]);
  });

  it("surfaces a duplicate id as 'that name is taken'", async () => {
    const { client } = fakeClient({
      id: "domain:dm",
      error: {
        message: "duplicate key value violates unique constraint",
        code: "23505",
      },
    });
    await expect(
      createBookDocuments("topic:bk", BOOK, "domain:dm", DOMAIN, client),
    ).rejects.toThrow("that name is taken");
  });

  it("refuses when nobody is signed in", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => {
        throw new Error("should not reach the table");
      },
    } as unknown as SupabaseClient;
    await expect(
      createBookDocuments("topic:bk", BOOK, "domain:dm", DOMAIN, client),
    ).rejects.toThrow(/sign in/);
  });
});
