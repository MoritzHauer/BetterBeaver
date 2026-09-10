import { describe, expect, it, vi, afterEach } from "vitest";
import { readJson, readLegacyAttemptedTaskIds } from "./local-storage";

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

/**
 * The pre-0025 attempted-task set (plan 0026 §4) — read to grandfather
 * completions, never written.
 */
describe("readLegacyAttemptedTaskIds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reads the ids a pre-0025 device recorded", () => {
    localStorage.setItem(
      "bb.attempted",
      JSON.stringify(["dx-task-recall-basics", "dx-task-matching-basics"]),
    );
    expect([...readLegacyAttemptedTaskIds()]).toEqual([
      "dx-task-recall-basics",
      "dx-task-matching-basics",
    ]);
  });

  it("is empty on a device that never had the key", () => {
    expect(readLegacyAttemptedTaskIds().size).toBe(0);
  });

  it("is empty rather than throwing on a corrupt or blocked read", () => {
    localStorage.setItem("bb.attempted", "{not json");
    expect(readLegacyAttemptedTaskIds().size).toBe(0);
    localStorage.setItem("bb.attempted", JSON.stringify({ not: "an array" }));
    expect(readLegacyAttemptedTaskIds().size).toBe(0);
  });

  it("drops non-string entries rather than trusting the stored shape", () => {
    localStorage.setItem("bb.attempted", JSON.stringify(["ok", 7, null]));
    expect([...readLegacyAttemptedTaskIds()]).toEqual(["ok"]);
  });

  it("never writes the key back", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    readLegacyAttemptedTaskIds();
    expect(setItem).not.toHaveBeenCalled();
  });
});
