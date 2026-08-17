import { useState } from "react";
import type { Item } from "@betterbeaver/schema";
import { itemDisplayText, recognizePrompt } from "@betterbeaver/schema";
import { resolveToken } from "@betterbeaver/engine";
import { getLexiconAssetUrl } from "../content/bundled";
import { saveWordToSavedList } from "../progress/vocab-lists";
import { SpeakerButton } from "../tts";
import { Sheet } from "./Sheet";
import { AddWordForm } from "./AddWordForm";
import type { TapLookup } from "./TappableText";

/** An entry's own `audioRef` stem, per kind (only lexeme/concept carry one). */
function audioStemOf(entry: Item): string | undefined {
  return entry.kind === "lexeme" || entry.kind === "concept"
    ? entry.payload.audioRef
    : undefined;
}

/** The entry's own example, per kind (lexeme: text+translation pair; concept: a bare string). */
function ExampleLine({ entry }: { entry: Item }) {
  if (entry.kind === "lexeme" && entry.payload.example !== undefined) {
    return (
      <p className="usage-note">
        {entry.payload.example.text} — {entry.payload.example.translation}
      </p>
    );
  }
  if (entry.kind === "concept" && entry.payload.example !== undefined) {
    return <p className="usage-note">{entry.payload.example}</p>;
  }
  return null;
}

/**
 * Entry popup (plan 0006 step 4, pinned contents): script/term, speaker
 * button, transliteration, gloss/definition, example, family names (cheap
 * reverse lookup over `domainContent.families` — real families aren't
 * shipped yet, so this renders nothing until step 5 seeds some), tappable
 * link chips, and one action, "★ Save" (the same idempotent
 * save-to-`saved`-list helper step 3 built). Not-found state renders the
 * add-word fallback prefilled with the tapped token — the popup never
 * dead-ends.
 *
 * Link-chip navigation is a local state swap (`shown`), not routing: tapping
 * a chip re-resolves this same popup instance to the linked entry.
 */
export function EntryPopup({
  token,
  entryId,
  lookup,
  onClose,
}: {
  token: string;
  /** Opens this exact entry directly, skipping `resolveToken` (plan 0006
   * step 5): for following an already-known link (a vocabulary-row synonym
   * chip), where the tap-to-lookup tie-break rules don't apply — we already
   * know which entry we want. */
  entryId?: string;
  lookup: TapLookup;
  onClose: () => void;
}) {
  const { domainContent, listStore, userEntryStore, onWordsChanged } = lookup;
  const { domain, entries, linksByEntryId, families } = domainContent;

  const [shown, setShown] = useState<
    { kind: "token"; token: string } | { kind: "entry"; id: string }
  >(
    entryId !== undefined
      ? { kind: "entry", id: entryId }
      : { kind: "token", token },
  );
  const [saved, setSaved] = useState(false);

  const entry: Item | undefined =
    shown.kind === "entry"
      ? entries.find((e) => e.id === shown.id)
      : resolveToken(shown.token, entries);

  function openEntry(id: string) {
    setSaved(false);
    setShown({ kind: "entry", id });
  }

  async function handleSave() {
    if (entry === undefined) {
      return;
    }
    await saveWordToSavedList(listStore, domain.id, entry.id);
    setSaved(true);
  }

  async function handleAddWord(item: Item) {
    await userEntryStore.saveEntry(domain.id, item);
    onWordsChanged?.();
    openEntry(item.id);
  }

  const displayToken = shown.kind === "token" ? shown.token : token;
  const audioStem = entry !== undefined ? audioStemOf(entry) : undefined;
  const resolvedLinks =
    entry !== undefined
      ? (linksByEntryId.get(entry.id) ?? []).flatMap((link) => {
          const target = entries.find((e) => e.id === link.entryId);
          return target !== undefined ? [{ link, target }] : [];
        })
      : [];
  const entryFamilies =
    entry !== undefined
      ? families.filter((family) => family.entryIds.includes(entry.id))
      : [];
  const components =
    entry !== undefined && entry.kind === "lexeme"
      ? (entry.payload.components ?? [])
      : [];

  // `Sheet` owns the `<dialog>`, the portal to `document.body` and the
  // dismissal behaviours (Escape, backdrop click) this popup used to lack
  // entirely. The close button stays: on touch there is no Escape key, and
  // the backdrop is easy to miss.
  return (
    <Sheet label={displayToken} onDismiss={onClose}>
      <>
        <button
          type="button"
          className="plain sheet-close"
          aria-label="Close"
          onClick={onClose}
        >
          &#10005;
        </button>
        {entry === undefined ? (
          <>
            <p>No entry found for “{displayToken}”.</p>
            <AddWordForm
              domain={domain}
              prefill={displayToken}
              onSubmit={(item) => void handleAddWord(item)}
              onCancel={onClose}
            />
          </>
        ) : (
          <>
            <h2>
              {recognizePrompt(entry)}{" "}
              <SpeakerButton
                text={recognizePrompt(entry)}
                lang={domain.readAloudLang}
                assetUrl={
                  audioStem !== undefined
                    ? getLexiconAssetUrl(domain.id, "audio", audioStem)
                    : undefined
                }
              />
            </h2>
            {entry.kind === "lexeme" ? (
              <p className="status">{entry.payload.transliteration}</p>
            ) : null}
            <p>{itemDisplayText(entry)}</p>
            <ExampleLine entry={entry} />
            {components.length > 0 ? (
              <p className="chips">
                {components.map((component, index) => {
                  const target = resolveToken(component.text, entries);
                  return (
                    <button
                      key={`${component.text}-${index}`}
                      type="button"
                      className="plain chip"
                      onClick={() =>
                        target !== undefined && openEntry(target.id)
                      }
                    >
                      {component.text} — {component.gloss}
                    </button>
                  );
                })}
              </p>
            ) : null}
            {entryFamilies.length > 0 ? (
              <p className="chips">
                {entryFamilies.map((family) => (
                  <span key={family.id} className="chip">
                    {family.name}
                  </span>
                ))}
              </p>
            ) : null}
            {resolvedLinks.length > 0 ? (
              <p className="chips">
                {resolvedLinks.map(({ link, target }) => (
                  <button
                    key={`${link.type}-${link.entryId}`}
                    type="button"
                    className="plain chip"
                    onClick={() => openEntry(target.id)}
                  >
                    {recognizePrompt(target)}
                  </button>
                ))}
              </p>
            ) : null}
            <button
              className="primary"
              disabled={saved}
              onClick={() => void handleSave()}
            >
              {saved ? (
                "Saved"
              ) : (
                <>
                  <img
                    className="icon-glyph"
                    src={`${import.meta.env.BASE_URL}art/icons/star.png`}
                    alt=""
                  />{" "}
                  Save
                </>
              )}
            </button>
          </>
        )}
      </>
    </Sheet>
  );
}
