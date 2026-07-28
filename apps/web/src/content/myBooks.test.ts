import { describe, expect, it, afterEach, vi } from "vitest";
import {
  addToMyBooks,
  initMembership,
  isFirstRun,
  readArchived,
  readMyBooks,
} from "./myBooks";
import { isStorageUnwritable } from "../storage-health";

/**
 * Membership must survive a `localStorage` that throws (spec 0019 §1's
 * treatment, extended here because `initMembership` runs inside
 * `initContentSource()` — an escaping throw left `main.tsx` with a blank
 * page and no error screen).
 */
describe("myBooks under blocked storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function blockWrites() {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
  }

  function blockAll() {
    blockWrites();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
  }

  // Must run first: `noteStorageUnwritable` is write-once for the module's
  // lifetime, so every later case in this file sees the flag already set.
  it("initMembership does not throw when setItem throws, and reports it", () => {
    expect(isStorageUnwritable()).toBe(false);
    blockWrites();
    expect(() => initMembership(["demo"], [])).not.toThrow();
    expect(isStorageUnwritable()).toBe(true);
  });

  it("addToMyBooks does not throw when setItem throws", () => {
    blockWrites();
    expect(() => addToMyBooks("demo")).not.toThrow();
  });

  it("reads degrade to empty when getItem throws", () => {
    blockAll();
    expect(readMyBooks()).toEqual([]);
    expect(readArchived()).toEqual([]);
  });

  it("isFirstRun answers false when getItem throws, so the seed-and-purge path stays off", () => {
    blockAll();
    expect(isFirstRun()).toBe(false);
  });

  it("still round-trips normally when storage works", () => {
    initMembership(["demo"], ["old"]);
    addToMyBooks("second");
    expect(isFirstRun()).toBe(false);
    expect(readMyBooks()).toEqual(["demo", "second"]);
    expect(readArchived()).toEqual(["old"]);
  });
});
