import { describe, it, expect } from "vitest";
import type { Item } from "@betterbeaver/schema";
import { resolveToken } from "./lookup.js";

/** Lexeme fixture: id/script/gloss given directly, so tests can control script length and id ordering. */
function lexeme(id: string, script: string): Item {
  return {
    id,
    kind: "lexeme",
    payload: { script, transliteration: script, gloss: `gloss for ${script}` },
    sourceRef: "t-resource-1",
  };
}

function concept(id: string, term: string): Item {
  return {
    id,
    kind: "concept",
    payload: { term, definition: `definition for ${term}` },
    sourceRef: "t-resource-1",
  };
}

describe("resolveToken", () => {
  it("matches exactly, case-folded", () => {
    const entries = [lexeme("ky-item-salam", "Салам")];
    expect(resolveToken("салам", entries)).toBe(entries[0]);
  });

  it("strips punctuation from the entry side (the plan's Салам!/Салам example)", () => {
    const entries = [lexeme("ky-item-salam", "Салам!")];
    expect(resolveToken("Салам", entries)).toBe(entries[0]);
  });

  it("strips punctuation from the tapped-token side too", () => {
    const entries = [lexeme("ky-item-salam", "Салам")];
    expect(resolveToken("«Салам»", entries)).toBe(entries[0]);
  });

  it("prefix-matches an inflected surface form against a >= 3 char lemma", () => {
    // "China" inflected with a Kyrgyz locative-ish suffix; the lemma "кытай"
    // is a normalized prefix of the tapped, inflected token.
    const lemma = lexeme("ky-item-kytay", "кытай");
    const entries = [lemma];
    expect(resolveToken("кытайда", entries)).toBe(lemma);
  });

  it("does not prefix-match a lemma shorter than 3 characters", () => {
    const entries = [lexeme("ky-item-al", "ал")];
    expect(resolveToken("алар", entries)).toBeUndefined();
  });

  it("ties: shipped entry wins over a user-created homograph", () => {
    const shipped = lexeme("ky-item-salam", "салам");
    const user = lexeme("user-abc123", "салам");
    expect(resolveToken("салам", [user, shipped])).toBe(shipped);
  });

  it("ties among same-class ids: lowest id wins", () => {
    const b = lexeme("ky-item-b", "салам");
    const a = lexeme("ky-item-a", "салам");
    expect(resolveToken("салам", [b, a])).toBe(a);
  });

  it("matches concept entries by term", () => {
    const entries = [concept("dx-concept-tree", "tree")];
    expect(resolveToken("Trees.", entries)).toBe(entries[0]);
  });

  it("returns undefined with no candidate entries", () => {
    expect(resolveToken("салам", [])).toBeUndefined();
  });

  it("returns undefined for a token with no exact or prefix match", () => {
    const entries = [lexeme("ky-item-salam", "салам")];
    expect(resolveToken("рахмат", entries)).toBeUndefined();
  });
});
