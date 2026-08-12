# Plan 0003: UI/UX polish (feel + streak)

Status: implemented (2026-07-14, steps 1–5; browser-verified per step 5) · Owner: Moe · Date: 2026-07-14 · Prerequisite: plans 0001 and 0002 complete (they are).

## Purpose

Make the web app feel like a well-designed learning app — comparable in polish to Duolingo, without imitating its visual identity. Everything here is presentation-layer work in `apps/web`, plus exactly one domain mechanic (a daily streak) in `packages/engine` and the `ProgressStore`.

## Goals

- Every screen reads as a designed product: brand color, bundled typeface, tactile buttons, dark and light mode both tuned.
- The session loop has the signature interactions of a polished learning app: persistent bottom action bar, top progress bar, answer feedback with color and sound, a celebratory summary.
- A daily streak that motivates a solo learner, visible on the topic screen and at session end.

## Non-goals

- No XP, leagues, hearts/lives, daily goals, streak freezes, or any social mechanic — a solo M1 user makes them noise.
- No mascot or illustration system; no confetti (revisit at retro if session end feels flat).
- No CSS framework, component library, or animation library — plain CSS extends `styles.css`.
- No cloning Duolingo's look: not its font, not its 3D bottom-edge buttons, not the winding path.
- No sound-asset pipeline (tones are synthesized) and no mute toggle yet (add when the tones grate).
- No layering change: views stay logic-free per docs/architecture.md; the streak rule is the only new engine code.

## Design decisions (the contract)

### Brand and tokens

- Primary: beaver amber (`#e08820` family), applied via CSS custom properties in `:root` — filled primary buttons, progress bar, streak flame, selected states, focus rings.
- Correct/incorrect green/red stay semantic and unchanged in meaning; hues may be tuned for contrast against amber.
- Dark mode stays; both palettes tuned together. All text/background pairs meet WCAG AA contrast.
- PWA `theme_color` (currently `#2e7d32`) and the app icons are recolored/redrawn to the amber identity.

### Typography

- One self-hosted variable font, bundled in the repo and added to the PWA precache (`woff2` joins `globPatterns`). Polished but distinct from Duolingo's rounded look — candidates: Manrope, Plus Jakarta Sans; final pick against rendered screens during step 2.
- System stack remains the fallback in `font-family`.

### Session screen (all 10 task types)

- **Bottom action bar** (one shared component): a fixed bar at the bottom of the viewport that is the single action zone. Before answering it holds the submit/check action (or nothing for tap-to-answer types); after answering it slides up filled green/red with the verdict ("Correct!" / the right answer) and a full-width Continue button. Self-graded types (recall, shadowing) put Again/Hard/Good in the same bar after reveal. Enter submits/continues where a form is involved (preserving today's form-submit behavior). This replaces every scattered per-interaction Next/Submit button.
- **Top progress bar**: thin bar filling per answered question, replacing the "Question 3 of 12" text; the Exit button becomes an ✕ beside it.
- **Transitions**: the next question slides in on advance (the `key={index}` remount already exists; CSS animation only). All animation is disabled under `prefers-reduced-motion`.
- **Sound**: WebAudio-synthesized tones, no asset files — a short rising chirp on correct, a low muted tone on wrong, a brief fanfare on the summary screen.
- **Press feedback**: buttons, MCQ choice cards, matching cards, and scramble tokens respond to press with `transform: scale(~0.97)` plus a shade shift. Rounded corners, amber-filled primaries, outlined secondaries. Touch targets ≥ 44px.

### Session-end screen

- Stat-tile celebration: the accuracy stat (or the again/hard/good tallies for self-graded sessions) animates in large, laid out as tiles; the streak flame ticks up with a small animation when today extended it. Data is what `SessionSummary` already carries plus the streak state.

### Streak (the one engine mechanic)

- **Rule**: any recorded grade marks the *local* calendar day active. Consecutive active days increment the streak; a missed day resets it to 1 on the next active day; no freezes or grace. (SRS due-dates stay UTC per plan 0001 — independent systems, no conflict.)
- **Storage**: `ProgressStore` gains `getStreak(): Promise<Streak | null>` and `setStreak(streak: Streak): Promise<void>` where `Streak = { lastActiveDay: string /* YYYY-MM-DD local */, length: number }`.
- **Rule placement**: a pure function in `packages/engine` (`advanceStreak(prev: Streak | null, now: Date): Streak`), applied inside `recordGrade` — the single function all task and review grading already routes through, so no view code participates.
- **Display**: flame + count on the topic screen header and on the session-end screen.

### Topic and unit screens

- **Topic screen**: unit cards get a per-unit progress indicator (n of m tasks attempted — derivable from `attemptedTaskIds`, no new state), a lock icon for locked units, and Review pinned at top styled as the day's primary action with a due-count badge. Streak flame in the header.
- **Topic list**: same card treatment, each topic with a simple glyph/emoji.
- **Unit (learn) screen**: notes, item cards, and task cards restyled with the same card/typography system; task cards get a clear primary practice button and the done-mark becomes a proper badge.
- No winding-path layout — a card list is honest at 2–3 units per topic; reconsider if a topic reaches ~20 units.

## Implementation order (each step = one delegable spec; `pnpm check` green after every step)

1. **Streak mechanic** (`packages/engine`, `apps/web/src/progress/local-storage.ts`): `Streak` type, `advanceStreak` pure function, `ProgressStore` extension, hook in `recordGrade`, localStorage implementation; mocked-clock tests (same day no-op, next day increment, gap reset, month/year boundaries). No UI yet.
2. **Design foundation** (`apps/web`): bundled font + `@font-face` + precache glob, token overhaul in `styles.css` (amber palette light+dark), button/card/press-feedback system, focus-visible styles. Every screen inherits; no structural changes.
3. **Session screen** (`apps/web`): bottom action bar component replacing all per-interaction submit/next buttons across the 10 task types, top progress bar + ✕ exit, question slide-in transition, WebAudio tones, `prefers-reduced-motion` handling.
4. **Screens + shell** (`apps/web`): session-end stat tiles with streak tick-up, topic screen (progress indicators, lock icons, pinned Review with badge, streak header), topic list glyph cards, unit screen restyle, PWA `theme_color` + icon recolor.
5. **Verification pass**: `apps/web:verify` browser walkthrough — all 10 task types through the new session UI, summary + streak display, light and dark mode, mobile viewport, `prefers-reduced-motion`, offline PWA still green (font precached).

## Done-criteria

- All 10 task types play end-to-end through the bottom action bar; no interaction regressions (Enter still submits typed input, matching still batch-grades).
- Streak: mocked-clock engine tests for increment/no-op/reset; visible on topic and session-end screens; extending it animates the flame.
- Both color modes meet AA contrast for text and verdict states; all animation off under `prefers-reduced-motion`; touch targets ≥ 44px.
- Offline-first holds: the font is precached; a fresh install replays the full walkthrough with no network.
- `pnpm check` green after every step; architecture invariant intact (no new pure domain logic in `apps/web`).

## Open questions

- **Mute toggle / sound taste**: synth tones might grate. Owner: Moe, trigger: a week of real use — then either tune, add a toggle, or swap to samples.
- **Confetti at session end**: skipped; revisit at retro if the summary feels flat.
- **App icon redraw** (actual beaver glyph vs. recolored current icon): decided in step 4 when the icon is touched. Owner: Moe.
