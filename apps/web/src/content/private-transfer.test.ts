import { describe, it, expect } from "vitest";
import { CONTENT_SCHEMA_VERSION } from "@betterbeaver/schema";
import { checkImportFileShape } from "./private-transfer";

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
