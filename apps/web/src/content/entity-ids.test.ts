import { describe, it, expect } from "vitest";
import { slugPattern } from "@betterbeaver/schema";
import { newEntityId } from "./entity-ids";

describe("newEntityId", () => {
  it("matches slugPattern and carries the prefix, over many generated ids", () => {
    for (let i = 0; i < 100; i++) {
      const id = newEntityId("ky");
      expect(id).toMatch(slugPattern);
      expect(id.startsWith("ky-")).toBe(true);
    }
  });

  it("uses the given prefix verbatim, including a domain code", () => {
    for (let i = 0; i < 100; i++) {
      expect(newEntityId("dx").startsWith("dx-")).toBe(true);
    }
  });

  it("returns different values across calls", () => {
    expect(newEntityId("ky")).not.toBe(newEntityId("ky"));
  });
});
