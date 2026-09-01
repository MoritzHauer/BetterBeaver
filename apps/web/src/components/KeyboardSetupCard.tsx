/**
 * The keyboard setup card (plan 0025 §10).
 *
 * A domain that declares `extraChars` is saying "this script needs
 * characters your keyboard may not have" — `ң ө ү` for Kyrgyz, whose
 * learners type on a Russian layout, which has the other 33 letters and not
 * those three. Typed answers are graded against the exact script and
 * normalization deliberately never folds ң onto н, so without one of the two
 * fixes below those answers are unanswerable rather than merely awkward.
 *
 * **The platform keyboard is the real fix**, which is why this card leads
 * with it and the in-app key row is offered underneath as the fallback. A
 * learner who adds the layout needs no row at all, and three extra keys
 * under every typed answer are clutter for them.
 *
 * The fallback is offered here rather than assumed, because the walkthrough
 * can fail invisibly: nothing lets the app detect whether a layout was
 * actually added, iOS may not offer one natively, and managed or Play-less
 * devices can block the path entirely.
 *
 * Data-driven, not Kyrgyz-specific: the characters come from the domain, and
 * the steps from the user agent. Turkish, German or a maths domain get the
 * same card with their own characters.
 */

/** Which walkthrough a viewer needs. */
export type KeyboardPlatform = "android" | "ios" | "desktop";

/** The platform whose keyboard settings the steps should describe. Exported
 * for its own test — `navigator.userAgent` is the only input, so this stays
 * a pure function of a string. */
export function keyboardPlatform(userAgent: string): KeyboardPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "ios";
  }
  if (/Android/i.test(userAgent)) {
    return "android";
  }
  return "desktop";
}

/** Per-platform steps. Deliberately named surfaces rather than screenshots:
 * a menu path a learner can follow survives an OS update, and an image of
 * one Android skin does not describe the next. */
const STEPS: Record<KeyboardPlatform, string[]> = {
  android: [
    "Open Settings, then System · Languages & input · On-screen keyboard.",
    "Pick Gboard (it ships on most Android phones), then Languages · Add keyboard.",
    "Search for the language you are learning and add it.",
    "While typing, hold the globe or space bar to switch to it.",
  ],
  ios: [
    "Open Settings, then General · Keyboard · Keyboards · Add New Keyboard.",
    "If the language is listed, add it and you are done.",
    "If it is not, iOS does not ship it — installing Gboard or Keyman from the App Store adds it, which asks for “Allow Full Access”.",
    "While typing, tap the globe to switch to it.",
  ],
  desktop: [
    "Windows: Settings · Time & language · Language & region · Add a language.",
    "macOS: System Settings · Keyboard · Input Sources · Add.",
    "Linux: add the layout in your desktop's keyboard settings.",
    "Then switch layouts while you type — usually the taskbar's language button.",
  ],
};

export function KeyboardSetupCard({
  chars,
  platform,
  extraKeys,
  onToggleExtraKeys,
  onDismiss,
}: {
  /** The domain's `extraChars` — non-empty, or the caller should not render this. */
  chars: readonly string[];
  platform: KeyboardPlatform;
  /** Whether the in-app key row is currently on. */
  extraKeys: boolean;
  onToggleExtraKeys: (next: boolean) => void;
  /** Omitted where the card is opened deliberately (Settings), where there
   * is nothing to dismiss — Back is the way out. */
  onDismiss?: () => void;
}) {
  return (
    <section className="card keyboard-setup">
      <h2>Typing {chars.join(" ")}</h2>
      <p className="status">
        {chars.length === 1 ? "This character is" : "These characters are"} part
        of the script you are learning, and most keyboards do not have{" "}
        {chars.length === 1 ? "it" : "them"}. Adding the language's own keyboard
        layout is the fix that works everywhere in your phone, not just here.
      </p>
      <ol>
        {STEPS[platform].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <label className="field">
        <input
          type="checkbox"
          checked={extraKeys}
          onChange={(event) => onToggleExtraKeys(event.target.checked)}
        />{" "}
        Can&rsquo;t add a layout? Show {chars.join(" ")} under typed answers
        instead.
      </label>
      {onDismiss !== undefined && (
        <button className="primary" onClick={onDismiss}>
          Got it
        </button>
      )}
    </section>
  );
}
