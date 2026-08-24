import type { Component, Item } from "@betterbeaver/schema";
import { pickBest } from "./entryOrder.js";

/** The equality fold, and nothing else (plan 0023 §8): Unicode NFC and case,
 * so an authored `-Луу` still matches `луу` inside a word. Deliberately not
 * `normalizeToken` — it strips punctuation and so is not length-preserving,
 * and every index below is measured on the unfolded strings, which is what
 * keeps a fold from ever corrupting a slice. */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** One surface form an entry can be recognised by. */
interface Form {
  id: string;
  gloss: string;
  /** Folded, for the equality test only. */
  folded: string;
  /** Characters of the *authored* form — what gets sliced off the word, and
   * never `folded.length`. */
  length: number;
}

/** A dictionary writes an affix with its attachment hyphen (`-луу`); the word
 * it is peeled off contains no hyphen. */
function stripHyphens(text: string): string {
  return text.replace(/^-/u, "").replace(/-$/u, "");
}

/** Deduplicated by folded form: an affix entry almost always repeats its own
 * `script` inside `variants` (`-лар` is both the citation form and the first
 * allomorph), and two identical branches would surface as two identical
 * candidates in the chooser. */
function formsOf(id: string, gloss: string, texts: string[]): Form[] {
  const byFolded = new Map<string, Form>();
  for (const text of texts.map(stripHyphens)) {
    if (text === "") {
      continue;
    }
    const folded = fold(text);
    if (!byFolded.has(folded)) {
      byFolded.set(folded, { id, gloss, folded, length: text.length });
    }
  }
  return [...byFolded.values()];
}

/**
 * Lexemes only, on both sides of the split: `bound`, `variants` and `gloss`
 * are all lexeme-payload fields, so a `concept` can neither be a candidate
 * affix nor supply a component's required `gloss`.
 */
function suffixForms(entries: Item[]): Form[] {
  return entries.flatMap((entry) =>
    entry.kind === "lexeme" && entry.payload.bound === "suffix"
      ? formsOf(entry.id, entry.payload.gloss, [
          ...(entry.payload.variants ?? []),
          entry.payload.script,
        ])
      : [],
  );
}

/** What a residue may resolve to: an entry with no `bound` at all — an affix
 * is never a root. */
function freeForms(entries: Item[]): Form[] {
  return entries.flatMap((entry) =>
    entry.kind === "lexeme" && entry.payload.bound === undefined
      ? formsOf(entry.id, entry.payload.gloss, [entry.payload.script])
      : [],
  );
}

/** Guards, not semantics (plan 0023 §8a): a pool of many short affixes can
 * branch hard, and the editor must not hang on one. Both are far above any
 * real Kyrgyz word — six stacked suffixes is already more than the language
 * puts on a stem. */
const MAX_DEPTH = 6;
const MAX_CANDIDATES = 64;

/** How many ranked candidates a caller gets unless it asks for more; it
 * bounds what gets rendered, never what the search explores. */
const DEFAULT_LIMIT = 5;

/**
 * Proposes morpheme breakdowns of `script` against a domain's entry pool
 * (plan 0023 §8, walk amended by §8a). Author-facing only: it has no
 * morphotactic ordering model and no phonology, so a well-formed nonsense
 * split is an expected output — the author's tap is the validation, which is
 * why the caller offers these behind a button and never auto-applies a
 * proposal it did not ask for.
 *
 * 1. Candidates are the `bound: "suffix"` entries, each recognised by its
 *    `variants` and by its own `script`, hyphen stripped;
 * 2. **every** matching form at the right edge is a branch, explored to the
 *    end rather than committed to — §8's single greedy walk destroyed valid
 *    splits, because a stem that itself ends in a suffix form (`суу` under
 *    `-уу`) got peeled away and the residue then failed to resolve;
 * 3. a branch stops when nothing matches, when a match would consume the
 *    entire remaining text (a word that is nothing but suffixes is not a
 *    decomposition), or at `MAX_DEPTH`;
 * 4. a residue that resolves as a free entry by exact match completes a
 *    candidate — and the search continues past it, since a deeper split of
 *    the same word is a different proposal, not a worse one;
 * 5. candidates rank by fewest parts, then longest root, then their joined
 *    entry ids, so the order never depends on the pool's order. `[]` when
 *    nothing decomposes, which includes a word with no suffix on it: a
 *    one-part "breakdown" of the word as itself teaches nothing;
 * 6. each part's `text` is sliced out of the original `script`, so what
 *    displays is what the author typed.
 *
 * No check that the parts concatenate back to the word: vowel harmony and
 * elision make that false often enough that it would reject real splits
 * (plan 0023 §5). No check that a split makes *sense* either — see §8b for
 * why that is deferred rather than missing.
 */
export function proposeSplits(
  script: string,
  entries: Item[],
  limit: number = DEFAULT_LIMIT,
): Component[][] {
  const candidates = suffixForms(entries);
  const roots = freeForms(entries);
  const found: Component[][] = [];

  /** `peeled` is outermost-first, the order the walk discovers them in; a
   * completed candidate reverses it, because a breakdown reads left to
   * right. */
  const walk = (residue: string, peeled: Component[]): void => {
    if (found.length >= MAX_CANDIDATES) {
      return;
    }
    const folded = fold(residue);
    if (peeled.length > 0) {
      const matching = roots.filter((form) => form.folded === folded);
      if (matching.length > 0) {
        const root = pickBest(matching);
        found.push([
          { text: residue, gloss: root.gloss, entryId: root.id },
          ...[...peeled].reverse(),
        ]);
      }
    }
    if (peeled.length >= MAX_DEPTH) {
      return;
    }
    // `<`, not `<=`: a form covering all that is left is step 3's stop.
    for (const form of candidates.filter(
      (f) => f.length < residue.length && folded.endsWith(f.folded),
    )) {
      const cut = residue.length - form.length;
      walk(residue.slice(0, cut), [
        ...peeled,
        { text: residue.slice(cut), gloss: form.gloss, entryId: form.id },
      ]);
    }
  };
  walk(script, []);

  const rootLength = (split: Component[]) => split[0]?.text.length ?? 0;
  const idsOf = (split: Component[]) =>
    split.map((part) => part.entryId ?? "").join("|");
  return [...found]
    .sort(
      (a, b) =>
        a.length - b.length ||
        rootLength(b) - rootLength(a) ||
        (idsOf(a) < idsOf(b) ? -1 : idsOf(a) > idsOf(b) ? 1 : 0),
    )
    .slice(0, limit);
}
