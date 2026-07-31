import { describe, it, expect, vi } from "vitest";
import { documentId } from "@betterbeaver/schema";
import { getAssetUrl, getLexiconAssetUrl, allAssetStems } from "./bundled";
import { registerRemoteAssets, remoteAssetStems } from "./remote-assets";
import type { CachedDocument } from "./cache";

// Real Blobs throughout (spec 0012-A done criterion 2) — the bucketing logic
// under test reads `blob.type`, so a stub object wouldn't exercise it.

function topicRecord(
  bookId: string,
  assets: Record<string, Blob> | undefined,
): CachedDocument {
  return {
    id: documentId("topic", bookId),
    kind: "topic",
    version: 1,
    schemaVersion: 1,
    doc: {
      topic: {},
      lessons: [],
      units: [],
      items: [],
      tasks: [],
      resources: [],
      notes: [],
    },
    assets,
  };
}

function domainRecord(
  domainId: string,
  assets: Record<string, Blob> | undefined,
): CachedDocument {
  return {
    id: documentId("domain", domainId),
    kind: "domain",
    version: 1,
    schemaVersion: 1,
    doc: { domain: {}, entries: [], families: [] },
    assets,
  };
}

describe("remote-assets", () => {
  it("resolves a topic record's image blob through getAssetUrl and allAssetStems().imageByBook", () => {
    const png = new Blob(["fake-png"], { type: "image/png" });
    registerRemoteAssets([topicRecord("remote-book", { cover: png })]);

    const url = getAssetUrl("remote-book", "img", "cover");
    expect(url).toBeDefined();
    expect(url).toMatch(/^blob:/);
    expect(allAssetStems().imageByBook.get("remote-book")).toContain("cover");
  });

  it("resolves a domain record's audio blob through getLexiconAssetUrl and allAssetStems().audioByDomain", () => {
    const wav = new Blob(["fake-wav"], { type: "audio/wav" });
    registerRemoteAssets([domainRecord("remote-domain", { hello: wav })]);

    const url = getLexiconAssetUrl("remote-domain", "audio", "hello");
    expect(url).toBeDefined();
    expect(url).toMatch(/^blob:/);
    expect(allAssetStems().audioByDomain.get("remote-domain")).toContain(
      "hello",
    );
  });

  it("a record with no assets field contributes nothing", () => {
    registerRemoteAssets([topicRecord("no-assets-book", undefined)]);

    expect(getAssetUrl("no-assets-book", "img", "cover")).toBeUndefined();
    expect(
      remoteAssetStems().imageByBook.get("no-assets-book"),
    ).toBeUndefined();
  });

  it("registering a second time revokes the first set's URLs and drops its stems", () => {
    const png = new Blob(["fake-png"], { type: "image/png" });
    registerRemoteAssets([topicRecord("first-book", { cover: png })]);
    expect(remoteAssetStems().imageByBook.get("first-book")).toContain("cover");

    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const other = new Blob(["other-png"], { type: "image/png" });
    registerRemoteAssets([topicRecord("second-book", { icon: other })]);

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(remoteAssetStems().imageByBook.get("first-book")).toBeUndefined();
    expect(remoteAssetStems().imageByBook.get("second-book")).toContain("icon");
    revoke.mockRestore();
  });
});
