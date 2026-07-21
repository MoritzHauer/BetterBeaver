import { useSyncExternalStore } from "react";

const synth = "speechSynthesis" in window ? window.speechSynthesis : undefined;

function subscribeVoices(callback: () => void): () => void {
  if (synth === undefined) {
    return () => undefined;
  }
  synth.addEventListener("voiceschanged", callback);
  return () => synth.removeEventListener("voiceschanged", callback);
}

/**
 * A local voice matching `lang` by case-insensitive BCP-47 prefix ("en"
 * matches "en-US"). Network-backed voices are ignored — they'd silently
 * break the offline-first invariant (plan 0004's pinned TTS rules).
 */
function matchingVoice(lang: string): SpeechSynthesisVoice | undefined {
  const prefix = lang.toLowerCase();
  return synth
    ?.getVoices()
    .find(
      (voice) =>
        voice.localService &&
        (voice.lang.toLowerCase() === prefix ||
          voice.lang.toLowerCase().startsWith(`${prefix}-`)),
    );
}

/**
 * Whether read-aloud is available: the book's `readAloudLang` is set and a
 * matching local voice exists. Subscribes to `voiceschanged`, so a cold
 * Chrome load (first `getVoices()` returns `[]`) re-renders once voices
 * arrive.
 */
export function useTtsAvailable(lang: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeVoices,
    () => lang !== undefined && matchingVoice(lang) !== undefined,
  );
}

/** Speaks `text` in `lang` via the matched local voice; silently no-ops without one. */
export function speak(text: string, lang: string): void {
  const voice = matchingVoice(lang);
  if (synth === undefined || voice === undefined) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  synth.cancel();
  synth.speak(utterance);
}

/**
 * Speaker button (plan 0004's pinned playback rule): plays the bundled
 * asset when given (assets win — offline-guaranteed, pronunciation-correct),
 * else speaks `text` via TTS; renders nothing when neither is playable.
 */
export function SpeakerButton({
  text,
  lang,
  assetUrl,
}: {
  text: string;
  lang?: string | undefined;
  assetUrl?: string | undefined;
}) {
  const ttsOk = useTtsAvailable(lang);
  if (assetUrl === undefined && !ttsOk) {
    return null;
  }
  return (
    <button
      type="button"
      className="plain speaker"
      aria-label={`Play ${text}`}
      onClick={(event) => {
        event.stopPropagation();
        if (assetUrl !== undefined) {
          void new Audio(assetUrl).play();
        } else if (lang !== undefined) {
          speak(text, lang);
        }
      }}
    >
      &#128266;
    </button>
  );
}
