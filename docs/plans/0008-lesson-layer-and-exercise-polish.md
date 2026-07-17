# Plan 0008: Lesson layer, exercise polish, and reviewable notes

Status: **implemented 2026-07-17** (steps 1–9 + browser verification pass) · Owner: Moe · Date: 2026-07-17 · Prerequisite: plan 0006 complete (it is) · Direction pinned by grilling session 2026-07-17 (16-point design review of the shipped app)

## Purpose

Sixteen usability issues surfaced from using the shipped app. The grilling session resolved each into a concrete, buildable decision; several turned out to already work as intended (documented in the review-only section below) and did not need code changes. What's left splits into five independent areas: a new content layer for daily-sized study chunks, several exercise-screen behavior changes, a matching-exercise redesign, notes becoming reviewable flashcards, and one CSS fix. Sequenced as independently shippable steps — the app is fully working after each one.

## Context

- Today's content hierarchy is `Topic → Unit → (Task/Note/Item)`, flat two levels below Topic. `ky-unit-greetings` alone owns 19 tasks, 15 notes, and 15 unit-owned sentence items (plus 84 referenced lexicon entries) — too large to work through in one sitting, and with no way to subdivide it.
- The grilling session settled the hierarchy direction as `Topic → Lesson → Unit → content`, where **today's `Unit` entity is renamed `Lesson`** (e.g. "Greetings") and a **new, smaller `Unit` entity is inserted below it** for daily-sized chunks (e.g. "Choosing the right greeting", "Introducing yourself"), owning the `taskIds`/`noteIds`/`itemIds` currently flat on the Lesson. This is a genuine schema migration, not a relabeling: `Lesson` keeps the existing unlock-chain and progress-rollup role at its level (`isUnitUnlocked`/`isUnitComplete` in `packages/engine/src/progress.ts` become `isLessonUnlocked`/`isLessonComplete`, evaluated over the Lesson's Units), and the new `Unit` becomes the actual practice/unlock boundary (a Lesson is complete when all its Units are complete).
- `packages/schema/src/entities.ts` `unitSchema` (line 71) is the entity being renamed; its `taskIds`/`noteIds`/`itemIds`/`unlocksAfterUnitId` fields move to the new `unitSchema` unchanged in shape, chained the same way one level down.
- `packages/engine/src/units.ts` `schedulingUnits(content: Content)` and `packages/engine/src/progress.ts` are keyed off `Content`, not off the unit hierarchy directly — SRS scheduling is unaffected by the layer insertion; only unlock/progress and Practice-button scoping change.
- Several review points turned out, on inspection of the code, to already work as described or to be content-authoring guidance rather than code changes — see "Confirmed as-is / content-only" below. No code changes ship for those; they're recorded here so the review isn't silently dropped.
- Point 8 (interaction-time slowness on desktop Firefox) has no resolution yet — pending the user's Android test; tracked as an open question, not a work item, in this plan.

## Goals

After this plan: a Topic's Lessons subdivide into Units small enough for a daily session, each with its own Practice button and unlock gate (skippable via confirmation); Lesson- and Topic-level Practice shuffles across their opened children; Examples hide the Kyrgyz translation until tapped; the Vocabulary screen gets a dynamic matching mode that samples 5 random pairs from the learner's saved words on every Practice press (authored in-Lesson matching tasks are unaffected, just capped at 5 pairs going forward); cloze tasks get an English-word hint button and build tasks hide their English prompt behind a hint button instead of always showing it; grammar notes are self-gradeable flashcards (Good/Hard/Again) that enter the same per-domain review queue as words; a task can be pinned into the personal review queue with priority; the vocabulary row CSS keeps multi-line word entries left-aligned.

## Non-goals

- **No runtime matching generation for authored Lesson/Unit matching tasks** — those stay hand-authored content, only their pair cap changes (8 → 5). Only the Vocabulary screen's new mode is dynamic.
- **No morphological analyzer** — point 6 (кайнэне → кайн + эне) ships as an optional hand-authored `components` field on lexicon entries, populated opportunistically. General suffix-stripping/inflection analysis is out of scope.
- **No user-editable lexicon annotations** — point 6's decomposition field is author-only in this plan; making it learner-editable is gated on a sync/account system that doesn't exist yet (tracked in plan 0006's open questions, not restated here).
- **No new SRS math** — notes-as-flashcards and prioritized task pins both reuse the existing `SelfGrade`/pass-fail grading and SM-2 scheduling as-is (`packages/srs/src/sm2.ts`); nothing about scheduling itself changes.
- **No performance fix** — point 8 is recorded as an open question pending the user's Android test, not scoped as work here.
- **No lexicon-gap content backlog as a "step"** — points 4 and 5 (missing lexicon entries, a pronouns unit) are ongoing content-authoring work, flagged as gaps are found; not a discrete deliverable with done-criteria.

## Confirmed as-is / content-only (no code change)

Resolved during grilling by reading the code; recorded so the original review points aren't mistaken for still-open:

- **Point 3** *(examples hide translation until tapped)* — **is** a real code change, see Design below; listed here only to note it was verified as currently always-visible (`UnitScreen.tsx` `ExampleCard`, line ~29) before being scoped.
- **Point 4** (clickable-word wrapping) — notes intentionally wrap whole marked phrases as one tappable unit (`NoteView.tsx` `InlineRun`), not word-by-word, so multi-word entries resolve correctly; this is deliberate, not a bug. Examples already wrap word-by-word. Lookup already searches the full domain lexicon (`resolveToken` against the merged pool), not just the current unit. The real gap is missing lexicon entries — an ongoing content backlog, not a wrapping/search change.
- **Point 11** (cloze blank choice) — blanks are already 100% author-chosen via `{{c1::word}}` markup (`session.ts` cloze case); "don't blank names, prefer new concepts" is a guideline to apply when authoring/reviewing cloze sentences, not an algorithm to build.

## Design

### 1. Lesson layer (points 1, 2, 16)

- Rename `unitSchema` → `lessonSchema` (same shape: `id`, `topicId`, `title`, `goal`, `unitIds` (was `itemIds`/`taskIds`/`noteIds` directly — now a list of child Unit ids instead), `unlocksAfterLessonId` (was `unlocksAfterUnitId`)).
- New `unitSchema`: `{ id, lessonId, title, goal, itemIds, taskIds, noteIds, unlocksAfterUnitId? }` — this is exactly today's `unitSchema` shape, re-parented under `lessonId` instead of `topicId`.
- `topicSchema.unitIds` → `topicSchema.lessonIds`.
- Content migration: `content/kyrgyz/units/ky-unit-greetings.json` → `content/kyrgyz/lessons/ky-lesson-greetings.json` (id `ky-lesson-greetings`), and its flat `itemIds`/`taskIds`/`noteIds` get manually partitioned into 2–4 new `content/kyrgyz/units/ky-unit-greetings-*.json` files (e.g. "choosing-a-greeting", "introducing-yourself", "asking-how-someone-is") — a content-authoring pass, not mechanical, since task/note/item groupings must make pedagogical sense. Applies to all existing units across `kyrgyz` and `demo` topics.
- `packages/engine/src/progress.ts`: `isUnitUnlocked`/`isUnitComplete` keep their exact logic, renamed and re-typed to operate on the new `Unit` (the practice/unlock boundary moves down, logic doesn't change). New `isLessonComplete(lesson, units, attemptedTaskIds)` = every child Unit complete; `isLessonUnlocked` mirrors today's `isUnitUnlocked` gating logic one level up.
- `packages/schema/src/validate.ts`: ownership/orphan classes (currently class (d)/(f) reference `unitId`/`unit.itemIds` etc.) extend one level — a Unit's `taskIds`/`noteIds`/`itemIds` must resolve same as today; a Lesson's `unitIds` must resolve to Units whose `lessonId` matches; a Topic's `lessonIds` must resolve to Lessons whose `topicId` matches.
- Web: `TopicScreen` renders Lessons (locked/unlocked, progress = units complete / units total) instead of Units directly; new `LessonScreen` (structurally identical to today's `TopicScreen`-rendering-units logic) renders a Lesson's Units; `UnitScreen` is unchanged (still the task/note/example list + Practice buttons). Practice-button shuffle scope: Unit Practice picks randomly from that Unit's own tasks (as today); Lesson Practice shuffles across all tasks in the Lesson's *opened* (unlocked) Units; Topic Practice shuffles across all tasks in the Topic's opened Lessons.

### 2. Skip-ahead confirmation (point 15)

- `TopicScreen`/`LessonScreen`: a locked Lesson/Unit renders as a clickable element (not the current non-interactive `<div>`, `TopicScreen.tsx` lines 108-114) with a 🔒 indicator; tapping opens a confirm dialog ("Are you sure you want to skip the previous lesson?" / "...unit?"); confirming navigates in as if unlocked. This is a deliberate policy change — skipping ahead becomes possible, not hard-blocked.

### 3. Examples reveal-on-tap (point 3)

- `UnitScreen.tsx` `ExampleCard`: the Kyrgyz `TappableText` line renders as today; the English `<strong>{item.payload.translation}</strong>` line is hidden by default behind a "Show translation" tap target, revealed in place on tap (same interaction shape as the existing tap-to-lookup surfaces — no new component pattern, just a local reveal boolean per card).

### 4. Matching exercise (points 9, 10)

- `packages/schema/src/validate.ts` class (p): pair-count bound changes from `2..8` to `2..5` for all matching tasks (both existing content and newly authored). Existing 8-pair Kyrgyz matching tasks (`ky-task-matching-*`) get split into multiple smaller authored tasks during the same content pass as the Lesson/Unit migration.
- New: Vocabulary screen (`apps/web/src/screens/VocabularyScreen.tsx`) gets a "Practice matching" action alongside its existing ad-hoc modes, using `buildAdhocSession`'s existing `matching` mode (already takes a plain `Item[]`, per plan 0006 context) fed 5 items randomly sampled from the learner's current saved-words pool for that domain, resampled fresh every time the action is pressed — no schema or validator change, this reuses the existing ad-hoc session builder exactly as the other Vocabulary study modes do.

### 5. Cloze and build hints (points 12, 13)

- Cloze (`SessionScreen.tsx` `TypedInput`, lines ~254-314): add a "Hint" button that reveals the target English word for the current blank (available from the scheduling unit's source item, already resolved in-session) without submitting an answer. Purely additive; existing always-shown post-answer reveal is unchanged.
- Build (`SessionScreen.tsx` `renderInteraction`, `case "build"`, lines ~638-649): behavior change — `question.prompt` (the English translation) is no longer rendered up-front. It's hidden behind a "Hint" button the learner taps to reveal, matching the cloze hint's interaction shape. `scramble` (which shares `ScrambleInteraction`) is unaffected — only the `build` prompt-rendering branch changes.

### 6. Notes as flashcards (point 7, notes half)

- Notes gain review-eligibility: each `Note` becomes one scheduling unit (parallel to today's item-based scheduling units in `packages/engine/src/units.ts` — `schedulingUnits` grows a note-derived unit per note referenced by a Unit, id `note:<noteId>` to avoid colliding with the `<itemId>::c<n>` cloze-blank convention).
- Review UI for a note-derived scheduling unit: render the note's markdown (`NoteView`, already exists), then Good/Hard/Again buttons using the existing `SelfGrade` → `recallQuality` → `schedule` pipeline (`packages/srs/src/sm2.ts`, unchanged) — identical mechanism to today's recall-task self-grading, just triggered from a note body instead of a recall-task prompt.
- A note enters the review queue the same way an item does: first grading schedules it (no separate "save this note" step needed beyond what saving already means for items — reviewing *is* the entry point here, since a note has no separate "study it once" action the way a word does).

### 7. Prioritized task pin (point 7, task half)

- Existing per-domain review queue (`dueDomainUnits`, `reviewQueue` in `packages/engine/src/progress.ts`) already sorts by due-ascending. Add a "pin" concept: a small `bb.pinned.<domainId>` localStorage set of task ids (mirrors `VocabListStore`'s storage pattern), and `reviewQueue`/`dueDomainUnits` sort pinned tasks' scheduling units first, ahead of due-ascending order, when building the session. Grading a pinned task uses its existing pass/fail → `recognizeQuality`/`recallQuality` path unchanged; the pin itself doesn't affect scheduling math, only queue ordering. A task screen gains a pin/unpin toggle next to its existing Practice button.

### 8. Lexicon decomposition field (point 6)

- `lexemePayloadSchema` (`packages/schema/src/entities.ts`) gains an optional `components?: { script: string; gloss: string }[]` field — e.g. `кайнэне` → `[{script: "кайн", gloss: "in-law"}, {script: "эне", gloss: "mother"}]`. Populated by hand, opportunistically, starting with compounds already flagged as confusing. `EntryPopup` renders it as a tappable breakdown row when present (each component optionally itself resolves via the existing `resolveToken` lookup if it happens to match another entry — best-effort, not guaranteed).

### 9. Vocabulary row alignment (point 14)

- `apps/web/src/styles.css` `.word-row` (line ~513): `align-items: center` → `align-items: flex-start`, so a wrapped multi-line `.word-text` no longer centers the speaker button against the full wrapped block. One-line CSS change.

## Schema changes (`packages/schema`)

- `unitSchema` renamed `lessonSchema`: `unitIds` (was direct content refs) → child-Unit id list, `unlocksAfterUnitId` → `unlocksAfterLessonId`.
- New `unitSchema`: `{ id, lessonId, title, goal, itemIds, taskIds, noteIds, unlocksAfterUnitId? }` (today's `unitSchema` shape, re-parented).
- `topicSchema.unitIds` → `topicSchema.lessonIds`.
- `lexemePayloadSchema` gains optional `components?: { script, gloss }[]`.
- `validateContent`: ownership/orphan and reference-resolution classes extend one level (Lesson → Unit → content, each level's child-id list must resolve and each child's parent-id must match); matching pair-count bound `2..8` → `2..5`.

## Engine changes (`packages/engine`)

- `progress.ts`: `isUnitUnlocked`/`isUnitComplete` retargeted to the new `Unit`/`unlocksAfterUnitId`; new `isLessonUnlocked`/`isLessonComplete` operating over a Lesson's Units.
- `units.ts` `schedulingUnits`: grows a note-derived scheduling unit (`note:<noteId>`) per note referenced by a Unit, alongside existing item/cloze-blank units.
- New pinned-task ordering in `reviewQueue`/`dueDomainUnits`: pinned scheduling units sort first, ahead of due-ascending.
- No changes to `packages/srs` — `SelfGrade`, `recallQuality`, `recognizeQuality`, `schedule` are reused as-is for both note-flashcards and pinned-task grading.

## Web changes (`apps/web`)

- Content migration: `content/*/units/*.json` → `content/*/lessons/*.json` (renamed, re-shaped); new `content/*/units/*.json` files created by manually partitioning each former unit's flat content.
- `bundled.ts`: globs updated for the renamed/new content directories.
- New `LessonScreen` (Topic → Lesson → Unit navigation level); `TopicScreen` renders Lessons; `UnitScreen` unchanged internally.
- `TopicScreen`/`LessonScreen`: locked-item click handler + confirm dialog (point 15).
- `UnitScreen.tsx` `ExampleCard`: reveal-on-tap translation.
- `VocabularyScreen.tsx`: new dynamic matching-practice action.
- `SessionScreen.tsx`: cloze hint button; build prompt hidden behind hint button; note-flashcard review rendering (markdown + Good/Hard/Again).
- New pin/unpin toggle on the task screen; `bb.pinned.<domainId>` localStorage store (same pattern as `progress/vocab-lists.ts`).
- `EntryPopup.tsx`: renders `components` breakdown row when present.
- `styles.css`: `.word-row` alignment fix.

## Implementation order (each step delegable; `pnpm check` green and app fully usable after every step)

1. **Vocabulary row CSS fix** (point 14) — trivial, ship first.
2. **Examples reveal-on-tap** (point 3) — isolated to `ExampleCard`.
3. **Cloze + build hints** (points 12, 13) — isolated to `SessionScreen.tsx` interaction renderers.
4. **Matching redesign** (points 9, 10) — validator bound change + content split + Vocabulary dynamic-matching action.
5. **Lexicon decomposition field** (point 6) — schema field + popup rendering; hand-annotate a handful of entries as the seed set.
6. **Pinned tasks** (point 7, task half) — pin store + queue ordering + UI toggle.
7. **Notes as flashcards** (point 7, note half) — scheduling-unit extension + review UI; depends on nothing above but is the largest single piece, sequenced after the smaller wins land.
8. **Lesson layer** (points 1, 2, 16) — schema rename/insert, validator extension, engine retarget, `LessonScreen`, full content migration (rename + manual partition of every existing unit) — the largest step, sequenced last since every other step is independent of it and it benefits from the app otherwise being in its final shape before a big content pass.
9. **Skip-ahead confirmation** (point 15) — depends on step 8 (needs the Lesson/Unit screens to exist) and on the migrated content it applies to.

Final: **browser verification pass** — split-Lesson navigation (Topic → Lesson → Unit → tasks) with correct unlock/complete rollup at both levels; skip-ahead confirm dialog at both levels; an Example card's translation stays hidden until tapped; cloze hint reveals the English word without submitting; build task hides the English prompt until hint is tapped; Vocabulary's dynamic matching samples a fresh 5 pairs each press; an authored matching task caps at 5; a note flashcard reviews via Good/Hard/Again and reappears in the domain review queue on its due date; a pinned task surfaces first in review; a lexicon entry with `components` shows its breakdown in the popup.

## Done-criteria

- `pnpm check` green after every step.
- Every existing Kyrgyz/demo unit is migrated to a Lesson with 2+ child Units, no orphaned tasks/notes/items, unlock chains preserved in spirit (first Unit of first Lesson always unlocked; subsequent gates chain as before).
- No existing SRS state (`bb.item.<id>` keys) is invalidated by the Lesson/Unit migration — ids of tasks/notes/items are unchanged, only their parent references move.
- A note's review grading persists and reschedules exactly like an item's (same `bb.item.<schedulingUnitId>`-shaped storage key, just keyed on `note:<noteId>`).

## Open questions

- **Point 8 (interaction-time performance on desktop Firefox)**: not scoped as work in this plan. Pending the user's Android test to determine whether it's platform-specific; if it reproduces broadly, likely next step is auditing `VocabularyScreen`/`UnitScreen` list rendering for virtualization, not a loading/PWA change (everything is already eager-loaded via `import.meta.glob`, per plan 0006's `bundled.ts`, which affects startup cost, not interaction cost). Owner: Moe.
- **Points 4, 5 (lexicon gaps, pronouns unit)**: ongoing content-authoring backlog, not tracked as a step here. A pronouns Unit (with мен, ал, сиздер added as standalone lexicon entries alongside the existing сен/сиз/биз/силер/алар/булар) is a natural first candidate once the Lesson/Unit migration lands, since it needs a home in the new structure. Owner: Moe.
- **Note-flashcard granularity**: this plan schedules one flashcard per whole Note. If a note covers multiple distinct facts (as the pronoun-table note likely will), one review card per note may be too coarse — revisit after step 7 ships with real content, possibly splitting a note into multiple flashcard-eligible sections. Owner: Moe.
