# Plan 0011: Unit screen follow-ups — scrollable vocab, compact practice bar, real task count, header back arrow

Status: **not started** · Owner: Moe · Date: 2026-07-18 · Direction pinned by an 8-question grilling session (2026-07-18) following a UI review of plan 0010's shipped Unit screen

## Purpose

Plan 0010 shipped a paginated Unit screen (dot-trail, chunked sub-pagers, sticky Practice bar). A UI review of that screen surfaced four follow-up fixes: Vocabulary's chunked sub-pager is worse than just scrolling; the Practice bar is bigger than it needs to be and states a redundant "shuffled order" caption; the task count it shows is actually a count of task *groups* (exercise clusters), not the questions a learner will answer, which understates real session length; and "back to lesson" only exists on the Overview page, so four of the five pages have no way to exit the unit. This plan fixes all four against the shipped 0010 code, without revisiting 0010's own decisions.

## Goals

After this plan: the Vocabulary page renders all rows in one scrollable list, no sub-pager; the Practice bar reads `Practice` with a small task count inside the button on the right, no separate caption line; that count is the real number of questions/flashcards the pooled session will produce (via a new pure `countUnitQuestions`), not `unit.taskIds.length`; and a persistent header row — back arrow plus the existing dot-trail — is shown on all five pages, so the unit can be exited from any page.

## Non-goals

- **Concepts/Examples stay paginated.** Only Vocabulary was flagged; the identical chunk-of-6/chunk-of-4 sub-pager pattern is untouched for the other two sections. Revisit later if the same complaint comes up there.
- **No swipe-gesture change.** Horizontal swipe-to-navigate stays active on the Vocabulary page even though it's now a tall scrollable list — accepted tradeoff, not something this plan adds handling for.
- **No dot-trail redesign.** "The progress bar" in the review feedback is the existing dot-trail (plan 0010), not the bar-style `ProgressBar` component used on Lesson/Topic/TopicList. It's relocated into the new header row, not replaced or restyled.
- **No content-generation changes.** The reviewer also floated generating fewer, less-repetitive tasks per unit in the future. Out of scope here — recorded as a known gap in `docs/STATUS.md` (Design section 3 below), not implemented.
- **No change to Topic/Lesson-level Practice or to `SessionScreen`/`buildUnitSession` question-building logic.** This plan only adds a count function next to them; it doesn't touch how sessions are built or graded.

## Design

### 1. Vocabulary page: scrollable, not sub-paginated

In [`apps/web/src/screens/UnitScreen.tsx`](../../apps/web/src/screens/UnitScreen.tsx), the `"vocabulary"` branch (lines 358–415): drop `vocabChunks`/`vocabPage` and the `SubPager` it renders — render the full `<table className="vocab-table">` over all of `lexemes` directly (`vocabRows` becomes just `lexemes`). Remove `VOCAB_CHUNK_SIZE`, `vocabPage` state, and the `vocabChunks` computation (lines 19, 188, 287–289); `chunk()` stays (still used by Concepts/Examples). No new CSS needed — the page's existing scroll container already handles overflow; the sticky Practice bar's `padding-bottom` already reserves clearance below the last row.

### 2. Practice bar: compact, real count, no caption

- New CSS class (or modifier) on the existing `.unit-practice-bar`/`.action-bar-inner` in [`apps/web/src/styles.css`](../../apps/web/src/styles.css): shrink the bar's vertical padding/min-height (currently sized for a button + a caption line; drop to fit one row).
- In `UnitScreen.tsx` (lines 476–481): replace the two-element bar (button + `<p className="status">`) with a single button containing both the label and the count, e.g.:
  ```tsx
  <div className="action-bar unit-practice-bar">
    <div className="action-bar-inner unit-practice-bar-inner">
      <button onClick={onPractice} className="unit-practice-button">
        <span>Practice</span>
        <span className="unit-practice-count">{questionCount}</span>
      </button>
    </div>
  </div>
  ```
  `unit-practice-button` uses `display: flex; justify-content: space-between; align-items: center` so the count sits right-aligned inside the button; `unit-practice-count` is a smaller font-size than the label. No new color tokens — reuse `--on-primary` for both spans.
- The "shuffled order" caption is dropped entirely, not relocated — session behavior is unchanged, just no longer stated in the UI (confirmed in grilling; matches 0010's existing "no fabricated time estimate" precedent for this bar).

### 3. Real question count (`countUnitQuestions`)

- New pure function in [`packages/engine/src/session.ts`](../../packages/engine/src/session.ts), next to `buildTaskSession`/`buildUnitSession`:
  ```ts
  export function countUnitQuestions(unit: Unit, content: Content): number {
    const taskById = new Map(content.tasks.map((task) => [task.id, task]));
    const itemById = new Map(content.items.map((item) => [item.id, item]));
    return unit.taskIds.reduce((total, taskId) => {
      const task = taskById.get(taskId);
      if (task === undefined) {
        return total;
      }
      if (task.type === "matching") {
        return total + 1;
      }
      if (task.type === "cloze") {
        return (
          total +
          task.itemIds.reduce((sum, itemId) => {
            const item = itemById.get(itemId);
            if (item === undefined || item.kind !== "sentence") {
              return sum;
            }
            const parsed = parseClozeMarkup(item.payload.text);
            return sum + (parsed.valid ? parsed.blanks.length : 0);
          }, 0)
        );
      }
      return total + task.itemIds.length;
    }, 0);
  }
  ```
  Mirrors `buildTaskSession`'s per-type question count exactly (one question per item, except `matching` collapsing to one board and `cloze` expanding to one question per blank via the same `parseClozeMarkup` already used there) but takes no `rng` and builds no `Question` objects — just counts. Exported alongside `buildTaskSession`/`buildUnitSession`.
- **Why not reuse `buildUnitSession(unit, content, rng).length`:** that function requires an `Rng`, and does real randomized work per question (MCQ distractor sampling via `sampleMcq`, `shuffle` calls) purely to materialize prompts/choices nothing here needs — wasteful to run on every `UnitScreen` render just to read a length.
- `UnitScreen.tsx`: import `countUnitQuestions` from `@betterbeaver/engine`, compute `questionCount = countUnitQuestions(unit, content)` once per render (cheap — one pass over `taskIds`, no memoization needed), use it in the Practice button (design section 2).
- Add a unit test in `packages/engine`'s existing session test file: a task with a 3-item `matching` task counts as 1, a `cloze` task with 2 blanks in one sentence counts as 2, and a plain `recall` task with 4 items counts as 4 — matching the corresponding `buildTaskSession`/`buildUnitSession` output lengths for the same fixture (a cheap way to keep the two in sync if question-building logic changes later).
- **Not in scope**: generating fewer/less-repetitive tasks per unit so the *real* count comes down. Recorded as a new bullet in `docs/STATUS.md`'s "Not yet built" section: task authoring often produces multiple task-type variants (recall/recognize/cloze/...) over the same items, inflating question count without adding new content — a future content-authoring or generation-pipeline concern, not a code change.

### 4. Persistent header: back arrow + dot-trail on all pages

- In `UnitScreen.tsx`, move the dot-trail (currently lines 307–317, already rendered unconditionally above all five page branches) and the back button (currently lines 319–329, gated to `currentPage === "overview"`) into one shared header block rendered once, above the `pages.map(...)` branches, on every page:
  ```tsx
  <div className="unit-header">
    <button
      type="button"
      className="plain unit-back"
      aria-label="Back"
      onClick={onBack}
    >
      &larr;
    </button>
    <div className="trail">
      {pages.map((pageKind, index) => (
        <button
          key={pageKind}
          type="button"
          className={`dot${index === page ? " active" : ""}`}
          aria-label={`Page ${index + 1} of ${pages.length}`}
          onClick={() => setPage(index)}
        />
      ))}
    </div>
  </div>
  ```
  The Overview page's `<h1>{unit.title}</h1>` / `<p>{unit.goal}</p>` stay where they are (still Overview-only content, just no longer paired with the back button) — only the button itself and its lesson-title text move out; the lesson-title text (`content.lessons.find(...)?.title ?? content.topic.title`) is dropped from the button (an icon-only arrow per the review feedback), not relocated.
- New CSS in `styles.css`: `.unit-header` as a flex row (`align-items: center; gap`), arrow sized/touch-target consistent with other icon buttons already in this stylesheet (reuse existing icon-button sizing, don't invent a new one); `.trail` styling unchanged, just now a flex child instead of a standalone top-of-page block.

## Engine changes (`packages/engine`)

- `session.ts`: new `countUnitQuestions(unit, content)`, exported alongside `buildTaskSession`/`buildUnitSession`. No changes to existing question-building functions.
- New unit test covering `matching`/`cloze`/plain-type counting against the same fixture used for `buildUnitSession`'s existing test.

## Web changes (`apps/web`)

- `screens/UnitScreen.tsx`: Vocabulary sub-pager removed (scrollable instead); header restructure (back arrow + dot-trail combined, shown on all pages); Practice bar restructured to one button with an inline count; `countUnitQuestions` replaces `unit.taskIds.length`.
- `styles.css`: new/modified classes for `.unit-header`, `.unit-back`, compact `.unit-practice-bar`/`.unit-practice-button`/`.unit-practice-count`; no changes to `.trail`/`.dot` styling beyond its new flex-child context.

## Docs

- `docs/STATUS.md`: update the plan table with a new `0011` row; add a "Not yet built" bullet for the task-repetition/over-generation gap (design section 3).
- `docs/design.md`: update wherever it documents the Unit screen's task count / Practice bar (plan 0010's entries) to reflect the new `countUnitQuestions`-based count and header layout.

## Implementation order (each step delegable; `pnpm check` green and app fully usable after every step)

1. **`countUnitQuestions`** (engine, pure function + unit test) — no UI dependency, lands and is tested independently.
2. **Vocabulary scrollable page** — isolated change to one branch of `UnitScreen.tsx`, no dependency on the other steps.
3. **Practice bar restructure** — depends on step 1 for the real count; independent of steps 2 and 4.
4. **Header restructure (back arrow + dot-trail)** — independent of steps 1–3, can land in any order relative to them.

Final: **browser verification pass** (`apps/web:verify`) — Vocabulary page on a unit with >6 lexemes scrolls smoothly with no sub-pager visible, swipe still navigates between the five main pages while on Vocabulary; Practice bar shows "Practice" with a small right-aligned count matching the actual number of questions a session produces (spot-check against a unit with a `matching` task, confirming it contributes 1 to the count, not its item count); back arrow is visible and functional on all five pages, not just Overview; dot-trail still navigates correctly from its new position in the header row.

## Done-criteria

- `pnpm check` green after every step.
- Vocabulary page on `ky-unit-greet-introductions` (or any shipped unit with >6 lexemes) is a single scrollable list, no sub-pager control.
- The Practice bar's count exactly equals `buildUnitSession(unit, content, rng).length` for every shipped unit (verified by the new unit test comparing `countUnitQuestions` against `buildUnitSession`'s output length across shipped content fixtures).
- The unit can be exited (back arrow) from every one of the five pages, not only Overview.
- No existing SRS state, task-attempt data, or session-building behavior changes — this plan touches no schema, no scheduling-unit ids, no `localStorage` key shapes, and no `Question`-building logic.

## Open questions

None — all four items were resolved in the 2026-07-18 grilling session (vocab-only scope, swipe left active, count via new engine function, back arrow on all pages using the existing dot-trail). Owner: Moe.
