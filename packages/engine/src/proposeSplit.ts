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

function formsOf(id: string, gloss: string, texts: string[]): Form[] {
  return texts
    .map(stripHyphens)
    .filter((text) => text !== "")
    .map((text) => ({ id, gloss, folded: fold(text), length: text.length }));
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

/** What the residue may resolve to: an entry with no `bound` at all — an
 * affix is never a root. */
function freeForms(entries: Item[]): Form[] {
  return entries.flatMap((entry) =>
    entry.kind === "lexeme" && entry.payload.bound === undefined
      ? formsOf(entry.id, entry.payload.gloss, [entry.payload.script])
      : [],
  );
}

/**
 * Proposes a morpheme breakdown of `script` against a domain's entry pool
 * (plan 0023 §8, pinned algorithm). Author-facing only: it has no
 * morphotactic ordering model and no phonology, so a well-formed nonsense
 * split is an expected output — the author's confirm tap is the validation,
 * which is why the caller offers this behind a button and never auto-applies
 * it.
 *
 * 1. Candidates are the `bound: "suffix"` entries, each recognised by its
 *    `variants` and by its own `script`, hyphen stripped;
 * 2. peel the longest matching form off the right of the remaining text and
 *    repeat, so suffixes come off outermost-first; ties break by `pickBest`,
 *    the same way `lookup.ts` breaks them, so the proposal is deterministic;
 * 3. peeling stops when nothing matches, or when a match would consume the
 *    entire remaining text — a word that is nothing but suffixes is not a
 *    decomposition;
 * 4. the residue must then resolve as a free entry by exact match, or the
 *    whole proposal is discarded: a breakdown rooted in a stem the lexicon
 *    cannot explain is worse than no suggestion, so there are no partial
 *    ones;
 * 5. `undefined` as well when no suffix came off — a one-part "breakdown" of
 *    the word as itself teaches nothing;
 * 6. otherwise the parts in reading order, root first, each `text` sliced out
 *    of the original `script` so what displays is what the author typed.
 *
 * No check that the parts concatenate back to the word: vowel harmony and
 * elision make that false often enough that it would reject real splits
 * (plan 0023 §5).
 */
export function proposeSplit(
  script: string,
  entries: Item[],
): Component[] | undefined {
  const candidates = suffixForms(entries);
  const peeled: Component[] = [];
  let residue = script;

  for (;;) {
    const folded = fold(residue);
    // `<`, not `<=`: a form covering all that is left is step 3's stop, not a
    // match.
    const matches = candidates.filter(
      (form) => form.length < residue.length && folded.endsWith(form.folded),
    );
    if (matches.length === 0) {
      break;
    }
    const longest = Math.max(...matches.map((form) => form.length));
    const best = pickBest(matches.filter((form) => form.length === longest));
    const cut = residue.length - best.length;
    peeled.push({
      text: residue.slice(cut),
      gloss: best.gloss,
      entryId: best.id,
    });
    residue = residue.slice(0, cut);
  }

  if (peeled.length === 0) {
    return undefined;
  }
  const roots = freeForms(entries).filter(
    (form) => form.folded === fold(residue),
  );
  if (roots.length === 0) {
    return undefined;
  }
  const root = pickBest(roots);
  // Peeling ran right-to-left; a breakdown reads left-to-right.
  return [
    { text: residue, gloss: root.gloss, entryId: root.id },
    ...peeled.reverse(),
  ];
}
