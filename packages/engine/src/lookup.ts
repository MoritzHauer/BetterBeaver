import type { Item } from "@betterbeaver/schema";
import { pickBest } from "./entryOrder.js";
import { normalizeToken } from "./normalize.js";

/** The dictionary-form text of an entry, per kind (plan 0006's tap-to-lookup
 * only ever resolves against `lexeme`/`concept` entries — the domain's
 * lexicon; other item kinds are never entries). */
function entryText(item: Item): string | undefined {
  switch (item.kind) {
    case "lexeme":
      // The one lookup leak plan 0023 §1's table found: matching is
      // *entry ⊂ token*, so a suffix affix can never false-match
      // ("тартуу".startsWith("туу") is false), but a prefix affix (гидро-)
      // would win longest-prefix over the real stem it is attached to.
      return item.payload.bound === "prefix" ? undefined : item.payload.script;
    case "concept":
      return item.payload.term;
    default:
      return undefined;
  }
}

/** Shortest normalized entry script/term the prefix rule will ever match on (plan 0006, pinned: >= 3 chars). */
const MIN_PREFIX_LENGTH = 3;

/**
 * Resolves a tapped word token against a domain's merged entry pool (plan
 * 0006's tap-to-lookup, pinned algorithm). Both the token and every
 * candidate entry's script/term are normalized the same way
 * (`normalizeToken`), then:
 *
 * 1. exact normalized match wins outright;
 * 2. else the longest normalized entry script/term (>= 3 chars) that is a
 *    prefix of the normalized token — best-effort matching against
 *    inflected Kyrgyz surface forms, whose lemma is usually a prefix of the
 *    inflected word;
 * 3. ties at either stage broken by `pickBest`;
 * 4. else `undefined` — lookup is best-effort by design; the caller offers
 *    an add-word fallback rather than dead-ending.
 */
export function resolveToken(token: string, entries: Item[]): Item | undefined {
  const normalizedToken = normalizeToken(token);
  if (normalizedToken === "") {
    return undefined;
  }

  const candidates = entries.flatMap((item) => {
    const text = entryText(item);
    if (text === undefined) {
      return [];
    }
    return [{ item, normalized: normalizeToken(text) }];
  });

  const exact = candidates.filter((c) => c.normalized === normalizedToken);
  if (exact.length > 0) {
    return pickBest(exact.map((c) => c.item));
  }

  const prefixMatches = candidates.filter(
    (c) =>
      c.normalized.length >= MIN_PREFIX_LENGTH &&
      normalizedToken.startsWith(c.normalized),
  );
  if (prefixMatches.length === 0) {
    return undefined;
  }
  const longestLength = Math.max(
    ...prefixMatches.map((c) => c.normalized.length),
  );
  return pickBest(
    prefixMatches
      .filter((c) => c.normalized.length === longestLength)
      .map((c) => c.item),
  );
}
