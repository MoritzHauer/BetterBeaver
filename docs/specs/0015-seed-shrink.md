# Spec 0015-6: Bundled seed shrinks to the onboarding Book

Normative source: [plan 0015](../plans/0015-library-marketplace.md) decision 10. Lands **last** — requires 0015-4/5 working, so Kyrgyz stays reachable via the Library after it leaves the repo.

## Changes

1. **Delete `content/kyrgyz/` and `content/lexicon/ky/`** from the repo. `content/` afterwards: `demo/` and `lexicon/demo/` only. (Kyrgyz's canonical source is the live Supabase backend since plan 0012; the bundled tree is a frozen mirror, never hand-edited — nothing is lost.)
2. **`scripts/export-content.ts`**: re-scope to export only the onboarding Book (`demo` + `lexicon/demo`) so future seed refreshes can't resurrect other Books. Keep the script's existing behavior otherwise.
3. **`apps/web/src/content/bundled.ts`**: remove the plan-0006 legacy `localStorage` migration fan-out for the `ky` domain (the knowing removal recorded in plan 0015 decision 10); adjust any comments/expectations that assume multiple bundled books. The globs themselves stay pattern-identical (they just match less).
4. **`apps/web/vite.config.ts`**: no change (precache globs are extension-wide; verify nothing content-path-specific exists — if you find one, stop and report rather than invent).
5. Tests: `packages/schema/src/content.test.ts` iterates `content/` directories — must pass over the shrunk tree without weakening any assertion (it validates whatever exists; deleting content dirs should be transparent). Fix only what the deletion genuinely breaks (e.g. a test hardcoding `kyrgyz`).

## Done criteria

1. `corepack pnpm check` green.
2. `grep -rn "kyrgyz\|/ky/" apps/web/src packages scripts content` → no live references to the removed trees (docs/plans may still mention Kyrgyz historically; that's fine — repo docs are out of scope).
3. Dev-server boot: fresh profile boots to My Books with only "Meet BetterBeaver"; Kyrgyz appears in the Library and Adds successfully (needs the configured backend).

## Out of scope

Everything else. No decisions open.
