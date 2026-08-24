import { describe, it, expect } from "vitest";
import { CONTENT_SCHEMA_VERSION } from "@betterbeaver/schema";
import { checkImportFileShape, readPrivateBookFile } from "./private-transfer";

// Pure rejection-rule checks only (spec 0017-5 §3 rules 1-2 / done criterion
// 2) — no IndexedDB, no DOM. Everything else about import needs live state
// and is out of scope for a unit test (spec: browser-verify it instead).

const validFile = {
  kind: "bb-private-book",
  formatVersion: 1,
  schemaVersion: CONTENT_SCHEMA_VERSION,
  book: {},
  domain: {},
  assets: {},
};

describe("checkImportFileShape", () => {
  it("accepts a well-formed file at the current schema version", () => {
    const result = checkImportFileShape(validFile);
    expect(result.ok).toBe(true);
  });

  it("rejects a file with the wrong kind", () => {
    const result = checkImportFileShape({
      ...validFile,
      kind: "bb-something-else",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a file with no kind at all", () => {
    const noKind: Record<string, unknown> = { ...validFile };
    delete noKind.kind;
    const result = checkImportFileShape(noKind);
    expect(result.ok).toBe(false);
  });

  it("rejects a schemaVersion newer than this app supports, with an update-the-app message", () => {
    const result = checkImportFileShape({
      ...validFile,
      schemaVersion: CONTENT_SCHEMA_VERSION + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/update the app/i);
    }
  });

  it("rejects a non-object", () => {
    const result = checkImportFileShape(null);
    expect(result.ok).toBe(false);
  });
});

describe("readPrivateBookFile", () => {
  // The one import case that is not a rejection rule: a file from a device
  // still on schema version 1 is *accepted* (`<= CONTENT_SCHEMA_VERSION`), so
  // the local migration has to run here or it validates into a broken Book.
  it("migrates a version-1 components breakdown out of an imported file", async () => {
    const result = await readPrivateBookFile({
      ...validFile,
      schemaVersion: 1,
      book: { topic: { id: "bk" }, items: [] },
      domain: {
        entries: [
          {
            id: "dm-e1",
            kind: "lexeme",
            payload: {
              script: "окумуштуу",
              components: [{ script: "оку", gloss: "study" }],
            },
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.domain.entries[0] as {
        payload: { components: unknown[] };
      };
      expect(entry.payload.components).toEqual([
        { text: "оку", gloss: "study" },
      ]);
    }
  });
});
