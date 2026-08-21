/**
 * A tiny on-device log of navigation events, shown at the bottom of About.
 *
 * Why this exists: the hardware-back bug has now been "fixed" twice from
 * reasoning plus a desktop browser, and twice the phone disagreed. The app
 * reproduces correctly in headless Chromium against the production build with
 * the service worker active, so the difference is the device — and a black
 * screen leaves nothing to inspect, since the page it lands on is not ours.
 * A ring buffer in `localStorage` survives the document being destroyed,
 * which is exactly the evidence a screenshot of a black page cannot carry.
 *
 * Cheap on purpose: one small write per navigation event, capped, and every
 * access is guarded — a full or blocked `localStorage` must never be the
 * reason a back press fails (`storage-health.ts` covers the same hazard for
 * progress).
 */

const KEY = "bb.navDiary";
const CAP = 24;

export type NavEntry = {
  /** Local wall-clock `HH:MM:SS` — enough to line up with "it went black". */
  at: string;
  event: string;
  detail: string;
};

function read(): NavEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NavEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends one event, dropping the oldest past `CAP`. Never throws. */
export function recordNav(event: string, detail = ""): void {
  try {
    const at = new Date().toTimeString().slice(0, 8);
    const next = [...read(), { at, event, detail }].slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full, blocked, or unavailable. Diagnostics are never worth
    // breaking navigation for.
  }
}

export function readNavDiary(): NavEntry[] {
  return read();
}

export function clearNavDiary(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}

/** One line per entry, for the copy-out button on About. */
export function formatNavDiary(entries: NavEntry[]): string {
  return entries
    .map(({ at, event, detail }) =>
      detail === "" ? `${at} ${event}` : `${at} ${event} — ${detail}`,
    )
    .join("\n");
}
