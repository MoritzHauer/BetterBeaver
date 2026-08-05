# Spec 0021-14: The Book and Lesson screens keep their layout

Slice 14 of [plan 0021](../plans/0021-in-place-editing.md) (§14). Depends on **slice 12** for the icons, the settings sheet and the undo toast; independent of slice 13. Self-contained per the `/delegate` convention; **make no new design choices**.

The last slice of the redesign, and the one that finally makes the plan's own promise true on every screen.

## The gap this closes

Plan 0021's Purpose says _"You stay on the page you were reading."_ On the Unit screen that is true. On the **Book** screen it is not: entering edit mode replaces the cover art, the Continue-learning card and the lesson cards with a stack of labelled grey boxes — `Title`, `Description`, `Icon`, `Cover art`, then `Lesson` / `Goal` per lesson, then five `Title` / `Link` pairs for Sources. The Lesson screen does the same to its unit cards.

Nothing about that was decided; it is the form editor's shape, surviving inside the screen that replaced it.

## Context (read first)

- `apps/web/src/screens/BookScreen.tsx` (724) — **the whole file.**
- `apps/web/src/screens/LessonScreen.tsx` (349) — **the whole file.**
- `apps/web/src/screens/edit/inPlace.tsx` (611) — `bookEditOps` / `lessonEditOps` and `ProblemMarker`. The mutations exist; this slice re-presents them.
- `apps/web/src/screens/edit/fields.tsx` (329) — `EntityPicker` (for "Unlocks after"), `RowActions`.
- Slice 12's `SettingsSheet`, `UndoToast` and icon set.
- `apps/web/src/styles.css` — `.card` and the Book-screen rules only.

~2100 lines. Inside budget.

## Not in this slice

The Unit trail (slices 12–13). Preview, Diff or What-changed, which are modes on these screens and stay exactly as they are. Anything about publishing.

---

## 1. Book screen

Edit mode keeps the learner layout and makes the text in it editable.

- **Cover art and icon** stay rendered at their learner size. They are not fields on the page; they move behind a **`⚙` in the header** (§3).
- **Title** and **description** become borderless in-place controls at their learner type — the same treatment slice 13 gives a table cell. The title stays the display-sized heading; it does not shrink into a labelled box.
- **Each lesson keeps its card**: title, goal and progress, exactly as a learner sees it, with the title and goal editable in place and a control rail carrying `⚙` (Unlocks after) and `−` (delete the lesson). The card stays the tap target that opens the lesson.
- **`+ lesson`** is a `+` with its word, below the last card.
- **Sources** — the `resources` list — is not learner-visible at all, so it has no layout to keep. It moves whole into the Book settings sheet (§3). Five `Title` / `Link` pairs are the single largest block of form on the screen today, and they belong to the Book, not to the page.

**Progress-derived affordances stay as they are.** Continue learning, Daily Review and Practice are not editable and are not hidden by this slice: the whole point is that the screen still looks like the Book. (Preview hides two of them, for its own reasons — slice 9 §1b. Unchanged.)

## 2. Lesson screen

The same, one level down: title and goal editable in place, unit cards kept with their progress, `⚙` per unit for "Unlocks after", `−` to delete, `+ unit` below.

## 3. The Book settings sheet

One `SettingsSheet` (slice 12 §4) from the Book header's `⚙`, holding what has no place on the page:

- **Icon** — the existing picker.
- **Cover art** — the existing toggle.
- **Sources** — the `resources` rows, each with title, link and `−`, plus `+ source`.

The Lesson header's `⚙` holds only "Unlocks after" if it is not already on the card; do not invent a Lesson settings sheet with one control in it if the card can carry it.

Sources keeps its one-line explanation — _"Where this Book's content comes from. Every word, concept and example points at one."_ — inside the sheet. A source list with no sentence above it is a mystery, and slice 10 seeds the first row precisely so this is never empty.

## 4. Deleting

`−` on a lesson or unit card routes through the undo toast, naming the thing: `"Lesson deleted · Undo"`.

This is the most destructive `−` in the app — a lesson card takes its units, their items and their tasks with it — so the toast is doing real work here, not polish. `removeEntity` already strips every reference; the snapshot restores all of it at once.

## 5. Problem markers

Unchanged in behaviour, but they now render against cards rather than form fields: field-level markers under their control, entity-level ones on the card that owns them. A card with a problem gets the quiet triangle, never a red border — the same rule as slice 6 §3.

## 6. Tests

`BookScreen.sources.test.tsx`, `BookScreen.skip-ahead.test.tsx` and `BookLesson.edit.test.tsx` stay green. As in slice 13, a behavioural assertion that needs changing means something moved that should not have — **stop rather than update it**.

New, in `BookLesson.edit.test.tsx`:

- In edit mode the Book screen still renders its lesson cards with their progress — assert the progress text is present, which is the thing that disappeared.
- The Book title is editable in place and writes `topic.title`.
- Icon, cover art and every Sources row are **absent from the page** and present in the header `⚙` sheet.
- Deleting a lesson shows a toast and Undo restores the lesson _and_ its units — assert on a unit id, not just the lesson, since the whole subtree is what `removeEntity` took.
- Learner mode is unchanged.

## Verification

`corepack pnpm check` green.

Browser, private-Book path: a Book with two lessons and several units. Enter edit mode and confirm the screen still looks like the Book — cover, cards, progress. Rename the Book and a lesson in place. Open the header `⚙`, add a source, close, confirm the page did not move. Delete a lesson, undo, confirm its units came back.

Then maintain mode with a real account, checking Preview and Diff still switch correctly from the header — this slice moves controls around the very header those modes live in.

## Done-criteria

- Book and Lesson edit modes keep the reading layout; no labelled grey form stack remains anywhere in plan 0021's surfaces.
- Cover art, icon and Sources are reachable in one tap from the header and absent from the page.
- Deleting a lesson or unit is undoable once, with its whole subtree.
- Plan 0021's Purpose — "you stay on the page you were reading" — is now literally true on all three screens.
