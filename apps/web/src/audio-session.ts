/**
 * iOS Safari's ring/silent switch only mutes audio in the "ambient" category.
 * A page's Web Audio starts there, but once an `<audio>` element has played
 * audibly (the speaker button's bundled asset) WebKit's automatic choice
 * moves the whole page to "playback" — and from then on the feedback tones
 * play through mute too. Pinning the page's audio session to "ambient"
 * (Safari 16.4+) makes every sound the app plays honor the switch, and mix
 * with the learner's music instead of pausing it.
 *
 * Elsewhere this is a no-op: Chrome and Firefox don't implement
 * `navigator.audioSession`, and on Android a page plays on the media stream
 * with no way to read the ringer mode — there, media volume is the control.
 */
interface AudioSession {
  type: string;
}

/** Declares the page's audio ambient; call before any audio starts. */
export function declareAmbientAudio(): void {
  const session = (navigator as { audioSession?: AudioSession }).audioSession;
  if (session !== undefined && session.type !== "ambient") {
    session.type = "ambient";
  }
}
