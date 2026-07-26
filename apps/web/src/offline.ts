/**
 * Settings toggle: offline mode — the app makes no network requests at all.
 * Off by default.
 *
 * Two chokepoints enforce it, because every request in the app goes through
 * one of them: `getSupabase()` (all supabase-js traffic — authoring, feedback
 * votes/reports, chat) returns null, and `fetchRest()` (the anon-key catalog
 * reads behind update checks and the Library) throws. Every caller of
 * `getSupabase()` already null-checks it for the "backend not configured"
 * case, so the Library card, the authoring entry, the feedback widgets and
 * the topic chat all hide themselves for free.
 *
 * Not covered: the service worker's own app-shell refresh
 * (`registerType: "autoUpdate"` in vite.config.ts), which is outside the
 * app's control — switching it to `prompt` registration is the only way to
 * gate that, and it isn't a content or database request.
 */
export const OFFLINE_KEY = "bb.offline";

export function isOffline(): boolean {
  return localStorage.getItem(OFFLINE_KEY) === "on";
}
