import { describe, it, expect } from "vitest";
import { normalizeTypedInput } from "./normalize.js";

describe("normalizeTypedInput", () => {
  it("strips apostrophes without introducing a space", () => {
    expect(normalizeTypedInput("don't")).toBe("dont");
  });

  it("replaces other punctuation (e.g. hyphens) with a space", () => {
    expect(normalizeTypedInput("well-known")).toBe("well known");
  });

  it("lowercases and NFC-normalizes", () => {
    // "é" as a precomposed codepoint (NFC) vs. "e" + combining acute (NFD)
    // must normalize equal.
    expect(normalizeTypedInput("CAFÉ")).toBe(normalizeTypedInput("café"));
  });

  it("trims and collapses internal whitespace runs to one space", () => {
    expect(normalizeTypedInput("  hello   world  ")).toBe("hello world");
  });

  it("replaces punctuation like commas and periods with a space", () => {
    expect(normalizeTypedInput("Hi, there.")).toBe("hi there");
  });
});
