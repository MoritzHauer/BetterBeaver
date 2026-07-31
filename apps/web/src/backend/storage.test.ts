import { describe, it, expect } from "vitest";
import { slugPattern } from "@betterbeaver/schema";
import { parseObjectName, canReuseBlob } from "./storage";

describe("parseObjectName", () => {
  it("splits stem and display name on the first '__'", () => {
    expect(parseObjectName("ky-abc__salam.mp3")).toEqual({
      stem: "ky-abc",
      name: "salam.mp3",
    });
  });

  it("falls back to the (extensionless) stem for both when there's no '__'", () => {
    expect(parseObjectName("ky-abc.mp3")).toEqual({
      stem: "ky-abc",
      name: "ky-abc.mp3",
    });
  });

  it("splits only on the first '__', taking the rest of the name verbatim", () => {
    expect(parseObjectName("ky-abc__sa__lam.mp3")).toEqual({
      stem: "ky-abc",
      name: "sa__lam.mp3",
    });
  });

  it("a stem containing '_' is impossible: slugPattern forbids underscores", () => {
    expect(slugPattern.test("ky_abc")).toBe(false);
    expect(slugPattern.test("ky-abc")).toBe(true);
  });
});

// `previous.lastModified` is epoch ms (a `File`'s native representation,
// see `previousAssetMeta`) — this is exactly `Date.parse("2026-07-01T00:00:00.000Z")`.
const JUL1_MS = Date.parse("2026-07-01T00:00:00.000Z");

describe("canReuseBlob", () => {
  it("reuses when size and lastModified both match", () => {
    expect(
      canReuseBlob(
        { size: 100, lastModified: "2026-07-01T00:00:00.000Z" },
        { size: 100, lastModified: JUL1_MS },
      ),
    ).toBe(true);
  });

  it("reuses across differently-spelled ISO timestamps for the same instant", () => {
    // Postgres/Storage don't guarantee one canonical spelling — this is the
    // exact reason the comparison normalises to epoch ms instead of
    // comparing raw strings (which would be its own hollow key).
    expect(
      canReuseBlob(
        { size: 100, lastModified: "2026-07-01T00:00:00+00:00" },
        { size: 100, lastModified: JUL1_MS },
      ),
    ).toBe(true);
  });

  it("re-downloads when size differs", () => {
    expect(
      canReuseBlob(
        { size: 200, lastModified: "2026-07-01T00:00:00.000Z" },
        { size: 100, lastModified: JUL1_MS },
      ),
    ).toBe(false);
  });

  it("re-downloads when lastModified differs (same size, different file)", () => {
    expect(
      canReuseBlob(
        { size: 100, lastModified: "2026-07-02T00:00:00.000Z" },
        { size: 100, lastModified: JUL1_MS },
      ),
    ).toBe(false);
  });

  // The case that catches a hollow comparison key: two `undefined`s must
  // never compare equal, or a maintainer's same-size replacement would
  // silently keep serving the old bytes.
  it("re-downloads when the listing's size is undefined", () => {
    expect(
      canReuseBlob(
        { size: undefined, lastModified: "2026-07-01T00:00:00.000Z" },
        { size: 100, lastModified: JUL1_MS },
      ),
    ).toBe(false);
  });

  it("re-downloads when the listing's lastModified is undefined", () => {
    expect(
      canReuseBlob(
        { size: 100, lastModified: undefined },
        { size: 100, lastModified: JUL1_MS },
      ),
    ).toBe(false);
  });

  it("re-downloads when there is no previous blob metadata at all", () => {
    expect(
      canReuseBlob(
        { size: 100, lastModified: "2026-07-01T00:00:00.000Z" },
        undefined,
      ),
    ).toBe(false);
  });

  it("re-downloads when both sides are undefined (the hollow-key case)", () => {
    expect(
      canReuseBlob(
        { size: undefined, lastModified: undefined },
        { size: undefined, lastModified: undefined },
      ),
    ).toBe(false);
  });

  // Isolates the size-field hollow key specifically: `lastModified` matches
  // on both sides (via `Date.parse`, which never lets two `undefined`s
  // sneak through — `Date.parse(undefined)` is `NaN`, and `NaN` never
  // equals anything), so this only fails if the *size* guard is missing —
  // `undefined === undefined` is `true` in JS, which is the actual hollow
  // key the guard exists to block.
  it("re-downloads when both sides have an undefined size, even with matching lastModified", () => {
    expect(
      canReuseBlob(
        { size: undefined, lastModified: "2026-07-01T00:00:00.000Z" },
        { size: undefined, lastModified: JUL1_MS },
      ),
    ).toBe(false);
  });
});
