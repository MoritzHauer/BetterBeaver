import type { Item } from "@betterbeaver/schema";
import { normalizeToken } from "./normalize.js";

/** The dictionary-form text of an entry, per kind (plan 0006's tap-to-lookup
 * only ever resolves against `lexeme`/`concept` entries — the domain's
 * lexicon; other item kinds are never entries). */
function entryText(item: Item): string | undefined {
  switch (item.kind) {
    case "lexeme":
      return item.payload.script;
    case "concept":
      return item.payload.term;
    default:
      return undefined;
  }
}

/** Shortest normalized entry script/term the prefix rule will ever match on (plan 0006, pinned: >= 3 chars). */
const MIN_PREFIX_LENGTH = 3;

/**
 * Tie-break for multiple equally-good matches (plan 0006, pinned):
 * shipped entries win over learner-created (`user-`-prefixed) ones, then the
 * lowest id lexicographically — deterministic, and the popup's link chips
 * make the runner-up reachable.
 */
function pickBest(items: Item[]): Item {
  return [...items].sort((a, b) => {
    const aUser = a.id.startsWith("user-");
    const bUser = b.id.startsWith("user-");
    if (aUser !== bUser) {
      return aUser ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;
}

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
