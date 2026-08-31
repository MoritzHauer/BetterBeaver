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

  // Plan 0025 §10: the three Kyrgyz letters a Russian keyboard cannot
  // produce are distinct letters, and the distinction is exactly what a
  // typed exercise teaches. Folding any of them onto its Russian
  // look-alike would auto-mark a wrong answer correct, so the key row
  // exists precisely so that normalization never has to.
  it("never folds ң/ө/ү onto н/о/у", () => {
    expect(normalizeTypedInput("ң")).not.toBe(normalizeTypedInput("н"));
    expect(normalizeTypedInput("ө")).not.toBe(normalizeTypedInput("о"));
    expect(normalizeTypedInput("ү")).not.toBe(normalizeTypedInput("у"));
  });

  // All three are precomposed codepoints (U+04A3, U+04E9, U+04AF), so NFC
  // leaves them whole rather than decomposing them into a base letter plus
  // a combining mark — which is why the rule above holds for free today.
  it("leaves ң/ө/ү as single codepoints under NFC", () => {
    for (const char of ["ң", "ө", "ү"]) {
      expect([...normalizeTypedInput(char)]).toHaveLength(1);
    }
  });
});
