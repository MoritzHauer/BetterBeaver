# Spec 0020-1: `nextUnit()` resolver + Play entry points

Design record: [plan 0020](../plans/0020-daily-flow-automation.md) §1–3. **Do not reopen its decisions** — they came out of a 10-question owner grilling. Implement as written.

This is slice 1 of 2. Slice 2 (`0020-2-next-and-lesson-summary.md`) also edits `App.tsx`; **it must land after this one**, not in parallel.

## Goal

A ▶ Play affordance that decides what to study and navigates there: due > 0 → Daily Review, otherwise the next incomplete unit's UnitScreen, otherwise a trophy "Book complete" state.

## Required reading

`App.tsx` is 1609 lines — over the delegation reading budget (design.md, delegation policy). **Read only these regions**, not the whole file:

| File                                     | Region                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/progress.ts`        | whole file (~130 lines) — `isUnitComplete` is the predicate you reuse                                                                                                             |
| `packages/engine/src/progress.test.ts`   | enough to match the test style                                                                                                                                                    |
| `packages/engine/src/index.ts`           | the barrel (12 lines)                                                                                                                                                             |
| `apps/web/src/screens/BookScreen.tsx`    | whole file (255 lines)                                                                                                                                                            |
| `apps/web/src/screens/MyBooksScreen.tsx` | whole file (352 lines)                                                                                                                                                            |
| `apps/web/src/App.tsx`                   | lines 67–127 (`Screen` union), 863–874 (`reloadAttemptedTaskIds`, `goToBook`), 941–991 (`booksContentMap`, `bookProgress`), 1171–1260 (`books` branch), 1295–1334 (`book` branch) |
| `apps/web/src/styles.css`                | lines 340–445 (`.card.*`, `.book-actions`, `--book-chip-row`)                                                                                                                     |

Assets `art/icons/play.png` and `art/icons/trophy.png` already exist. Do not generate artwork.

## 1. Engine — `nextUnit()`

Add to `packages/engine/src/progress.ts` (exported through the existing `export * from "./progress.js"` barrel — no index change needed):

```ts
/** The unit the learner should continue with: the first unit, in reading
 * order, that isn't complete. Reading order is `topic.lessonIds`, then each
 * lesson's `unitIds` — the same order BookScreen and LessonScreen render, so
 * "next" always means what the learner sees next. Dangling ids are skipped
 * (valid content has none; a stale cache during an update window must not
 * crash). `null` when every unit of the Book is complete.
 *
 * Locks are deliberately not consulted: the caller navigates straight to
 * UnitScreen, which has no lock gate of its own — the skip-ahead confirm
 * lives on the Lesson/Book *cards*. For all authored content the first
 * incomplete unit is unlocked anyway, since every earlier unit is complete. */
export function nextUnit(
  content: Content,
  attemptedTaskIds: ReadonlySet<string>,
): { lessonId: string; unitId: string } | null;
```

`Content` comes from `@betterbeaver/schema` — `progress.ts` currently imports only `Lesson`/`Unit`, so add it. Walk `content.topic.lessonIds` → `content.lessons.find(...)` → `lesson.unitIds` → `content.units.find(...)`, returning the first unit where `!isUnitComplete(unit, attemptedTaskIds)`.

### Tests (`packages/engine/src/progress.test.ts`)

Cover, at minimum:

1. Nothing attempted → the first unit of the first lesson.
2. First unit complete → the second unit.
3. Half-attempted unit (some but not all `taskIds`) → **that same unit**, not the next one.
4. Last unit of lesson 1 complete → the first unit of lesson 2 (crosses the boundary).
5. Skip-ahead shape — lesson 1 incomplete, lesson 2 fully complete → points **back** into lesson 1.
6. Every unit complete → `null`.
7. A dangling lesson id and a dangling unit id are skipped, not thrown on.
8. Reading order follows `topic.lessonIds` / `lesson.unitIds`, not array order in `content.lessons` / `content.units` — construct a fixture where they differ.

## 2. `App.tsx` — the resolver call

Add one helper inside `App`, next to `goToBook` (~line 871):

```ts
// Play (plan 0020 §2): due > 0 → Daily Review, else the next incomplete
// unit, else nothing to do (the Book is finished — land on BookScreen,
// which renders the trophy state). No stored "first tap today" flag: due
// dates are day-granular UTC, so finishing today's review empties the
// queue and every later tap lands on a unit.
async function playBook(bookId: string): Promise<void>;
```

Behavior:

1. `booksContentMap.get(bookId)` → if absent, `goToBook(bookId)` and return.
2. `await dueUnits(bookContent, progressStore, new Date(), getPinnedUnitIds(domainId))` — Book-scoped, matching `BookScreen`'s existing badge call. Pass the pinned set the same way `BookScreen` does (check: `BookScreen` currently omits it — if so, omit it here too and keep the two identical).
3. `due.length > 0` → `setScreen({ screen: "review", domainId: bookContent.topic.domainId })`.
4. Otherwise `nextUnit(bookContent, attemptedTaskIds)`:
   - non-null → `setScreen({ screen: "unit", bookId, lessonId, unitId })`
   - null → `goToBook(bookId)`

No new `Screen` variant. No new `localStorage` key. Nothing is persisted by this spec.

**Scope note, do not "fix" it:** `dueUnits` is Book-scoped while the `review` screen it opens is domain-scoped (`dueDomainUnits`). With two added Books on one domain, Play on Book A can read "0 due" and still open a review holding Book B's items. That is exactly what the Daily Review card does today; Play only makes it more visible. Out of scope (plan §2).

## 3. My Books — the ▶ chip

`MyBooksScreen.tsx`: a third chip in the existing `.book-actions` row (~line 201), **after** Vocabulary and Daily Review:

```tsx
<button
  type="button"
  className="plain icon-button play-btn"
  onClick={() => onPlay(book.id)}
  aria-label="Continue"
>
  <img src={`${import.meta.env.BASE_URL}art/icons/play.png`} alt="" />
</button>
```

New prop `onPlay: (bookId: string) => void`, wired in `App.tsx`'s `books` branch to `(bookId) => void playBook(bookId)`.

**No live state on this chip.** It shows no due count and never disables. Resolving a due count per Book would mean a `dueUnits` sweep for every added Book on the home screen — hundreds of `localStorage` reads each, on the screen plan 0013 flagged for jank. Consequence, accepted: with nothing left to do it opens BookScreen, which shows the trophy state.

CSS in `styles.css`, beside the existing `.vocab-btn` / `.review-btn` rules (~line 414):

```css
.book-actions .play-btn {
  background: var(--primary);
  color: var(--on-primary);
}
.book-actions .play-btn:active:not(:disabled) {
  background: var(--primary-pressed);
}
```

**Regression risk — check it.** `.book-actions` is absolutely positioned and its alignment with the title row was a reported bug fixed 2026-07-26 (`--book-chip-row`, "measured 0.0px off"). A third chip widens the row; verify in a browser that it still aligns with the title and does not overlap the book icon, the `private` marker, or the `⋯` menu on a narrow viewport.

## 4. BookScreen — the Play card

`BookScreen.tsx`: a new card **above** the existing Daily Review card (~line 157). Daily Review, Practice and Vocabulary all stay — nothing is removed.

New props: `onPlay: () => void` and `nextUnitTitle: string | null` (resolved by the caller; `BookScreen` already receives `content` and `attemptedTaskIds`, so it may instead call `nextUnit` itself — pick one and be consistent, calling it directly is fewer props and is preferred).

The card reads its state off the `dueCount` the screen already loads:

| Condition                  | Icon         | Title         | Subtitle                | Disabled |
| -------------------------- | ------------ | ------------- | ----------------------- | -------- |
| `dueCount === null`        | `play.png`   | Continue      | `Loading…`              | yes      |
| `dueCount > 0`             | `play.png`   | Continue      | `{n} due for review`    | no       |
| `dueCount === 0`, next ≠ ∅ | `play.png`   | Continue      | the next unit's title   | no       |
| `dueCount === 0`, next = ∅ | `trophy.png` | Book complete | `Nothing left to study` | yes      |

Use `className={"card" + (disabled ? "" : " primary")}`, matching how the Daily Review card already toggles `primary`. Subtitles go in `<p className="status">`, matching the sibling cards.

## Out of scope

Everything in slice 2: `SummaryPanel`'s next-action button, the `lesson-summary` screen, `LessonSummaryScreen.tsx`, and the `unit-session` `onFinished` chaining. Do not touch `SessionScreen.tsx` or `App.tsx`'s `unit-session` branch.

Also out of scope: any settings entry (the owner explicitly declined one), auto-advance, and the `dueUnits` scope asymmetry above.

## Done criteria

1. `corepack pnpm check` green, including the new engine tests.
2. Browser (`apps/web:verify`): ▶ chip on a Book with nothing due opens the first incomplete unit's UnitScreen; with something due it opens Daily Review.
3. Browser: BookScreen's Play card shows the due count when due, the next unit's title when not, and the disabled trophy state on a fully-complete Book.
4. Browser: the three-chip `.book-actions` row is still vertically aligned with the title row and overlaps nothing.
5. No new `localStorage` key exists after exercising every path.
