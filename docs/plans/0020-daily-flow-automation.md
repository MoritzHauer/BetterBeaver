# Plan 0020: Daily-flow automation (Play button, next unit, lesson summary)

Status: **designed** · Owner: Moe · Date: 2026-07-28 · Direction pinned by a 10-question grilling session (2026-07-28)

## Purpose

Starting a study session costs three taps down a tree the learner already knows the shape of: My Books → Book → Lesson → Unit → Practice. Every one of those taps is a navigation decision the app could have made itself, because the answer is almost always the same: repeat what's due, then continue where you left off.

This plan adds a single **Play** affordance that makes that decision, and closes the two dead ends the study loop currently has — a finished unit session drops the learner back on the unit screen with no forward motion, and finishing a lesson is entirely unmarked.

It is deliberately a **navigation** plan. No scheduling logic changes, no new persisted state, no new content fields, no schema bump.

## Goals

After this plan:

- A **▶ Play** affordance on the My Books card and as the top card of BookScreen resolves what to study and goes there: **due > 0 → Daily Review, otherwise the next unit's UnitScreen**.
- Finishing a unit-practice session offers **▶ Next unit** on the session-stats panel, instead of only `Done`.
- Finishing the last unit of a lesson offers **▶ Lesson complete**, which opens a new **lesson summary screen** — derived stat tiles plus **▶ Next lesson**.
- Finishing the last unit of the *Book* shows the **trophy** state instead of a next-step button, on both the Play card and the lesson summary.
- The learner can stop at every point: every continue button has a visible exit beside it, and nothing auto-advances.

## Non-goals

- **No settings.** The owner explicitly reversed the original request's "in settings the user can configure default behavior" after reviewing the option space (grilling answer 8). There is no daily-flow settings section, no `bb.playmode` key, no auto-continue toggle. Add one when a default actually annoys someone.
- **No stored "first tap today" state.** See design §1 — the due queue already encodes it.
- **No per-lesson statistics storage.** The lesson summary is derived from keys that already exist. Adding a persisted per-lesson accuracy counter was offered and declined; it would need a migration and an export/import field, and would duplicate a truth the app already derives.
- **No auto-advance.** Every step is a tap. This matches every other gate in the app (skip-ahead confirm, opt-in content updates, explicit Add) and is what "the user can stop at every point" requires.
- **None of the `ToDo.md` "configurable learning setting" cluster** — tasks per unit, review-queue size, 75 %-accuracy gating. Different feature, still unscoped.
- **No recommendation engine.** "Next" is reading order, not a model of what the learner needs. Same boundary plan 0016 drew.

## Design

### 1. The resolver: one function, three call sites

New pure function in `packages/engine/src/progress.ts`, exported through the existing barrel:

```ts
/** The unit the learner should continue with: the first unit, in reading
 * order, that isn't complete. Reading order is `topic.lessonIds` then each
 * `lesson.unitIds` — the same order BookScreen and LessonScreen render.
 * `null` when every unit of the Book is complete. */
export function nextUnit(
  content: Content,
  attemptedTaskIds: ReadonlySet<string>,
): { lessonId: string; unitId: string } | null;
```

Serves all three "where next" questions:

| Call site                            | Question                     |
| ------------------------------------ | ---------------------------- |
| Play (My Books chip, BookScreen card) | "Where do I resume?"         |
| Session stats `▶ Next unit`          | "What comes after this unit?" |
| Lesson summary `▶ Next lesson`       | "What comes after this lesson?" |

The third falls out for free: once a lesson is complete, its units are all complete, so the first incomplete unit is necessarily in a different lesson. No separate `nextLesson` function.

**Why first-incomplete rather than positional-next.** Play has no "just finished" unit to be relative to, so it needs the first-incomplete rule regardless; making the session-stats button use the same rule means one function instead of two, and it resumes a half-finished unit rather than skipping past it.

**Locks.** The resolver does not consult `isUnitUnlocked` / `isLessonUnlocked`. It doesn't need to: it navigates straight to `UnitScreen`, which has no lock gate of its own — the skip-ahead confirm lives on the LessonScreen and BookScreen *cards*, which Play bypasses. Separately, for all authored content (gates point backwards) the first incomplete unit is unlocked by construction, since every earlier unit is complete.

### 2. Play behavior — derived, not stored

```
Play tapped
  ├─ due > 0            → Daily Review session   (screen: "review", domainId)
  ├─ due == 0, next ≠ ∅ → next unit's UnitScreen (screen: "unit", …)
  └─ due == 0, next = ∅ → trophy state, no navigation
```

**Why no stored per-day flag.** The request is "first tap of the day repeats previous units, later taps bring a new unit". Due dates are day-granular UTC (design.md, plan 0001), so nothing becomes due part-way through a day: finishing today's review empties the queue, and every subsequent tap therefore lands on a unit. The due queue *is* the flag, with no scope question (per-Book vs per-domain), no "did an abandoned review burn the day" edge case, and no key to migrate or export. Abandoning a review mid-way leaves items due, so the next tap correctly resumes it.

Due count comes from `dueUnits(content, store, now)` — Book-scoped, the same call `BookScreen` already makes for its Daily Review badge. Note the pre-existing asymmetry this inherits: the count is Book-scoped while the review session it opens is domain-scoped (`dueDomainUnits`).

**Do not fix that asymmetry in this plan.** Concretely, with two added Books sharing one domain: Play on Book A can read "0 due" and still route to a review holding Book B's items, or read "5 due" and open a review that drains both. That is exactly what the Daily Review card does today. Play only makes it more *visible*, by being the default path. Aligning the two scopes is a separate decision (which count is right for a multi-Book domain?) and is out of scope here.

### 3. Surfaces

**My Books card** (`MyBooksScreen.tsx`) — a third icon chip beside Vocabulary (📖) and Daily Review (↺), using `art/icons/play.png`, `aria-label="Continue"`. It shows **no live state**: resolving a due count for every added Book on the home screen means a `dueUnits` sweep per Book (hundreds of `localStorage` reads each) on the one screen plan 0013 already flagged for jank. It resolves on tap instead.

Consequence, accepted: the chip can't know there is nothing to do, so it never disables. Nothing to do → it opens BookScreen, which shows the trophy state. The chip joins the existing `.book-actions` row, which already sizes itself off `--book-chip-row` — a third chip must not reopen the alignment bug fixed 2026-07-26.

**It did reopen a related one, and here is the fix (2026-07-28).** The 2026-07-26 pass reserved the chip cluster's _height_ but never its _width_, so a long title ran underneath the chips — a pre-existing collision that only bit below ~356px. The third chip widened the cluster to a measured 153.5px and pushed the threshold out to ~400px, i.e. into the 360/375/390 mainstream band (23.7px of occlusion at 375px). `.book-title-row` now reserves the cluster's width too, via a new `--book-chip-zone` token (9.5rem, taken from the measured box — nothing computes the width of an absolutely positioned element, and a first attempt derived from nominal chip sizes was 30px short and inert), and `.book-title-row > strong` gets `min-width: 0; overflow-wrap: anywhere` so one long word can break instead of overflowing the reserved zone at 320px. **Accepted trade: a long title now wraps to two lines on narrow phones where it previously fit on one.** Occlusion is the worse failure. Verified clear at 320/360/375/390/412/420px, with the 2026-07-26 vertical guard still measuring 0.00px and no horizontal document overflow.

**BookScreen** (`BookScreen.tsx`) — a new primary card above Daily Review, showing live state because `dueCount` is already loaded there:

| Condition                | Icon         | Title      | Subtitle                |
| ------------------------ | ------------ | ---------- | ----------------------- |
| due > 0                  | `play.png`   | Continue   | `{n} due for review`    |
| due == 0, next ≠ ∅       | `play.png`   | Continue   | the next unit's title   |
| due == 0, next = ∅       | `trophy.png` | Book complete | `Nothing left to study` — card disabled |
| due still loading (`null`) | `play.png` | Continue   | `Loading…`, disabled    |

Daily Review, Practice and Vocabulary cards all stay. Daily Review is the explicit way to review when Play has moved on to a unit; Practice (random task across opened lessons) has no other Book-level entry point. Nothing that works today is removed.

### 4. Session stats → next step

`SessionScreen`'s `SummaryPanel` currently renders one hardcoded `Done` button. It gains an optional `nextAction?: { label: string; onClick: () => void }`; when present it renders as the primary button with `play.png`, and `Done` demotes to a plain button beside it. When absent — the existing behavior — `Done` stays primary and alone.

**`autoFocus` moves with primacy.** It sits on `Done` today. When `nextAction` is present it must move to the new primary button, or Enter lands on the exit instead of continue — inverting the default this whole plan exists to set.

**Only the unit-practice session passes it.** `UnitSession` is the only session type with lesson/unit context; `ReviewSession`, `AdhocSession`, `RecallSession` and `TaskSession` keep a bare `Done`. `TaskSession` is excluded deliberately even though it *has* the context: it runs one random shuffled task, so "next unit" is not what follows it.

Wiring lives in `App.tsx`'s `unit-session` branch, which already holds `content`, `attemptedTaskIds` and the screen's `lessonId`/`unitId`:

```
unit session finishes
  └─ recompute completion from the fresh attempted set
       ├─ owning lesson now complete → [▶ Lesson complete] → screen: "lesson-summary"
       └─ otherwise                  → [▶ Next unit]       → screen: "unit" (nextUnit())
```

**Two branches, and they are total.** `nextUnit()` returns `null` only when every unit of the Book is complete, which makes the owning lesson complete too — so the second branch can never face a null target: an incomplete lesson contains, by definition, an incomplete unit, and `nextUnit()` finds that one or an earlier one. The Book-finished case is therefore handled entirely by branch 1, and the trophy lives on the lesson summary (§5), not here. (The one lesson `isLessonComplete` calls complete without any real unit — every `unitId` dangling — cannot be reached from a unit session at all, because there is no unit to have just finished.)

**Amended during implementation (2026-07-28): one guard, not a third branch.** The button's *label* has to be chosen synchronously, before the async read resolves, so it is computed optimistically from `attemptedTaskIds ∪ unit.taskIds`. That prediction and the fresh read can disagree — a task that yields zero questions never fires `onTaskAnswered`, and a `markTaskAttempted` write is swallowed by design under blocked storage (spec 0019). The button then reads "Lesson complete" while the fresh read says otherwise, and `nextUnit()` returns the unit the learner just finished, so the tap would land right back where it started with no explanation. When `next` is `null` **or** equals the just-finished unit, navigation goes to the **lesson screen** instead — the honest destination, since it shows which unit is still open. This is a dead-end guard on the second branch, not a third outcome.

**Resolve against the post-session attempted set — this is a real race, so the mechanism is pinned, not just the requirement.** The session's own `markTaskAttempted` calls are exactly what make the lesson complete, so the `attemptedTaskIds` React state captured at render is stale by one session. `reloadAttemptedTaskIds()` is fire-and-forget (`void …then(setAttemptedTaskIds)`) and **cannot be awaited**. The unit-session `onFinished` must therefore read the store itself:

```ts
const onFinished = async () => {
  const ids = new Set(await progressStore.getAttemptedTaskIds());
  setAttemptedTaskIds(ids);                     // replaces reloadAttemptedTaskIds()
  // decide the next action from `ids`, never from the `attemptedTaskIds` state
};
```

One read, no ordering assumption, no `setTimeout`, no effect that reads stale state on its first commit.

**Why not watch `isLessonComplete` globally.** It is derived and flips on any task attempt, including one cleared from a Daily Review queue — a global watcher would interrupt an unrelated review with a celebration screen, and would need a persisted "already celebrated" set to avoid re-firing. Chaining off the unit session is deterministic and needs neither.

### 5. Lesson summary screen

New `screen: "lesson-summary"; bookId; lessonId` variant and `apps/web/src/screens/LessonSummaryScreen.tsx`. Reuses `SummaryPanel`'s existing `.stat-tiles` / `.summary-icon` CSS — no new component library, no new tokens.

Tiles, **all derived from keys that already exist**:

| Tile             | Source                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| Units            | `lesson.unitIds.length` (all complete by construction)                    |
| Questions        | `countUnitQuestions(unit, content)` summed over the lesson's units        |
| In review        | count of the lesson's scheduling units with SM-2 state (`store.getItemState`) |
| Next review      | earliest `due` among those states, rendered as today/tomorrow/a date       |
| Streak           | `store.getStreak(domainId)` — same call `SummaryPanel` makes              |

Actions:

- `nextUnit() ≠ null` → `[▶ Next lesson]` (primary, `play.png`) + `[Back to Book]`
- `nextUnit() === null` → `trophy.png`, "Book complete!", `[Back to Book]` only

**Button labels are generic** — "Next unit", "Next lesson" — not the target's title (owner call, 2026-07-28). One consequence, accepted: after a skip-ahead, `nextUnit()` can point *backwards* (finish Lesson 3 while Lesson 1 is still incomplete), so "Next lesson" names a direction the learner didn't literally travel. It still goes where they should go.

### 6. Stopping

Nothing auto-advances and every summary offers an exit:

| Screen               | Continue           | Exit            |
| -------------------- | ------------------ | --------------- |
| Session stats        | `▶ Next unit` / `▶ Lesson complete` | `Done` |
| Lesson summary       | `▶ Next lesson`    | `Back to Book`  |
| Play (nothing to do) | —                  | (trophy state)  |

Both new screens register a `backActionRef` handler, matching the hardware-back contract pinned by the 2026-07-26 fix.

### 7. Icons

`art/icons/play.png` and `art/icons/trophy.png` both exist. No new artwork.

## Steps

1. **Engine** — `nextUnit()` in `progress.ts` + unit tests (reading order, half-done unit resumes, cross-lesson boundary, skip-ahead backwards pointer, all-complete → `null`).
2. **Play entry points** — BookScreen card (live state, trophy state), My Books ▶ chip, `App.tsx` resolution and navigation.
3. **Next unit / lesson summary** — `SummaryPanel.nextAction`, `App.tsx`'s `unit-session` `onFinished` chaining, `LessonSummaryScreen`, the `lesson-summary` screen variant and back-nav.

Steps 2 and 3 both edit `App.tsx` and must land in order, not in parallel.

## Verification

`corepack pnpm check` green, then a real-browser pass (`apps/web:verify`):

1. Fresh Book, nothing due → My Books ▶ chip opens the first unit's UnitScreen.
2. Grade something to schedule it, wait until due → ▶ opens Daily Review; finish it; ▶ now opens a unit.
3. Abandon a review mid-way → ▶ resumes the review.
4. Finish a unit session that is not the lesson's last → stats show `▶ Next unit` + `Done`; the button lands on the following unit.
5. Finish the last unit of a lesson → `▶ Lesson complete` → lesson summary with real tile numbers → `▶ Next lesson` lands in the next lesson's first unit.
6. Complete every unit of a Book → BookScreen Play card shows the trophy state, disabled; lesson summary shows "Book complete!" with no next button.
7. Hardware back from both new states returns one level, never to a blank page.
8. My Books chip row stays aligned with the title row with three chips (the `--book-chip-row` regression).
