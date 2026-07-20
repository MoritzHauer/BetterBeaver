# Plan 0013: Screen-navigation performance

Status: **step 1 implemented 2026-07-20** · Owner: Moe · Date: 2026-07-20 · Triggered by a user report: the app feels slow/unresponsive when switching screens, reproduces in flight mode (so not network/DB).

## Purpose

Moe reported navigation jank that reproduces offline. This plan is the writeup of a metrics-first investigation into that report — real numbers on a production build under CPU throttling, a CDP trace splitting the cost into JS vs. browser layout/paint, and a regression test that now guards the confirmed defect. It proposes a scoped first fix and defers the larger question (does `apps/web` need a stable shell instead of full top-level screen remounts) to a follow-up design pass.

## Findings

All numbers are from `vite build` + `vite preview` (the real GitHub Pages bundle, not `vite dev` — dev mode's unbundled modules and dev-build React inflate timings) driven headless via `playwright-core` (no Playwright in the repo; installed ad hoc per [`apps/web/.claude/skills/verify/SKILL.md`](../../apps/web/.claude/skills/verify/SKILL.md)'s recipe), with Chrome DevTools Protocol `Emulation.setCPUThrottlingRate: 5` as a proxy for a mid/low-end phone (BetterBeaver is a phone-first PWA — see the vite config's HTTPS-for-phone note). 5× throttling on headless desktop Chromium is directional, not a real-device benchmark.

1. **The jank is real and reproducible offline.** Content boots once from the bundled seed / IndexedDB cache (`content/source.ts`); no screen navigation touches the network. Per-navigation long tasks (browser `longtask` entries, >50ms is the standard jank threshold) measured in the click-to-render window:

   | Navigation | Wall time | Long task in window |
   | --- | --- | --- |
   | Start → Topics | 315ms | 223ms |
   | Topics → Topic | 162–193ms | 88–121ms |
   | Topic → Lesson | 123ms | 56ms |

2. **Each tap commits the App tree 2–3 times, not once.** `App.tsx`'s ~900-line body re-renders on every state change, and a single navigation triggers a chain of them: `goToTopic` batches `setTopicEpoch` + `setScreen` (1 render, shows "Loading…" — `App.tsx:683`), then the `loadTopic` effect (`App.tsx:494`) resolves and calls `setContent` (2nd render), then the domain-loading effect (`App.tsx:509`, `loadDomain` + `symmetricLinks` + user entries) resolves and calls `setDomainContent`/`setDomainTopicsContent` (3rd render). Two of the three commits paint a bare `<p>Loading…</p>` before the real screen — a visible flash. Confirmed with React's `Profiler` in a real browser (3 commits for Topics → Topic) and pinned by a new regression test (see Tests below).

3. **Ruled out: JS render work and engine compute.** Summing `Profiler`'s `actualDuration` across all 3 commits for Topics → Topic totals **~6ms**. `symmetricLinks` over the full bundled Kyrgyz domain (116 entries) runs in **0.25ms**. Neither React's reconciliation nor the engine's link/session-building functions are the bottleneck — content is small (12KB bundled) and stays cheap even fully in memory.

4. **Where the time actually goes: browser Layout, not scripting.** A CDP `Tracing` capture of the Topics → Topic tap (throttled) shows a single **~44ms `Layout` (reflow) event** inside the outer ~86ms task, alongside ~23ms of `EventDispatch`. This lines up with the architecture: `App.tsx` has no router or stable shell — it's a top-level `if`/`else` chain that fully unmounts the previous screen's component tree and mounts a completely different one every navigation (`App.tsx:565-937`). The browser has to lay out a freshly built DOM subtree from scratch on every tap, and per finding 2 it does this 2–3 times per tap, not once.

5. **Separate, lower-priority finding: no code splitting.** `vite build` emits a single unsplit `index-*.js` at 704KB (190KB gzip) — Vite's own build warns about it. This doesn't explain per-navigation cost (parsed once at boot) but adds to first-load time. Worth a follow-up, not bundled into this plan's fix.

## Tests

Added this session, running under the existing `corepack pnpm check` gate (already required before deploy — `.github/workflows/deploy.yml`):

- **[`apps/web/src/App.nav-perf.test.tsx`](../../apps/web/src/App.nav-perf.test.tsx)** — renders `<App>` under a React `Profiler`, drives Topics → Topic via `@testing-library/react`, and asserts the App tree commits **at most 3 times** (the current, already-elevated baseline — this is a regression guard, not a target). New devDependencies (`jsdom`, `@testing-library/react`), `apps/web/vitest.config.ts` (jsdom environment), and `apps/web/src/test-setup.ts` (stubs `window.matchMedia`, unimplemented in jsdom) wire `apps/web` into the root `vitest.config.ts` projects list — `apps/web` had no tests before this.
- This guards finding 2 (the commit cascade / Loading flash) only. It does **not** guard finding 4 (the Layout cost) — that requires a real browser and CPU throttling, which is why it isn't a CI test (see Non-goals).

## Goals (next steps — not implemented by this plan document)

1. **Collapse the 3-commit cascade to 2.** `App.tsx`'s `loadTopic` effect (line 494) and domain-loading effect (line 509) are independent effects that each call their own `setState` on screen change. Combine them into one effect that awaits `loadTopic` + `loadDomain` + the domain's topics + user entries together, then commits once via a single combined `setState` (e.g. one `{content, domainContent, domainTopicsContent}` state object instead of three). This can't reach 1 commit — the synchronous `setScreen` still renders the "Loading…" placeholder before the async work resolves — but removes one of the two Loading-flash commits and one of the two forced reflows. Tighten `App.nav-perf.test.tsx`'s ceiling from 3 to 2 as part of this change (the test's doc comment already flags this).
2. **Re-measure before going further.** Re-run the CDP trace from finding 4 after step 1 lands. If the 44ms Layout cost shrinks proportionally with fewer remounts, that's strong evidence the fix is working and step 3 can be scoped tighter; if it barely moves, the cost is dominated by the size of the DOM subtree being built (not how many times), and step 3 becomes the priority. Also worth checking whether `TopicScreen`'s own post-mount effect (see "Step 1 implementation" above) forces a measurable second layout pass on Topic screens specifically — if so, that's a small separate fix (batch `dueUnits`/`getStreak` into the initial render data instead of a post-mount effect), not part of the app-shell question in step 3.
3. **Scope a stable app shell.** If step 2 shows residual Layout cost, design (separately — this is a bigger change than this plan's fix) a persistent shell (header/back-chrome that doesn't unmount) so navigation updates a screen body in place instead of remounting `App.tsx`'s entire top-level `if`/`else` output. This needs its own design pass — component boundaries, whether a minimal router replaces the hand-rolled `Screen` union — before implementation.
4. **(Separate, lower priority) Code-split the bundle.** Dynamic-`import()` the screen components so `vite build` stops emitting one 704KB chunk. Improves first load; unrelated to per-navigation cost.

## Step 1 implementation (2026-07-20)

Delegated and landed: `App.tsx`'s `loadTopic` effect and `loadDomain`/`symmetricLinks` effect (finding 2) are merged into one effect that resolves both via a single `Promise.all(...).then(...)`, so `content`, `domainContent`, and `domainTopicsContent` commit together instead of in two separate `setState` calls (`App.tsx:494-575`). The code is correct and `pnpm check` is green, but **whether it changes anything observable — in the test or in production — is now in doubt**, and finding 2's original attribution of the 3 commits looks wrong. This needs re-verification, not just a status update.

**The regression test's ceiling stayed at 3, not 2.** Instrumenting the merge before landing it surfaced two things:

- `TopicScreen.tsx`'s own post-mount effect (`TopicScreen.tsx:76-92`, `dueUnits(...)` + `store.getStreak(...)`) fires after `TopicScreen` mounts and is a third, independent commit source that finding 2 never measured or mentioned — it isn't part of `App.tsx`'s top-level cascade at all.
- With that 3rd source accounted for, the jsdom commit count was **3 both before and after** the merge: 1 sync (`setScreen`) + 1 for the merged/previously-two App-level effects + 1 for `TopicScreen`. The App-level pair was apparently already resolving in the same microtask tick and batching into one commit even *before* this change.

**This contradicts finding 2 as written, not just the test.** Finding 2 measured 3 commits in a real browser via Profiler and attributed them entirely to `setScreen` + `loadTopic` + `loadDomain` — with no `TopicScreen` in the count. If `TopicScreen`'s effect is a real, independent commit source (confirmed here in jsdom, and there's no reason it wouldn't also fire in a real browser), a real-browser count of exactly 3 is only consistent with the App-level pair *already* having been a single batched commit pre-merge.

**Checked, not assumed: this is confirmed by the actual content-source code, not just inferred from finding 1's "no network" claim.** `packages/engine/src/documentSource.ts`'s `createDocumentContentSource` (the only content source `apps/web` ever constructs — see `content/source.ts`'s `buildFromDocuments`/`buildFromSeed`) implements `loadTopic`/`loadDomain` as pure synchronous lookups into in-memory `Map`s populated once at boot, each just wrapped in `Promise.resolve(...)` (`documentSource.ts:191-198,209-217`) — not a per-navigation IndexedDB or network read. That means `loadTopic(...)` and `loadDomain(...)` resolve on the same microtask tick every time, in production exactly as in this jsdom test. **Step 1's merge is therefore very likely inert as a commit-count fix in the real browser too** — a real correctness improvement (batching is now guaranteed by construction instead of an artifact of both promises happening to resolve immediately) but not the measured perf win finding 2's "3 commits, 2 of them collapsible" framing implied. Goal 2's Profiler re-trace should confirm this (same-tick `Promise.resolve` scheduling could in principle behave differently between jsdom's microtask queue and V8-in-Chrome's, though there's no reason to expect it does) rather than assume it.

**What this means for goal 2:** the CDP re-trace needs to also count React commits via Profiler in the real browser, before comparing against this jsdom baseline, and needs to isolate `TopicScreen`'s contribution from `App.tsx`'s. Don't treat step 1 as "the fix that reduced commits" going into that re-measurement — treat it as a robustness change with an expected-neutral effect on the commit count, confirmed or refuted by that re-trace.

`App.nav-perf.test.tsx`'s ceiling and doc comment were updated to describe all three commit sources accurately rather than tightened to a number the code doesn't hit.

One more accepted side effect: the merged effect's dependency array is the union of the two originals, so it now also re-fires on `domainEpoch` changes while on a topic/lesson/unit/task/unit-session screen (e.g. adding a word via tap-to-lookup) — the original `loadTopic` effect didn't depend on `domainEpoch`. This redundantly re-fetches and re-sets `content` with an equivalent-but-different object reference on those bumps. It doesn't add a commit (it lands in the same batched update `domainEpoch` was already triggering) but is a small wasted fetch/recompute the original code didn't do. Not fixed here — narrowing it back would mean splitting into two effects again, defeating the merge's point — but worth knowing if it ever shows up in profiling.

## Non-goals

- **Not implementing the fix in this plan.** This document is metrics + regression test + a scoped proposal, per the session's ask; steps 1–4 above are backlog, executable via `/delegate` once prioritized.
- **Not adding Playwright/a real-browser test to CI.** A wall-clock threshold on CI runners is flaky — too tight and it false-fails on load, too loose and it stops catching regressions (the advisor's steer, confirmed by this investigation: the deterministic commit-count test is the guard that will actually hold). Revisit only if the render-count guard proves insufficient once step 1 lands.
- **Not touching `SessionScreen`/`EditScreen`'s internal rendering** — this investigation covered top-level screen switching (`App.tsx`'s `Screen` union) only, not what those large screens do once mounted.
- **Not a real-device benchmark.** 5× CPU throttling on headless desktop Chromium is a proxy; if the fix needs validating against an actual phone, that's a manual step before calling this done, not part of the automated guard.
