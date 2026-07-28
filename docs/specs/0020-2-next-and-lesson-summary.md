# Spec 0020-2: "Next unit" on session stats + lesson summary screen

Design record: [plan 0020](../plans/0020-daily-flow-automation.md) §4–6. **Do not reopen its decisions** — they came out of a 10-question owner grilling. Implement as written.

This is slice 2 of 2. **Slice 1 (`0020-1-play-button.md`) must already be landed** — this spec calls the `nextUnit()` it adds.

## Goal

Finishing a unit-practice session offers a forward step instead of only `Done`: `▶ Next unit`, or `▶ Lesson complete` → a lesson summary screen with `▶ Next lesson`. The Book's final lesson shows a trophy instead. The learner can stop at every point.

## Required reading

`App.tsx` is 1609 lines and `SessionScreen.tsx` is 1205 — both over the delegation reading budget (design.md, delegation policy). **Read only these regions:**

| File                                     | Region                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/progress.ts`        | `nextUnit` (added by slice 1) and `isLessonComplete`                                                                                                                                                                   |
| `apps/web/src/screens/SessionScreen.tsx` | lines 840–930 (`SummaryPanel`), 950–1000 (`SessionScreen` props), plus the `ActionBar` component definition — grep for it                                                                                              |
| `apps/web/src/App.tsx`                   | lines 67–127 (`Screen` union), 245–327 (`UnitSession`), 863–874 (`reloadAttemptedTaskIds`, `goToBook`), 1143–1169 (a settings/stats branch, as the pattern for a new simple screen), 1443–1479 (`unit-session` branch) |
| `apps/web/src/screens/StatsScreen.tsx`   | whole file (228 lines) — the closest existing "simple back-button screen over derived on-device state" to copy                                                                                                         |
| `apps/web/src/styles.css`                | lines 700–740 (`.summary-icon`, `.stat-tiles`)                                                                                                                                                                         |
| `apps/web/src/stats.ts`                  | whole file (87 lines) — how derived stats are gathered from existing keys                                                                                                                                              |

`countUnitQuestions` is exported from `packages/engine/src/session.ts`; `UnitScreen.tsx` already uses it. Assets `art/icons/play.png` and `art/icons/trophy.png` exist.

## 1. `SummaryPanel` gains an optional next action

`SessionScreen.tsx` (~line 843). New optional prop threaded from `SessionScreen`'s own props down to `SummaryPanel`:

```ts
/** Plan 0020 §4: an optional forward step shown as the summary's primary
 * button. Only the pooled unit-practice session passes this — every other
 * session type (review, ad-hoc, recall, single-task) keeps a bare `Done`,
 * because "next unit" is not what follows them. */
nextAction?: { label: string; onClick: () => void };
```

Rendering inside the existing `<ActionBar>` (~line 919):

- **Absent** (today's behavior, unchanged): one `Done` button, `className="primary"`, `autoFocus`.
- **Present**: `nextAction` renders first as `className="primary"` with `autoFocus` and a `play.png` `<img className="icon-glyph">` before its label; `Done` follows as `className="plain"`.

**`autoFocus` moves with primacy.** It is on `Done` today. If it stays there while `Done` is demoted, Enter lands on the exit instead of continue — inverting the default this feature exists to set. Exactly one button carries `autoFocus`.

Do not change `SummaryPanel`'s tiles, the fanfare, or the streak.

## 2. `App.tsx` — chaining off the unit session

### 2a. New screen variant

Add to the `Screen` union (~line 127), with a comment in the file's established style:

```ts
// Lesson summary (plan 0020 §5): shown after the unit session that
// completed the lesson. Derived tiles only — nothing is persisted for it.
| { screen: "lesson-summary"; bookId: string; lessonId: string }
```

### 2b. `UnitSession` passes the action through

`UnitSession` (~line 245) gains `nextAction?: {...}` and forwards it to `SessionScreen`. No other session wrapper changes.

### 2c. The `unit-session` branch resolves it

In the `unit-session` branch (~line 1443), `onDone` currently calls `reloadAttemptedTaskIds()` then navigates back to the unit.

**The stale-state race is the hard part of this spec — the mechanism below is pinned, not a suggestion.** The session's own `markTaskAttempted` calls are what make the lesson complete, so the `attemptedTaskIds` React state captured at render is one session out of date. `reloadAttemptedTaskIds()` is fire-and-forget (`void …then(setAttemptedTaskIds)`) and **cannot be awaited**. Read the store directly instead:

```ts
// Plan 0020 §4: resolve the next step from the POST-session attempted set.
// `attemptedTaskIds` (state) is stale here by exactly this session's own
// markTaskAttempted calls, and reloadAttemptedTaskIds() can't be awaited.
const onFinished = async () => {
  const ids = new Set(await progressStore.getAttemptedTaskIds());
  setAttemptedTaskIds(ids);
  const lesson = content.lessons.find((l) => l.id === screen.lessonId);
  if (lesson !== undefined && isLessonComplete(lesson, content.units, ids)) {
    setScreen({
      screen: "lesson-summary",
      bookId: screen.bookId,
      lessonId: screen.lessonId,
    });
    return;
  }
  const next = nextUnit(content, ids);
  // ... navigate to `next`, or back to the unit if it is somehow null
};
```

No `setTimeout`, no `useEffect` that reads state on first commit.

`SummaryPanel`'s button must be labelled before the async read resolves, so compute the _label_ the same way but accept that the panel renders while the read is in flight: pass `nextAction` with a **generic label** and let `onClick` do the async resolution and navigation. Labels are generic by owner decision (below), which makes this trivial — the label does not depend on the result.

**Which label.** Determine lesson completion inside the click handler and branch there; the button reads `Next unit` in both cases _before_ the tap, or — preferred and simpler — resolve completion once when the summary is about to show. Pick the shape that keeps one read; state which you chose in the commit message.

**Two branches, and they are total. Do not add a third.** `nextUnit()` returns `null` only when every unit of the Book is complete, which makes the owning lesson complete too — so the "otherwise" branch can never face a null target: an incomplete lesson contains an incomplete unit by definition. The Book-finished case is handled entirely by the lesson-summary branch, where §3 renders the trophy. (A lesson whose `unitIds` all dangle is `isLessonComplete === true` with no real unit, so it can never be reached from a unit session at all.) A third branch would be dead code.

**Labels are generic** — `Next unit`, `Next lesson`, never the target's title (owner decision, 2026-07-28). Accepted consequence: after a skip-ahead, `nextUnit()` can point backwards (finish lesson 3 while lesson 1 is incomplete), so "Next lesson" names a direction the learner did not literally travel. It still goes where they should go.

**Only this session type.** `ReviewSession`, `AdhocSession`, `RecallSession` and `TaskSession` must keep a bare `Done`. `TaskSession` is excluded deliberately despite having lesson/unit context: it runs one random shuffled task, so "next unit" is not what follows it.

**Do not add a global `isLessonComplete` watcher.** It flips on any task attempt, including one cleared from a Daily Review queue — a watcher would interrupt an unrelated review with a celebration and would need a persisted "already celebrated" set to avoid re-firing.

## 3. `LessonSummaryScreen.tsx`

New file `apps/web/src/screens/LessonSummaryScreen.tsx`. Model it on `StatsScreen.tsx` (async gather in an effect, render tiles); reuse `.summary-icon` and `.stat-tiles` from `styles.css`. **No new CSS tokens and no new component file beyond this one.**

Props: `content`, `lessonId`, `attemptedTaskIds`, `store: ProgressStore`, `onNext: (target: {lessonId, unitId}) => void`, `onBack: () => void`.

Tiles — **all derived from keys that already exist. Add no persisted state, no migration, no export/import field.**

| Tile        | Source                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Units       | `lesson.unitIds.length`                                                                            |
| Questions   | `countUnitQuestions(unit, content)` summed over the lesson's units                                 |
| In review   | count of the lesson's scheduling units with non-null `store.getItemState(...)`                     |
| Next review | earliest `due` among those states → `Today` / `Tomorrow` / a formatted date; omit the tile if none |
| Streak      | `store.getStreak(content.topic.domainId)`, rendered like `SummaryPanel`'s streak tile (`fire.png`) |

Derive the lesson's scheduling units from `schedulingUnits(content)` (exported from the engine) filtered to the lesson's units — do not hand-roll id construction.

Actions:

- `nextUnit(content, attemptedTaskIds) !== null` → `[▶ Next lesson]` primary with `play.png`, plus `[Back to Book]` plain.
- `null` → `trophy.png` as the `.summary-icon`, heading `Book complete!`, and `[Back to Book]` only.

Heading when not finished: `Lesson complete!` with the lesson title below it.

### Wiring

New branch in `App.tsx` beside the other simple screens, following the established shape:

```ts
if (screen.screen === "lesson-summary") { … }
```

It needs `content`, so it belongs inside the book-family gate (the `content === null` "Loading…" guard) — add `"lesson-summary"` to the `isBookFamilyScreen` predicate (~line 1001) **and** to the branch condition (~line 1274) so its content loads. Set `backActionRef.current` to the same handler as `Back to Book` (`goToBook(screen.bookId)`), matching the hardware-back contract pinned 2026-07-26.

## Out of scope

The Play button and `nextUnit()` itself (slice 1). Any settings entry — the owner explicitly declined one. Auto-advance of any kind: every step is a tap, and every summary keeps a visible exit.

## Done criteria

1. `corepack pnpm check` green.
2. Browser (`apps/web:verify`): finish a unit session that is **not** the lesson's last → stats show `▶ Next unit` (focused) and `Done`; the button lands on the following unit.
3. Browser: finish the **last** unit of a lesson → `▶ Lesson complete` → lesson summary with real, non-zero tile numbers → `▶ Next lesson` lands in the next lesson's first unit.
4. Browser: complete every unit of the Book → the lesson summary shows the trophy, `Book complete!`, and no next button.
5. Browser: a Daily Review session's summary still shows only `Done` (no next action leaked into other session types).
6. Browser: hardware back from the lesson summary returns to the Book, never a blank page.
7. No new `localStorage` key exists after exercising every path.
