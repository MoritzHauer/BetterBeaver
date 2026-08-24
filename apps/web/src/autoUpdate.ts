/** Settings toggle: apply a found content update immediately instead of
 * waiting for a tap on the update banner. Off by default — matches the
 * opt-in spirit of plan 0012 §6. Applies at boot and when the app returns
 * to the foreground on My Books; anywhere else a find still only raises the
 * banner, because accepting reloads the app. */
export const AUTO_UPDATE_KEY = "bb.autoUpdate";

/**
 * How long the app waits between content-update checks when it returns to
 * the foreground. The boot-time check used to be the only one, which on an
 * installed PWA — resumed for weeks, booted almost never — meant the update
 * check effectively did not run. 30 minutes: long enough that tabbing
 * between apps costs no requests, short enough that a day of use looks at
 * the catalog a handful of times.
 */
export const RECHECK_INTERVAL_MS = 30 * 60 * 1000;
