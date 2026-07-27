import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import {
  createDocumentContentSource,
  type AssetStems,
} from "./documentSource.js";

// Gate for `scripts/rename-kyrgyz-ids.ts`: the script cannot call the
// validator itself (engine/schema import each other with `.js` specifiers bare
// Node can't resolve — same reason `republish-content.ts` says to run the
// checks first), so its dry-run output is validated here before `--write`.
// Skipped when no dry run is pending, so this never blocks a normal test run.
const OUT = fileURLToPath(
  new URL("../../../scripts/kyrgyz-renamed.json", import.meta.url),
);

const EMPTY: AssetStems = {
  audioByBook: new Map(),
  imageByBook: new Map(),
  audioByDomain: new Map(),
  imageByDomain: new Map(),
};

// Read lazily: `describe.skipIf` still evaluates the callback body at
// collection time, so a top-level read would throw when no dry run is pending.
function load(): { book: BookDocument; domain: DomainDocument } {
  return JSON.parse(readFileSync(OUT, "utf-8")) as {
    book: BookDocument;
    domain: DomainDocument;
  };
}

describe.skipIf(!existsSync(OUT))("renamed Kyrgyz documents", () => {
  it("assembles into a valid content set", () => {
    const { book, domain } = load();
    const built = createDocumentContentSource(
      new Map([["kyrgyz", book]]),
      new Map([["ky", domain]]),
      EMPTY,
    );
    expect(built.broken).toEqual([]);
  });

  it("keeps the document identities and the code prefix", () => {
    const { book, domain } = load();
    const topic = book.topic as Record<string, unknown>;
    expect(topic.id).toBe("kyrgyz");
    expect(topic.code).toBe("ky");
    expect(topic.domainId).toBe("ky");
    expect((domain.domain as Record<string, unknown>).id).toBe("ky");
    expect((domain.domain as Record<string, unknown>).code).toBe("ky");
  });

  it("leaves no hand-authored entity ids behind", () => {
    const { book, domain } = load();
    // every renamed id is `ky-<uuid>`; anything else `ky-`-prefixed and
    // word-shaped (ky-item-…, ky-unit-…) means a reference was missed
    const stale = JSON.stringify([book, domain]).match(
      /"ky-(?!note-)[a-z]+-[a-z0-9-]*"/g,
    );
    expect(stale ?? []).toEqual([]);
  });
});
