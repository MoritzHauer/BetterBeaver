import { describe, expect, it, vi, afterEach } from "vitest";
import { readJson } from "./local-storage";

/**
 * `readJson` must treat both a corrupt value and a blocked `localStorage`
 * itself (spec 0019 §1: `getItem` throwing `SecurityError` in restricted
 * storage contexts) the same way — absent, never a thrown/rejected error.
 */
describe("readJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("returns null on malformed JSON", () => {
    localStorage.setItem("bb.test", "{not json");
    expect(readJson("bb.test")).toBeNull();
  });

  it("returns null when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readJson("bb.test")).toBeNull();
  });

  it("still parses a valid value", () => {
    localStorage.setItem("bb.test", JSON.stringify({ a: 1 }));
    expect(readJson<{ a: number }>("bb.test")).toEqual({ a: 1 });
  });
});
