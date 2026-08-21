import { describe, it, expect } from "vitest";
import type { Item } from "@betterbeaver/schema";
import { proposeSplits } from "./proposeSplit.js";

/** A free-standing word: no `bound`, so it can be a root. */
function stem(id: string, script: string, gloss: string): Item {
  return {
    id,
    kind: "lexeme",
    payload: { script, transliteration: script, gloss },
    sourceRef: "ky-resource-1",
  };
}

/** An affix entry (plan 0023 §1): an ordinary lexeme carrying `bound` and its
 * vowel-harmony allomorphs, written with the dictionary hyphen the way slice
 * D's table will write them. */
function affix(
  id: string,
  script: string,
  gloss: string,
  variants: string[],
  bound: "prefix" | "suffix" = "suffix",
): Item {
  return {
    id,
    kind: "lexeme",
    payload: { script, transliteration: script, gloss, bound, variants },
    sourceRef: "ky-resource-1",
  };
}

// The Kyrgyz suffix table is slice D, so this is a hand-built stand-in: the
// stems and affixes the words below are made of, and nothing else.
const STEMS = [
  stem("ky-e-bala", "бала", "child"),
  stem("ky-e-ish", "иш", "work"),
  stem("ky-e-suu", "суу", "water"),
  stem("ky-e-uy", "үй", "house"),
  stem("ky-e-kyz", "кыз", "girl"),
  stem("ky-e-ene", "эне", "mother"),
  stem("ky-e-besh", "беш", "five"),
];

const AFFIXES = [
  affix("ky-sfx-luu", "-луу", "having", ["-луу", "-лүү", "-дуу", "-дүү"]),
  affix("ky-sfx-chy", "-чы", "one who does", ["-чы", "-чи", "-чу", "-чү"]),
  affix("ky-sfx-syz", "-сыз", "without", ["-сыз", "-сиз", "-суз", "-сүз"]),
  affix("ky-sfx-lar", "-лар", "plural", ["-лар", "-лер", "-дар", "-дер"]),
  affix("ky-sfx-ynchy", "-ынчы", "ordinal", [
    "-ынчы",
    "-инчи",
    "-унчу",
    "-үнчү",
  ]),
];

const ENTRIES = [...STEMS, ...AFFIXES];

/** The best candidate, or `undefined` when nothing decomposed — every test
 * below that predates slice B2 is about the split an author is offered
 * first, which is now `[0]` of a ranked list rather than a lone answer. */
function proposeSplit(word: string, entries: Item[]) {
  return proposeSplits(word, entries)[0];
}

/** A split as `part·part·part`, or `undefined` — the shape the entry popup
 * renders, which is what the table below is about. */
function splitOf(word: string, entries: Item[] = ENTRIES): string | undefined {
  return proposeSplit(word, entries)
    ?.map((part) => part.text)
    .join("·");
}

/** Every candidate as `part·part`, in rank order. */
function splitsOf(word: string, entries: Item[] = ENTRIES): string[] {
  return proposeSplits(word, entries).map((split) =>
    split.map((part) => part.text).join("·"),
  );
}

describe("proposeSplit", () => {
  it("splits the words in plan 0023 §8's table", () => {
    const table = [
      ["балалар", "бала·лар"],
      ["кыздар", "кыз·дар"],
      ["энелер", "эне·лер"],
      ["суулуу", "суу·луу"],
      ["үйлүү", "үй·лүү"],
      ["ишчи", "иш·чи"],
      ["баласыз", "бала·сыз"],
      ["бешинчи", "беш·инчи"],
      // Two suffixes on one stem, peeled outermost-first and returned in
      // reading order.
      ["ишчилер", "иш·чи·лер"],
      ["кыздарсыз", "кыз·дар·сыз"],
    ];
    expect(table.map(([word]) => [word, splitOf(word!)])).toEqual(table);
  });

  it("carries each part's gloss and entry id, root first", () => {
    expect(proposeSplit("ишчилер", ENTRIES)).toEqual([
      { text: "иш", gloss: "work", entryId: "ky-e-ish" },
      { text: "чи", gloss: "one who does", entryId: "ky-sfx-chy" },
      { text: "лер", gloss: "plural", entryId: "ky-sfx-lar" },
    ]);
  });

  it("matches an allomorph the entry's own script does not cover", () => {
    // `-дар` is only in `variants`; the entry writes itself `-лар`.
    expect(proposeSplit("кыздар", ENTRIES)).toEqual([
      { text: "кыз", gloss: "girl", entryId: "ky-e-kyz" },
      { text: "дар", gloss: "plural", entryId: "ky-sfx-lar" },
    ]);
  });

  it("peels the longest form when a shorter one also fits", () => {
    // `-инчи` and `-чи` both end "бешинчи"; taking the short one would leave
    // "беши", which is not a word.
    expect(splitOf("бешинчи")).toBe("беш·инчи");
  });

  it("returns undefined when the residue is not a known free entry", () => {
    // "-чи" peels fine, but "китеп" is not in this pool: a partial suggestion
    // is worse than none.
    expect(splitOf("китепчи")).toBeUndefined();
  });

  it("returns undefined for a word with no suffix on it", () => {
    expect(splitOf("бала")).toBeUndefined();
  });

  it("returns undefined for a word that is nothing but a suffix", () => {
    expect(splitOf("лар")).toBeUndefined();
  });

  it("never resolves the root to an affix entry", () => {
    // "сызсыз" would peel to "сыз", which is an entry — but a bound one, and
    // an affix is not a stem.
    expect(splitOf("сызсыз")).toBeUndefined();
  });

  it("never peels a bound prefix, however the word ends", () => {
    // Same form as the -сыз suffix, marked as a prefix instead: peeling looks
    // at the right edge, so `bound` is the only thing that can rule it out.
    const prefixOnly = [
      ...STEMS,
      affix("ky-pfx-syz", "сыз-", "without", [], "prefix"),
    ];
    expect(splitOf("баласыз", prefixOnly)).toBeUndefined();
  });

  it("returns the original characters, not the folded ones", () => {
    expect(proposeSplit("Балалар", ENTRIES)).toEqual([
      { text: "Бала", gloss: "child", entryId: "ky-e-bala" },
      { text: "лар", gloss: "plural", entryId: "ky-sfx-lar" },
    ]);
  });

  it("breaks a tie between identical forms the way lookup does", () => {
    const user = affix("user-abc123", "-лар", "plural", []);
    expect(proposeSplit("балалар", [...ENTRIES, user])?.[1]?.entryId).toBe(
      "ky-sfx-lar",
    );
  });

  it("returns undefined with no entries at all", () => {
    expect(splitOf("балалар", [])).toBeUndefined();
  });

  // --- slice B2 (plan 0023 §8a): the search, and the ranked list ---

  it("keeps a split whose stem itself ends in a suffix form", () => {
    // The regression B2 exists for. Greedy peeling took `-луу`, then took
    // `-уу` off the *stem* `суу`, leaving `с` — not a free entry, so the
    // all-or-nothing rule threw away a word that decomposes fine.
    const withUu = [...ENTRIES, affix("ky-sfx-uu", "-уу", "verbal noun", [])];
    expect(splitOf("суулуу", withUu)).toBe("суу·луу");
  });

  it("offers the deeper analysis too, ranked under the shallower one", () => {
    const withUu = [...ENTRIES, affix("ky-sfx-uu", "-уу", "verbal noun", [])];
    // `с` is a stem here, so `с·уу·луу` is a real candidate — and still the
    // runner-up, because fewest parts wins.
    const pool = [...withUu, stem("ky-e-s", "с", "the letter es")];
    expect(splitsOf("суулуу", pool)).toEqual(["суу·луу", "с·уу·луу"]);
  });

  it("ranks a longer root first when two candidates have the same part count", () => {
    const pool = [
      ...ENTRIES,
      stem("ky-e-bal", "бал", "honey"),
      affix("ky-sfx-alar", "-алар", "made up", []),
    ];
    // `бала·лар` and `бал·алар` both split in two; the longer root wins.
    expect(splitsOf("балалар", pool)).toEqual(["бала·лар", "бал·алар"]);
  });

  it("ranks the same way whatever order the pool arrives in", () => {
    const pool = [
      ...ENTRIES,
      stem("ky-e-bal", "бал", "honey"),
      affix("ky-sfx-alar", "-алар", "made up", []),
    ];
    expect(splitsOf("балалар", [...pool].reverse())).toEqual(
      splitsOf("балалар", pool),
    );
  });

  it("returns one candidate when the word decomposes one way, none when it doesn't", () => {
    expect(proposeSplits("ишчи", ENTRIES)).toHaveLength(1);
    expect(proposeSplits("китепчи", ENTRIES)).toEqual([]);
  });

  it("terminates on a word built of nothing but stacked suffixes", () => {
    // The depth cap is a guard: this must return, not hang.
    const word = "бала" + "лар".repeat(9);
    expect(() => proposeSplits(word, ENTRIES)).not.toThrow();
    expect(proposeSplits(word, ENTRIES).length).toBeLessThanOrEqual(5);
  });

  it("does not repeat a candidate when an affix lists its own script as an allomorph", () => {
    // `-лар` is both the citation form and the first `variants` entry, which
    // is how slice D's table writes every row.
    expect(splitsOf("балалар")).toEqual(["бала·лар"]);
  });
});
