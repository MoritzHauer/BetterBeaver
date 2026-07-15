import { useState } from "react";
import type {
  DomainContent,
  UserEntryStore,
  VocabListStore,
} from "@betterbeaver/engine";
import { EntryPopup } from "./EntryPopup";

/** Bundled dependencies for tap-to-lookup (plan 0006 step 4): the domain's
 * merged entry pool + link closure to resolve/display against, and the
 * stores the popup's Save and add-word actions write to. Threaded as one
 * object so the many pinned call sites (vocabulary rows, note views, session
 * reveal states) don't each grow a handful of near-identical props. */
export interface TapLookup {
  domainContent: DomainContent;
  listStore: VocabListStore;
  userEntryStore: UserEntryStore;
  /** Called after the popup's add-word fallback saves a new entry, so the
   * caller can re-merge the domain's entry pool (plan 0006 step 3's rule). */
  onWordsChanged?: () => void;
}

/**
 * Renders `text` as tappable word tokens (plan 0006's tap-to-lookup):
 * whitespace-delimited — Kyrgyz Cyrillic needs nothing fancier — each token a
 * button that resolves against `lookup.domainContent.entries`
 * (`resolveToken`, inside `EntryPopup`) and opens the popup. Edge
 * punctuation (`"Салам!"` in a sentence) rides along on the token; resolution
 * trims it.
 *
 * Only ever mount this on the plan's pinned non-graded surfaces
 * (vocabulary rows, the popup's own link chips, note views, and session
 * screens *after* the answer is submitted) — never on an unanswered
 * question, or a tap would leak the answer.
 */
export function TappableText({
  text,
  lookup,
}: {
  text: string;
  lookup: TapLookup;
}) {
  const [tappedToken, setTappedToken] = useState<string | null>(null);

  return (
    <span className="tappable-text">
      {text.split(/(\s+)/).map((part, index) =>
        part.trim() === "" ? (
          part
        ) : (
          <button
            key={index}
            type="button"
            className="plain tappable-token"
            onClick={() => setTappedToken(part)}
          >
            {part}
          </button>
        ),
      )}
      {tappedToken !== null ? (
        <EntryPopup
          token={tappedToken}
          lookup={lookup}
          onClose={() => setTappedToken(null)}
        />
      ) : null}
    </span>
  );
}
