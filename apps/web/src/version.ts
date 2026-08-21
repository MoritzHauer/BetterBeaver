/**
 * Build stamp, shown on the About screen.
 *
 * `apps/web/package.json`'s `version` is the single source of truth and
 * `vite.config.ts` inlines it here (plus the CI commit) through `define`.
 * Both are read behind a `typeof` guard because a bare `define` identifier
 * that was never defined is a `ReferenceError`, not `undefined` — and vitest
 * runs from its own config (`apps/web/vitest.config.ts`), which defines
 * neither. Tests and `vite dev` therefore see the placeholders below, which
 * is also the honest answer: neither is a released build.
 */

declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__;

/** Short commit sha of the deployed build; empty outside CI (`GITHUB_SHA`). */
export const APP_COMMIT =
  typeof __APP_COMMIT__ === "undefined" ? "" : __APP_COMMIT__;

/** Public source. Linked from About and from the README. */
export const REPO_URL = "https://github.com/MoritzHauer/BetterBeaver";
