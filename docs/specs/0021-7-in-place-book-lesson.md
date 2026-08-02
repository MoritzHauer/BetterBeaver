# Spec 0021-7: In-place editing on the Book and Lesson screens

Slice 7 of [plan 0021](../plans/0021-in-place-editing.md) (§1). Depends on **slices 4–6**. Self-contained per the `/delegate` convention; **make no new design choices**.

The structural level: a Book's identity and its lesson list, a Lesson's identity and its unit list. Smaller than slice 6 and follows the same pattern, so read that spec first — every rule there about `useEditSession`, engine edit ops, problem markers and `RowActions` applies here unchanged and is not repeated.

## Context (read first)

- `apps/web/src/screens/BookScreen.tsx` (306) — **whole.**
- `apps/web/src/screens/LessonScreen.tsx` (169) — **whole.**
- `docs/specs/0021-6-in-place-unit.md` — the pattern this slice repeats.
- `apps/web/src/screens/edit/BookEditor.tsx` — lines 408–535 only (the lesson and root views being replaced).
- `packages/schema/src/entities.ts` — `BOOK_ICONS` (17–43) and `bookSchema` (44–60).

~650 lines. Comfortably inside budget.

## Not in this slice

Resources (slice 8) — they belong to the Book but have no learner surface, so they live on an edit-only page with Exercises. Preview or Diff (slice 9). Book _creation_ (slice 10).

---

## 1. Book screen

### 1a. Editable

| field               | control                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `topic.title`       | `<input>`                                                              |
| `topic.description` | `<textarea>`                                                           |
| `topic.icon`        | picker over `BOOK_ICONS` (emoji, not the PNG set) plus a "none" choice |
| `topic.hasCoverArt` | checkbox — **hidden for private Books**                                |

`hasCoverArt` toggles a watermark loaded from `art/icons/<book.id>.png` in the app's **public** assets, which a private Book can never reach. `BookEditor`'s `hideCoverArt` prop exists for exactly this reason (`BookEditor.tsx:46–51`) — offering a control that can only ever silently fail is worse than not offering it. Carry the rationale comment.

Clearing `icon` or unchecking `hasCoverArt` must **delete the key**, not set `undefined` — slice 6 §2a's rule, same trap, same reason.

### 1b. The lesson list

Each lesson card becomes: an editable title, an editable goal, and a `RowActions` row (up / down / delete). Order is `topic.lessonIds`, and reordering writes it via `moveId`.

- **Delete** uses `removeEntity(doc, "lessons", id)`, which strips the id from `topic.lessonIds` and cleans up references. Behind a confirm naming the lesson **by title** — the id is a UUID and means nothing to the author.
- **`+ lesson`** creates `{ id: newEntityId(bookCode), topicId: book.id, title: "", goal: "", unitIds: [] }` and appends to `topic.lessonIds` in the same change — the two-step `BookEditor.tsx:511–533` does. Setting `topicId` matters: a mismatch is validator class (a).
- Tapping a lesson card still navigates into it, carrying `editing` (slice 5 §2a). Make the title input's own click not navigate.

### 1c. The learner cards

Play, Daily Review, Practice and Vocabulary are progress affordances, not content. **Hide all four in edit mode.** They add nothing to authoring, and Play in particular derives from `nextUnit`/`dueUnits` over the _published_ content while you are looking at a draft, so it would be actively misleading.

The lock icons and progress bars on lesson cards stay — a lock is the learner-visible face of `unlocksAfterLessonId`, which is editable on the Lesson screen (§2a), and seeing it is how the author checks the chain.

`FeedbackWidget` and the chat block are hidden in edit mode: reporting a problem in content you are editing is a loop.

---

## 2. Lesson screen

### 2a. Editable

`lesson.title` → `<input>`; `lesson.goal` → `<textarea>`.

**Unlocks after** — single-select over the Book's other lessons, by title. Same delete-the-key-when-cleared rule. Its learner surface is the lock on the Book screen's lesson card, which is why editing it lives here, on the entity it belongs to.

### 2b. The unit list

Same shape as §1b: editable title and goal per card, `RowActions` for order and delete, `+ unit`.

- **`+ unit`** creates `{ id: newEntityId(bookCode), lessonId: lesson.id, title: "", goal: "", itemIds: [], taskIds: [], noteIds: [] }` and appends to `lesson.unitIds`. `lessonId` must match the owning lesson (validator class (a)); an orphaned unit is class (d).
- A brand-new unit immediately carries `unit has zero tasks`. Expected — slice 8's Exercises page is where that gets resolved.
- Delete behind a confirm naming the unit by title.

The Practice card is hidden in edit mode, like the Book screen's.

---

## 3. Problem markers

Identical to slice 6 §3. Book-level problems (`topic.lessonIds: dangling lesson reference …`) render once near the lesson list; lesson-level ones render on their card.

---

## 4. Tests

`App.back-nav.test.tsx` and `BookScreen.skip-ahead.test.tsx` stay green.

New:

- Learner mode renders exactly as before on both screens — no inputs, all four Book cards present.
- Edit mode hides Play / Daily Review / Practice / Vocabulary and the feedback widget.
- `+ lesson` appends to `topic.lessonIds` **and** creates the lesson with the right `topicId`.
- `+ unit` sets `lessonId` to the owning lesson.
- Reordering lessons rewrites `topic.lessonIds` order.
- Deleting a lesson strips it from `topic.lessonIds`.
- Clearing `unlocksAfterLessonId` removes the key (`"unlocksAfterLessonId" in lesson === false`).
- `hasCoverArt` is absent for a private Book.
- Tapping a lesson card navigates with `editing` still set.

## Verification

`corepack pnpm check` green.

Browser, private-Book path: create a Book, edit its title, description and icon in place, add two lessons, reorder them, add units to one, set an unlock chain and confirm the lock appears on the Book screen's card, delete a lesson behind its confirm, navigate down to a unit and back and confirm edit mode held throughout.

Then maintain mode with a real account, confirming the same edits reach the draft and survive Sync.

## Done-criteria

- Book and Lesson screens edit in place; navigation between them keeps edit mode.
- No entity id is visible; every confirm names things by title.
- Learner-progress cards are hidden in edit mode.
- `hasCoverArt` never appears for a private Book.
- Learner mode is byte-identical to before.
