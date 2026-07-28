import { describe, expect, it, vi, afterEach } from "vitest";
import { gatherStats } from "./stats";

/**
 * `gatherStats` must resolve (not reject) even when the raw
 * `Object.keys(localStorage)` read (spec 0019 §1's `storageKeys()` guard)
 * hits a blocked `localStorage`.
 */
describe("gatherStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("resolves with itemsInReview 0 when Object.keys(localStorage) throws", async () => {
    const originalKeys = Object.keys;
    vi.spyOn(Object, "keys").mockImplementation((obj: object) => {
      if (obj === localStorage) {
        throw new DOMException("blocked", "SecurityError");
      }
      return originalKeys(obj);
    });

    await expect(gatherStats(new Date())).resolves.toMatchObject({
      itemsInReview: 0,
    });
  });
});
