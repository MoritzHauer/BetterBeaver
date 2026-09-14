/**
 * Text-size preference (Settings › Appearance).
 *
 * Why this exists: the viewport meta in `index.html` carries
 * `user-scalable=no`, so pinch-zoom is off — and iOS honours that in exactly
 * the installed/standalone context this app is built for. Half of the app's
 * `font-size` declarations are under 14px, and `.status` carries whole
 * descriptive sentences at 12px, so a learner with low vision had no way at
 * all to make text bigger (ui-review 2026-09-13, finding sy-zoom).
 *
 * This is the in-app replacement for the gesture. Because `styles.css` sizes
 * almost everything in `rem`, moving the root font-size moves the whole
 * layout with it — type, padding and gaps together — rather than just
 * swelling text inside fixed boxes. The `min-height: 44px` tap floors stay in
 * px on purpose: they are a floor, not a driver, and rem padding already
 * grows the controls past it.
 *
 * Storage mirrors `theme.ts` exactly: the value is stored raw under
 * `bb.textSize`, and the *default* is the absence of the key, so it exports
 * and imports cleanly and a fresh install needs no migration. An inline
 * script in `index.html` applies it before first paint, for the same reason
 * the theme is applied there — otherwise every launch flashes at one size
 * and reflows to another.
 */
export type TextSize = "default" | "large" | "larger";

export const TEXT_SIZE_KEY = "bb.textSize";

/** Root font-size per step. 100% is the browser default (normally 16px), so
 * "default" writes nothing and inherits whatever the user's browser sets. */
const SCALE: Record<Exclude<TextSize, "default">, string> = {
  large: "112.5%",
  larger: "125%",
};

export function getTextSize(): TextSize {
  const value = localStorage.getItem(TEXT_SIZE_KEY);
  return value === "large" || value === "larger" ? value : "default";
}

function apply(size: TextSize): void {
  if (size === "default") {
    document.documentElement.style.removeProperty("font-size");
  } else {
    document.documentElement.style.fontSize = SCALE[size];
  }
}

export function setTextSize(size: TextSize): void {
  if (size === "default") {
    localStorage.removeItem(TEXT_SIZE_KEY);
  } else {
    localStorage.setItem(TEXT_SIZE_KEY, size);
  }
  apply(size);
}
