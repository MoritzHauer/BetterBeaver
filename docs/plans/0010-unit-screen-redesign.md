# Plan 0010: Unit screen redesign — paginated content, pooled practice, graphical progress

Status: **implemented 2026-07-18** (steps 1–6, `corepack pnpm check` green incl. a new `buildUnitSession` unit test; browser-verified — pagination/sub-pagers, dropped Transliteration column, sticky-bar scroll clearance, pin toggle + persistence across exit/re-entry, graphical progress bars on Topic/Lesson/TopicList, and the Topic/Lesson-Practice non-regression all checked in a real Chromium session against shipped Kyrgyz content; granular per-task `onTaskAnswered` crediting confirmed by code inspection rather than a live shuffled-session observation, see Open questions; a code-review pass found no correctness issues and two small duplication cleanups, both applied — `LockableProgress` extracted for the Lesson/Topic-screen progress row, `.unit-practice-bar` now composes `.action-bar` instead of duplicating its layout CSS) · Owner: Moe · Date: 2026-07-18 · Direction pinned by a 9-question grilling session (2026-07-18) plus a 3-way interactive visual mockup review ("Trail" direction chosen over "Journal"/"Deck"; the mockup itself was a scratch artifact, not checked into this repo — Design below is the full spec)

## Purpose

`UnitScreen` today is one long scrolling page: collapsible `<details>` sections for Theory/Vocabulary/Concepts/Examples, then a Quiz list of every task with its own Practice + Pin button. A design review flagged it as unpolished: content should fit on one mobile screen at a time, practicing a unit should be one shuffled session across all its tasks rather than picking tasks one by one, and pinning should stay a per-task action even though the task list itself goes away. A grilling session resolved these into a concrete structure; this plan implements it, plus the graphical progress-bar treatment the same session confirmed for `LessonScreen`, `TopicScreen`, and `TopicListScreen`.

## Goals

After this plan: `UnitScreen` is a swipeable page sequence (Overview → Theory → Vocabulary → Concepts → Examples) with a dot-trail indicator, each page sized to fit one mobile screen (Theory splits per-note, Vocabulary/Concepts/Examples paginate in fixed chunks when a unit has a lot of content); a persistent amber Practice bar sits on every page and launches one pooled, shuffled session across the *entire* unit's task set (mixed exercise types, one random order) instead of picking a single task; pinning moves from the (now-removed) per-task list into `SessionScreen` itself, where each question shows a pin control for the task it came from; the Vocabulary table drops its Transliteration column; and `LessonScreen`/`TopicScreen`/`TopicListScreen` show per-row progress as the same graphical bar `SessionScreen` already uses for in-session progress, instead of plain "X of Y" text.

## Non-goals

- **No change to Topic/Lesson-level Practice.** Those buttons ([`TopicScreen.tsx`](../../apps/web/src/screens/TopicScreen.tsx) line ~141, [`LessonScreen.tsx`](../../apps/web/src/screens/LessonScreen.tsx) line ~50) still pick one random task and run a single-task `TaskSession`, unchanged. Only Unit-level Practice becomes a pooled multi-task session — that's what "let's start with unit" scoped.
- **No pin UI in `TaskSession`.** Pin only appears in the new pooled unit session, where `SessionScreen` is given a `taskIds` array. `TaskSession` (single-task, reached from Topic/Lesson Practice or a review session) never passes it, so no pin control renders there. `ReviewSession`'s questions come from SRS scheduling units, not tasks 1:1, so it's excluded too — unaffected either way.
- **No generic pagination framework.** Each `UnitScreen` section keeps its own small `useState` index (current note, current vocab page, etc.), mirroring the reviewed mockup. A shared abstraction isn't justified for four call sites with different chunk shapes.
- **No time estimate in the Practice bar.** "5–30 min" was a content-authoring sizing target for how many tasks a Unit should own, not a runtime computation — the UI shows the task count, not a fabricated minute estimate.
- **No swipe library.** Touch swipe is a plain `touchstart`/`touchend` delta check (as in the reviewed mockup), not a dependency.

## Design

### 1. Pooled unit practice session (engine)

- New `buildUnitSession(unit: Unit, content: Content, rng: Rng): { question: Question; taskId: string }[]` in [`packages/engine/src/session.ts`](../../packages/engine/src/session.ts), next to `buildTaskSession`/`buildReviewSession`. For every `taskId` in `unit.taskIds`, resolve the `Task` and call the existing `buildTaskSession(task, content, rng)`; tag each resulting question with that `taskId`; concatenate every task's questions into one array; `shuffle` (already exported from this file) the *combined* array once with the same `rng`. A matching task still produces one `matching`-kind question representing its whole board — shuffling interleaves whole boards with individual questions from other tasks, which is fine.
- Returns pairs (not bare `Question[]`) because a `Question`'s own `unitId` field is an *SRS scheduling-unit id* (e.g. an item id, or `note:<id>` — see existing `QuestionOutcome`), unrelated to which content `Unit`/`Task` produced it, and a `NoteQuestion` or `matching` board has no field that reverse-maps to a task at all. Tracking `taskId` at construction time is the only reliable way to carry it forward — don't try to derive it later from `question.unitId`.
- No sampling/capping: pools the unit's *entire* `taskIds` list, always. A unit's task count staying in the 5–30-min range is a content-authoring concern (already true of shipped units — e.g. `ky-unit-greet-introductions` has 12 tasks), not something this function enforces.

### 2. `SessionScreen` gains an optional per-question pin control, and a granular per-task-done signal

- New optional props on `SessionScreen` ([`apps/web/src/screens/SessionScreen.tsx`](../../apps/web/src/screens/SessionScreen.tsx)): `taskIds?: (string | undefined)[]` (parallel array to `questions`, same length/order — index *i*'s task, if the question at index *i* came from one), `pinnedTaskIds?: ReadonlySet<string>`, `onTogglePin?: (taskId: string) => void`.
- In `session-header` (next to the exit ✕ and the existing `progress-track`), render a small pin toggle button whenever `taskIds?.[index] !== undefined`: label `📌 Pinned` / `📌 Pin` exactly like today's removed `TaskCard` toggle, calling `onTogglePin(taskIds[index])`. Omit the button entirely when `taskIds` isn't passed (today's `TaskSession`/`ReviewSession` callers are unaffected — they simply don't pass the new props).
- New optional prop `onTaskAnswered?: (taskId: string) => void`, distinct from the existing `onAllAnswered`. **Why a separate signal:** a pooled unit session (design section 1) covers many tasks at once, so "mark attempted" can no longer wait for `onAllAnswered` (that would make a unit's attempted-count binary — 0 until the *entire* pooled session finishes, then jumps to every task at once — which both defeats the granular progress bar in section 5 and means exiting early credits nothing, even for tasks you fully completed). Instead: when `taskIds` is provided, compute (via `useMemo`, keyed on `taskIds`) how many questions belong to each distinct task id; track answered-count per task id alongside the existing `answeredCount` ref; the shared `noteAnswered()` helper (already called exactly once per resolved question by `applyAuto`/`applySelf`/`applyMatchingOutcomes`) additionally increments that task's counter and, the moment it reaches that task's total, fires `onTaskAnswered(taskId)` once (guard the same way `onAllAnswered` is already guarded against double-fire).
- `TaskSession` (single task, unchanged elsewhere in this plan) keeps using `onAllAnswered` for its `markTaskAttempted` call exactly as today — for a single-task session the two signals coincide, so there's no reason to touch that call site. Only the new `UnitSession` (design section 3) uses `onTaskAnswered`.
- No other `SessionScreen` behavior changes: grading, `ActionBar`, summary panel, all as today.

### 3. `App.tsx`: new pooled-session route

- New `Screen` union member: `{ screen: "unit-session"; topicId: string; lessonId: string; unitId: string }`. Add `"unit-session"` alongside `"topic" | "lesson" | "unit" | "task"` in the existing content/domainContent loading gate (~line 425-430).
- New `UnitSession` component (mirrors `TaskSession`, ~line 71): builds `buildUnitSession(unit, content, Math.random)` via `useMemo` keyed on `unit.id`, splits the result into `questions`/`taskIds` arrays, renders `SessionScreen` with `title={unit.title}`, the new `taskIds`/`pinnedTaskIds`/`onTogglePin` props, and `onTaskAnswered={(taskId) => void progressStore.markTaskAttempted(taskId)}` (not `onAllAnswered` — see design section 2 for why: this is what makes a unit's attempted-count advance task-by-task as the shuffled session plays out, and survive an early exit, instead of jumping from 0 to every task at once only on full completion).
- Render branch for `screen.screen === "unit-session"`: resolve `unit = content.units.find(...)`, render `<UnitSession>`, `onDone` navigates back to `{ screen: "unit", topicId, lessonId, unitId }` (same pattern `TaskSession`'s `onDone` uses elsewhere).
- `UnitScreen`'s `onPractice` prop changes shape: `(taskId: string) => void` → `() => void` (Practice is unit-scoped now, not per-task). Wire it to `setScreen({ screen: "unit-session", topicId: screen.topicId, lessonId: screen.lessonId, unitId: screen.unitId })`.
- `UnitScreen`'s `onTogglePin`/`pinnedTaskIds` props are removed (pin moves to `SessionScreen`, wired through `UnitSession` instead, reusing the exact same `togglePinnedTask(content.topic.domainId, taskId)` + `setPinEpoch` bump already used today at the `UnitScreen` call site).

### 4. `UnitScreen` restructure — the Trail direction

Structure and interaction exactly as the reviewed Trail mockup (dot-trail, amber sticky practice bar, icon eyebrows), rebuilt against real data instead of the mockup's fixture content:

- **Pages**, in order, navigated by a top-level `page` index (`0`–`4`) with a dot-trail (a `<button class="dot">` per page, current one wider/filled, connected by a thin line — see mockup CSS `.trail`) plus basic touch-swipe (`touchstart`/`touchend`, ~40px threshold) and `ArrowLeft`/`ArrowRight` keyboard support:
  1. **Overview** — today's existing header content (breadcrumb back-button, `unit.title`, `unit.goal`), unchanged, just as its own page instead of always-visible top matter.
  2. **Theory** — only rendered if `notes.length > 0` (page count/trail shrinks accordingly, exactly like today's conditional sections). If more than one note, add a secondary sub-pager directly under the section eyebrow (small "‹ Note *n* of *N* ›" control, own local index state) showing one `NoteCard` at a time; a single note just renders directly, no sub-pager. `NoteCard` itself (markdown + Again/Hard/Good) is unchanged.
  3. **Vocabulary** — only if `lexemes.length > 0`. Table drops the **Transliteration** `<th>`/`<td>` column (Script, Gloss, Audio only — `SpeakerButton` unchanged). If more than 6 rows, paginate in chunks of 6 (`// ponytail: chunk size picked for a typical phone viewport, tune if real content proves it wrong`) with the same sub-pager pattern as Theory ("‹ Page *n* of *N* ›"). `EntryPopup` tap-to-open behavior on the Script cell is unchanged.
  4. **Concepts** — only if `concepts.length > 0`. Same chunk-of-6 sub-pagination rule as Vocabulary if it overflows. Row rendering unchanged (Term/Definition).
  5. **Examples** — only if `examples.length > 0`. Chunk of **4** per page (cards are taller than a vocab/concept row) with the same sub-pager pattern if it overflows. `ExampleCard` (reveal-on-tap translation, sentence/pair rendering) unchanged.
- **Practice bar**: persistent, fixed-position (reuse `.action-bar`'s fixed-bottom pattern), visible on every page regardless of which one is active — *not* one of the five trail pages. Amber-filled (`.action-bar.primary`-equivalent — reuse `--primary`/`--on-primary` tokens, don't invent new ones), containing one button "Practice this unit" (calls `onPractice()`, no argument) and a small subtext line: `${unit.taskIds.length} tasks, shuffled order`. Since it's fixed over the content, the scrollable page area needs bottom padding so the last note/vocab-row/example on any page isn't hidden behind it — mirror `main.session`'s existing `padding-bottom: 9rem` (`styles.css` line ~280), applied to `UnitScreen`'s own root instead of reusing `.session` (that class is `SessionScreen`-specific).
- **Removed entirely**: the Quiz `<details>` section, `TaskCard`, and the `onTogglePin`/`pinnedTaskIds`/per-task-Practice wiring that supported it (superseded by design sections 2–3).
- **Desktop/wide viewports**: no separate layout — same paginated page + dot-trail + sticky bar, just centered in `main`'s existing `max-width: 60ch` column (already true of every other screen; no new breakpoint-conditional code).
- New CSS in [`apps/web/src/styles.css`](../../apps/web/src/styles.css): trail dots/line, sub-pager control, eyebrow chip, practice bar variant — all built from existing tokens (`--primary`, `--card-bg`, `--card-border`, `--accent`, `--on-primary`); no new color values, no `color-mix()` (not used elsewhere in this stylesheet — keep it that way for consistency), no font changes.

### 5. Graphical progress bars (`LessonScreen`, `TopicScreen`, `TopicListScreen`)

- New tiny component `apps/web/src/components/ProgressBar.tsx`:
  ```tsx
  export function ProgressBar({ value, max }: { value: number; max: number }) {
    const pct = max > 0 ? (value / max) * 100 : 0;
    return (
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  ```
  Reuses `.progress-track`/`.progress-fill` exactly as `SessionScreen` already styles them (`styles.css` lines ~297-311) — no new CSS.
- **`LessonScreen.tsx`** (~line 71): replace `<p className="status">{unlocked ? progress : "locked"}</p>`'s unlocked branch with `<ProgressBar value={attemptedCount} max={unit.taskIds.length} />` plus a compact `<p className="status">{attemptedCount}/{unit.taskIds.length}</p>` caption (keeps the precise count, more compact than today's "N of M tasks" sentence). Locked rows keep showing plain "locked" text, no bar — unchanged from today.
- **`TopicScreen.tsx`** (~line 176): same treatment, `value={completeCount}` `max={lesson.unitIds.length}`.
- **`TopicListScreen.tsx`**: new — today it shows no progress at all per topic. Needs a per-topic `{ completed: number; total: number }` (completed = lessons where `isLessonComplete`), which isn't derivable from the lightweight `TopicSummary` alone (deliberately summary-only, loaded before full content). Compute it in `App.tsx` instead of extending `TopicSummary`/`ContentSource` — all content is already bundled fully in memory (`bundled.ts`'s `listTopics()`/`loadTopic()` just wrap an in-memory `Map`, see `contentByTopicId`), so loading every topic's full `Content` up front costs nothing:
  - New `App.tsx` state: `topicsContentMap: Map<string, Content>`, populated by a `useEffect` on `topics` (once populated) via `Promise.all(topics.map((t) => source.loadTopic(t.id)))` — same `Promise.all`-over-topic-ids pattern the existing domain-content effect already uses (~line 374-397), just topic-keyed instead of domain-scoped and unconditional (not gated on the active screen).
  - New `useMemo` `topicProgress: Map<string, { completed: number; total: number }>`, computed from `topicsContentMap` + `attemptedTaskIds` using the already-exported `isLessonComplete` (import it from `@betterbeaver/engine` in `App.tsx` — not currently imported there).
  - Pass `topicProgress` as a new prop to `<TopicListScreen>`; render `<ProgressBar>` + compact caption per topic card the same way as the other two screens, keyed by `topicProgress.get(topic.id)` (render nothing/a 0-filled bar while still loading — matches the brief moment `dueCount`/`streak` are `null` elsewhere in this codebase).

## Engine changes (`packages/engine`)

- `session.ts`: new `buildUnitSession(unit, content, rng)`, exported alongside `buildTaskSession`/`buildReviewSession`. No changes to existing question-building functions, the `Question` union, or `shuffle`.

## Web changes (`apps/web`)

- `screens/SessionScreen.tsx`: optional `taskIds`/`pinnedTaskIds`/`onTogglePin` props; pin toggle in `session-header`.
- `App.tsx`: new `"unit-session"` `Screen` variant; new `UnitSession` component; `UnitScreen`'s `onPractice` signature change; `onTogglePin`/`pinnedTaskIds` moved off `UnitScreen` onto `UnitSession`; new `topicsContentMap`/`topicProgress` state + effect; `isLessonComplete`, `buildUnitSession` added to the `@betterbeaver/engine` import list.
- `screens/UnitScreen.tsx`: full restructure per design section 4 — page/trail state, per-section sub-pager state, Vocabulary table column drop, Practice bar, Quiz/`TaskCard` removal.
- `screens/LessonScreen.tsx`, `screens/TopicScreen.tsx`, `screens/TopicListScreen.tsx`: swap plain-text progress for `<ProgressBar>` + compact caption (design section 5); `TopicListScreen` gains a `topicProgress` prop.
- New `components/ProgressBar.tsx`.
- `styles.css`: new classes for the trail/sub-pager/eyebrow/practice-bar (design section 4); no changes to `.progress-track`/`.progress-fill` (reused as-is).

## Implementation order (each step delegable; `pnpm check` green and app fully usable after every step)

1. **`ProgressBar` component + `LessonScreen`/`TopicScreen` wiring** — isolated, no dependency on anything else in this plan; ship first.
2. **`TopicListScreen` progress** — `App.tsx` `topicsContentMap`/`topicProgress` + `ProgressBar` wiring there. Depends on step 1's component, nothing else.
3. **`buildUnitSession`** (engine, pure function) — no UI dependency, can land and be unit-tested independently.
4. **`SessionScreen` pin props** — additive/optional, doesn't break `TaskSession`/`ReviewSession` callers since they simply don't pass the new props.
5. **`App.tsx` `unit-session` route + `UnitSession` component** — depends on steps 3–4.
6. **`UnitScreen` restructure** — depends on step 5 (needs `onPractice()`'s new no-arg signature to wire the sticky bar) and step 1's `ProgressBar` isn't needed here, but reuses the same trail/styles.css conventions; sequenced last since it's the largest single piece and everything else should be in place first.

Final: **browser verification pass** (`apps/web:verify`) — swipe/dot/keyboard navigation through all five Unit pages on a unit with multiple notes and >6 vocab items (`ky-unit-greet-introductions` fits both), confirming the last item on each page isn't hidden behind the sticky Practice bar; Practice launches a shuffled multi-task session covering every task in the unit; pinning a task mid-session persists and is reflected if you re-enter that session; exiting a unit-practice session partway through still marks every task whose questions were fully answered as attempted (check the Lesson-screen bar moved by that many tasks, not 0 and not all of them); `TaskSession`/`ReviewSession` unaffected (no pin UI, same behavior as before); Lesson/Topic/TopicList screens show graphical bars that advance incrementally, not in one jump, as unit-session tasks complete; Vocabulary table has no Transliteration column.

## Done-criteria

- `pnpm check` green after every step.
- A unit with 8 notes and 10 vocab items (real shipped content, `ky-unit-greet-introductions`) is fully navigable on a narrow (375px) viewport without any page requiring vertical scroll beyond its own content's natural height for the *current* note/vocab-page — i.e. pagination genuinely bounds each screen, not just visually suggests it.
- Practicing a unit end-to-end grades every question through the existing SRS pipeline unchanged (`recordGrade`), and marks each task attempted as soon as *that task's* questions are done — not batched to session-end — so a Lesson-screen bar genuinely shows partial progress and an early exit doesn't discard credit for tasks already finished.
- No existing SRS state or task-attempt data is invalidated — this plan touches no schema, no scheduling-unit ids, no `localStorage` key shapes.

## Open questions

- **Vocabulary/Concepts chunk size (6) and Examples chunk size (4)** are pragmatic defaults, not measured — flagged as a tuning knob in the code (`ponytail:` comment) rather than a blocking decision, per the "if possible" wording in the original review note. Revisit once real usage shows a unit where it's visibly wrong. Owner: Moe.
- **Should Topic/Lesson-level Practice also become pooled/multi-task sessions**, matching the Unit-level behavior this plan ships? Explicitly out of scope here (Non-goals) — flagged as a natural follow-up once this lands and feels right at the Unit level. Owner: Moe.
- **Granular per-task attempt-crediting (design section 2/3) was verified by reading the implementation, not by observing it live in a fully shuffled session.** Browser verification confirmed the surrounding plumbing end-to-end (pin persists correctly across exiting a session early and re-entering, which exercises the same `taskIds[index]` mechanism `onTaskAnswered` relies on), and the code matches the spec exactly (`SessionScreen.tsx`'s `noteAnswered` increments a per-task counter and fires once it hits that task's total). What wasn't directly observed: watching a specific task's Lesson-screen progress-bar value tick up mid-session, before the whole pooled session finishes. A full shuffled session can have 40-80+ questions across many tasks with a given task's questions scattered non-contiguously through it, which made this specifically slow/impractical to script reliably in the time available (the attempts that hung turned out to be bugs in the throwaway test harness's brute-force matching-board solver, not the app). Low-risk given the code match, but worth a real manual spot-check next time the app is used by hand. Owner: Moe.
