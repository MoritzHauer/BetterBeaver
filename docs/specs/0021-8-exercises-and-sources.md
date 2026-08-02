# Spec 0021-8: Exercises and Sources

Slice 8 of [plan 0021](../plans/0021-in-place-editing.md) (§9). Depends on **slices 4–7**. Self-contained per the `/delegate` convention; **make no new design choices**.

The two things with no learner surface at all. A task only exists inside a running session; a resource is never shown to anyone. Both therefore get edit-only surfaces — and this is the last content the form editor still owns.

## Context (read first)

- `packages/schema/src/entities.ts` — `TASK_TYPES` (389), `TASK_ALLOWED_ITEM_KINDS` (408), `TASK_REQUIRED_ASSET` (426), `TASK_NEEDS_DISTRACTORS` (445), `RECOGNIZE_DISTRACTOR_COUNT` (387), `taskSchema` (460), `resourceSchema` (468).
- `packages/schema/src/validate.ts` — the task rules only: classes (e)/(f)/(o) at lines 480–520, (g)/(r) at 524–539, (p) at 543–560, (n) at 644–670. **Do not read the whole file.**
- `apps/web/src/screens/UnitScreen.tsx` — the trail (lines 300–330), post-slice-6.
- `apps/web/src/screens/BookScreen.tsx` — post-slice-7.
- `apps/web/src/screens/edit/BookEditor.tsx` — lines 99–188 only (the task form being replaced).
- `docs/specs/0021-6-in-place-unit.md` — the shared pattern; its rules are not repeated here.

~900 lines. Inside budget.

## A refinement to the plan, recorded here

Plan §9 says "the Unit trail grows edit-only pages (Exercises, Sources)". **Sources belongs to the Book, not the unit** — `resources` is a field of `BookDocument`, shared across every unit. So: **Exercises** is a unit-trail page; **Sources** is a Book-screen edit-only section, with a per-item source control on the Unit rows. The plan has been amended to match.

---

## 1. Exercises

An edit-only page on the Unit trail, appearing as an extra dot after the content pages and only when a session is active.

### 1a. Offer only what is constructible

`+ add an exercise` lists the task types **this unit can actually support**, each pre-filled with the eligible items — one tap makes a valid task. Types that cannot be built are shown greyed **with the reason**, not hidden: "needs audio", "no pairs in this unit", "needs 4 words, this unit has 2".

The list is a fold over tables that already exist. For each `TaskType`, and for each item `kind` present in the unit:

1. **kind allowed** — `TASK_ALLOWED_ITEM_KINDS[type]` includes the kind (class (o)).
2. **no mixing** — candidates are one kind only, never a blend (class (e)). Evaluate each kind separately; a type can be offered twice if two kinds qualify.
3. **owned by this unit** — candidates come from `unit.itemIds` only (class (f)).
4. **asset present** — when `TASK_REQUIRED_ASSET[type]` is `"audio"` or `"image"`, drop candidates lacking that ref (class (n)). `pair` items are exempt from the audio check; `sentence` items are exempt from the image check.
5. **at least one** — `taskSchema.itemIds` is `.min(1)`.
6. **enough distractors** — when `TASK_NEEDS_DISTRACTORS[type]`, the **unit** must hold at least `RECOGNIZE_DISTRACTOR_COUNT + 1` = **4** items of that kind (classes (g)/(r)). Note this counts the unit's items, not the task's.
7. **matching bounds** — `matching` needs 2–5 items with distinct prompt texts (class (p)).

Creating one writes `{ id: newEntityId(bookCode), type, itemIds: [...eligible] }` and appends the id to `unit.taskIds` in the same change.

**The point of this design is that no publish error can originate here.** If a fold produces a task the validator then rejects, the fold is wrong — fix the fold, do not add a marker.

### 1b. Editing an exercise

- **type** — a `<select>`, but listing only the types still valid for the task's current items. Changing type to something the items cannot support is not offered.
- **items** — a picker over the unit's items, filtered to the chosen type's allowed kinds, showing each item's **display text**, never its id. Order matters; reuse `RowActions`.
- **instructions** — optional `<textarea>`.
- **delete** — behind a confirm naming the exercise by type and item count ("Recognize · 5 words"), never by id. `removeEntity(doc, "tasks", id)` strips it from `unit.taskIds` too.

There is no free-text id field anywhere on this page.

### 1c. Naming

Call them **exercises** in the UI, throughout. "Task" is the code-level word and stays in the code; an author reading the screen should not have to learn it. Task _types_ keep their existing names (Recognize, Cloze, Minimal-pair …) — those already appear in the app.

---

## 2. Sources and asset refs

An edit-only section on the Book screen, below the lesson list, plus two row-level controls on the Unit pages.

### 2a. The resource list

Add / edit / delete over `BookDocument.resources`, fields from `resourceSchema` (`entities.ts:468`) — `id`, `title`, `path`. `id` is generated (`newEntityId(bookCode)`), never typed.

Deleting a resource that `sourceRef`s still point at is **not** cascaded — it fails at publish, which is the existing validator rule. Warn in the confirm by counting the items that reference it; do not silently rewrite their `sourceRef`.

### 2b. Per-item source

Each item row on the Unit screen's Vocabulary / Concepts / Examples pages gains a small **Source** control in its expanded state: a single-select over the Book's resources, by title.

Every item and every lexicon entry **requires** a `sourceRef` that resolves (`validate.ts:413` for items, `:785` for entries — note entries resolve against the _Book's_ resources, a genuine cross-document coupling). New items default to the Book's first resource when one exists.

`EntityPicker`'s `freeTextWhenEmpty` escape hatch (`fields.tsx:306`) exists because a new Book has no resources and an author otherwise could not produce one valid item. **Do not port it.** Slice 10 seeds a resource at Book creation, which removes the need; until then, an author with no resources sees "add a source first" pointing at §2a.

### 2c. Per-item asset refs — the only place they can be set

The same expanded row also carries **audio** and **image** controls, picking from uploaded assets exactly as slice 2's figure picker does. Reuse that picker; a stem is never typed.

| item kind           | refs                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `lexeme`, `concept` | `payload.audioRef`, `payload.imageRef` (both optional)                                            |
| `sentence`          | `payload.audioRef` (optional)                                                                     |
| `pair`              | `payload.a.audioRef`, `payload.b.audioRef` — **required**, the only mandatory slugs in the schema |

**This is load-bearing and easy to miss.** §1a greys Listen, Dictation, Shadowing and Picture with "needs audio" / "needs images", and after slice 11 deletes `BookEditor` there is no other surface anywhere that can set those refs — so without this control those four task types become permanently unreachable. If you are tempted to defer it, you are deleting four exercise types.

**Two asset pools, not one.** The validator checks a book item's refs against the _Book's_ stems (`audioStems` / `imageStems`) and a lexicon entry's against the _lexicon's_ (`lexiconAudioStems` / `lexiconImageStems`) — `validate.ts:601` and `:768` respectively. `AssetsManager` lists per document, so the picker must show the pool belonging to whichever document owns the row (slice 6 §2d's book-item-vs-lexicon-entry distinction, again). Offering the Book's images for a lexicon entry produces a ref that passes the picker and fails publish.

Clearing an optional ref must **delete the key** — `slugSchema` rejects `""`, so an emptied `audioRef` that stays as `""` is unpublishable. Same rule as slice 6 §2a and `fields.tsx:88–95`.

---

## 3. Trail and layout

The Exercises dot renders after the content pages, visually distinct from them (it is not learner content). Swipe and keyboard navigation include it in edit mode and exclude it otherwise.

The Practice bar stays hidden in edit mode (slice 6 §1).

---

## 4. Tests

New, `apps/web/src/screens/UnitScreen.exercises.test.tsx`:

- A unit with 4 lexemes offers Recognize; with 3, Recognize is greyed and names the count.
- A unit with lexemes lacking `audioRef` greys Listen with "needs audio".
- A unit with a `pair` item offers Minimal-pair and offers nothing else over that pair.
- A unit with both lexemes and sentences offers Recognize **twice**, once per kind, each pre-filled with only that kind's items.
- Creating any offered exercise yields a task that `checkReferences` accepts — the fold's contract, and the most valuable test here. Drive it over several unit shapes.
- Changing an exercise's type offers only types valid for its current items.
- Deleting an exercise strips it from `unit.taskIds`.
- The Exercises dot is absent in learner mode.

And `apps/web/src/screens/BookScreen.sources.test.tsx`:

- Adding a resource generates a book-code-prefixed id with no text input for it.
- Deleting a referenced resource warns with the count and does not rewrite `sourceRef`s.
- A new item defaults its `sourceRef` to the Book's first resource.

## Verification

`corepack pnpm check` green.

Browser, private-Book path: create a Book, add a source, add a unit with four words, open Exercises, confirm the offered list matches what the unit can support and the greyed entries explain themselves; create one of each offered type; run the Book's publish check and confirm **zero** task-related errors. Then remove a word so the unit has three and confirm Recognize becomes greyed.

Then maintain mode with a real account, publishing a Book whose exercises were all created this way.

## Done-criteria

- Exercises are offered, never assembled field by field; the greyed entries say why.
- No exercise created from the offered list can produce a publish error.
- The UI says "exercise", never "task"; no ids anywhere.
- Sources are managed on the Book screen; every item can reach a source control.
- `freeTextWhenEmpty` is not reintroduced.
