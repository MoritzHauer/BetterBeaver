import { useState } from "react";
import type { Domain, Item } from "@betterbeaver/schema";
import { DOMAIN_ENTRY_KIND } from "@betterbeaver/schema";
import { newUserEntryId } from "../progress/user-entries";

/** Add-word form (plan 0006): the Vocabulary screen's own entry point (step
 * 3) and the tap-to-lookup popup's not-found fallback (step 4) both render
 * this. Fields match the domain's entry kind: lexeme
 * (script/transliteration/gloss/example/usageNote) or concept
 * (term/definition/example). Saving creates the entry only — per the plan's
 * rule, saving never creates SRS state or list membership; the word becomes
 * studyable simply by existing in the pool. */
export function AddWordForm({
  domain,
  prefill,
  onSubmit,
  onCancel,
}: {
  domain: Domain;
  /** Prefills the primary field (script for a lexeme, term for a concept) —
   * the tap-to-lookup popup's not-found fallback prefills the tapped token. */
  prefill?: string | undefined;
  onSubmit: (item: Item) => void;
  onCancel: () => void;
}) {
  const kind = DOMAIN_ENTRY_KIND[domain.kind];
  const [script, setScript] = useState(prefill ?? "");
  const [transliteration, setTransliteration] = useState("");
  const [gloss, setGloss] = useState("");
  const [term, setTerm] = useState(prefill ?? "");
  const [definition, setDefinition] = useState("");
  const [exampleText, setExampleText] = useState("");
  const [exampleTranslation, setExampleTranslation] = useState("");
  const [usageNote, setUsageNote] = useState("");

  const valid =
    kind === "lexeme"
      ? script.trim() !== "" &&
        transliteration.trim() !== "" &&
        gloss.trim() !== ""
      : term.trim() !== "" && definition.trim() !== "";

  function submit() {
    const id = newUserEntryId();
    // sourceRef is unused for user entries (they're never
    // validator-checked, and nothing at runtime reads it back off an
    // entry) — a fixed placeholder satisfies the `Item` type.
    const sourceRef = "user";
    const item: Item =
      kind === "lexeme"
        ? {
            id,
            kind: "lexeme",
            sourceRef,
            payload: {
              script: script.trim(),
              transliteration: transliteration.trim(),
              gloss: gloss.trim(),
              example:
                exampleText.trim() !== "" && exampleTranslation.trim() !== ""
                  ? {
                      text: exampleText.trim(),
                      translation: exampleTranslation.trim(),
                    }
                  : undefined,
              usageNote: usageNote.trim() !== "" ? usageNote.trim() : undefined,
            },
          }
        : {
            id,
            kind: "concept",
            sourceRef,
            payload: {
              term: term.trim(),
              definition: definition.trim(),
              example:
                exampleText.trim() !== "" ? exampleText.trim() : undefined,
            },
          };
    onSubmit(item);
  }

  return (
    <div className="list-editor">
      {kind === "lexeme" ? (
        <>
          <input
            type="text"
            placeholder="Script"
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />
          <input
            type="text"
            placeholder="Transliteration"
            value={transliteration}
            onChange={(event) => setTransliteration(event.target.value)}
          />
          <input
            type="text"
            placeholder="Gloss (meaning)"
            value={gloss}
            onChange={(event) => setGloss(event.target.value)}
          />
          <input
            type="text"
            placeholder="Usage note (optional)"
            value={usageNote}
            onChange={(event) => setUsageNote(event.target.value)}
          />
          <input
            type="text"
            placeholder="Example sentence (optional)"
            value={exampleText}
            onChange={(event) => setExampleText(event.target.value)}
          />
          <input
            type="text"
            placeholder="Example translation (optional)"
            value={exampleTranslation}
            onChange={(event) => setExampleTranslation(event.target.value)}
          />
        </>
      ) : (
        <>
          <input
            type="text"
            placeholder="Term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <input
            type="text"
            placeholder="Definition"
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
          />
          <input
            type="text"
            placeholder="Example (optional)"
            value={exampleText}
            onChange={(event) => setExampleText(event.target.value)}
          />
        </>
      )}
      <div className="grade-buttons">
        <button className="primary" disabled={!valid} onClick={submit}>
          Add word
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
