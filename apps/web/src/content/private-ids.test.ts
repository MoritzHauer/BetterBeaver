import { describe, it, expect } from "vitest";
import { slugPattern } from "@betterbeaver/schema";
import { newPrivateId } from "./private-ids";

describe("newPrivateId", () => {
  it("matches slugPattern over many generated ids", () => {
    for (let i = 0; i < 100; i++) {
      expect(newPrivateId()).toMatch(slugPattern);
    }
  });

  it("does not start with the user- prefix", () => {
    for (let i = 0; i < 100; i++) {
      expect(newPrivateId().startsWith("user-")).toBe(false);
    }
  });

  it("returns different values across calls", () => {
    expect(newPrivateId()).not.toBe(newPrivateId());
  });
});
