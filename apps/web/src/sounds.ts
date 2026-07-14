/** WebAudio-synthesized feedback tones (plan 0003) — no asset files. Each
 * call is fire-and-forget and silently no-ops where audio is unavailable.
 * ponytail: no mute toggle yet — add one when the tones grate (plan 0003
 * open question). */

let ctx: AudioContext | null = null;

function tone(
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = "sine",
  peak = 0.15,
): void {
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + startOffset;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function play(notes: () => void): void {
  try {
    notes();
  } catch {
    // No audio (e.g. AudioContext unavailable): feedback is visual anyway.
  }
}

/** Short rising chirp on a correct answer. */
export function playCorrect(): void {
  play(() => {
    tone(660, 0, 0.12);
    tone(880, 0.09, 0.16);
  });
}

/** Low muted tone on a wrong answer. */
export function playWrong(): void {
  play(() => tone(180, 0, 0.25, "triangle", 0.12));
}

/** Brief fanfare for the session-summary screen. */
export function playFanfare(): void {
  play(() => {
    [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * 0.12, 0.2));
  });
}
