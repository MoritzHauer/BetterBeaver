# Spec: Session-screen pin fix + author Edit button

Two independent fixes to `SessionScreen` and its callers in `apps/web/src/App.tsx`, bundled into one spec because they touch the same header row. No open design decisions — implement as specified.

## Context (read first)

- `apps/web/src/screens/SessionScreen.tsx` — the shared question-rendering screen (`renderInteraction`, the `session-header` with Pin/FeedbackWidget).
- `apps/web/src/App.tsx` — `TaskSession`, `UnitSession`, `ReviewSession` wrapper components that build questions and wire `SessionScreen`'s props; `isAuthor` state (~line 470); existing `onEdit={isAuthor ? ... : undefined}` deep-link pattern (~lines 950, 988, 1050) into `EditScreen`.
- `apps/web/src/progress/pinned-tasks.ts` — localStorage-backed pinned-id set, per domain.
- `packages/engine/src/store.ts` — `dueUnits`/`dueDomainUnits`/`pinnedSchedulingUnitIds`.
- `packages/engine/src/units.ts` — `SchedulingUnit`, `blankUnitId`, `noteUnitId`, `taskSchedulingUnitIds`.
- `packages/engine/src/session.ts` — `Question` union; every kind except `MatchingQuestion` carries a single `unitId` (the scheduling-unit id: an item id, `<itemId>::c<n>` for a cloze blank via `blankUnitId`, or `note:<noteId>` via `noteUnitId`); `MatchingQuestion` instead has `prompts`/`answers` arrays each with their own `unitId`.
- `apps/web/src/screens/EditScreen.tsx` — `EditTarget`, `initialView`, the `View` union (`{v:"item"}`, `{v:"task"}`, `{v:"entry"}` already exist internally).
- `packages/schema/src/documents.ts` — `documentId("topic"|"domain", id)`.
- `packages/schema/src/validate.ts` — `Content.items` is "book-owned items plus the domain entries referenced by this book's units" (plan 0006) — i.e. a book's `content.items` already includes any lexeme/concept it references, so item-kind lookup works the same way in `TaskSession`/`UnitSession` without extra domain-entry threading.

## Part 1 — Pin a single question, not a task's whole union

**Bug**: pinning currently stores a _task id_. `pinnedSchedulingUnitIds` (store.ts) expands every pinned task id back out to _all_ of that task's scheduling units via `taskSchedulingUnitIds` — so pinning one blank of a 3-blank cloze sentence pins all 3, and review shows 3 questions from one pin tap. Fix: store the scheduling-unit id(s) of the exact question shown, nothing else.

### `apps/web/src/progress/pinned-tasks.ts`

Rename and change semantics — the set now holds scheduling-unit ids, not task ids:

```ts
export function getPinnedUnitIds(domainId: string): Set<string> { ... } // same body, renamed
```

```ts
/** Toggles `unitIds` pinned together for `domainId` (a matching question's
 * several ids, or one id for every other kind), persisting the result.
 * "Pinned" means every id in `unitIds` is present; toggling removes all of
 * them if already all pinned, otherwise adds all of them. */
export function togglePinnedUnits(domainId: string, unitIds: string[]): void {
  const ids = getPinnedUnitIds(domainId);
  const allPinned = unitIds.length > 0 && unitIds.every((id) => ids.has(id));
  for (const id of unitIds) {
    if (allPinned) ids.delete(id);
    else ids.add(id);
  }
  localStorage.setItem(`${PINNED_PREFIX}${domainId}`, JSON.stringify([...ids]));
}
```

Storage key prefix (`bb.pinned.`) is unchanged. Note in a comment: ids stored under the old task-id semantics become inert after this ships (a stale id matches nothing, and pinning is ordering-only — see `reviewQueue`'s doc comment — so this is a harmless soft reset, not a migration to write).

### `packages/engine/src/store.ts`

Delete `pinnedSchedulingUnitIds` entirely. `dueUnits`/`dueDomainUnits` take the already-resolved set directly and pass it straight through — no more per-task expansion, and (grep to confirm, but from reading both functions today) the `itemById`/`tasks` locals in both functions exist _only_ to feed that deleted call, so they go too:

```ts
export async function dueUnits(
  content: Content,
  store: ProgressStore,
  now: Date,
  pinnedUnitIds?: ReadonlySet<string>,
): Promise<SchedulingUnit[]> {
  const units = schedulingUnits(content);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  return reviewQueue(units, states, now, pinnedUnitIds ?? new Set());
}

export async function dueDomainUnits(
  bookContents: Content[],
  entries: Item[],
  store: ProgressStore,
  now: Date,
  pinnedUnitIds?: ReadonlySet<string>,
): Promise<SchedulingUnit[]> {
  const units = domainSchedulingUnits(bookContents, entries);
  const states = await collectItemStates(
    units.map((unit) => unit.id),
    store,
  );
  return reviewQueue(units, states, now, pinnedUnitIds ?? new Set());
}
```

Update both functions' doc comments (they currently describe the task-expansion behavior). After this, check whether `taskSchedulingUnitIds` (units.ts) has any remaining caller anywhere in the repo; if none, delete the function, its doc comment, and its `describe("taskSchedulingUnitIds (plan 0008)")` block in `units.test.ts`.

Update `store.test.ts`'s two tests around line 265/274 (`pinnedTaskIds` naming/behavior) to the new `pinnedUnitIds` param and to assert the narrower behavior: pinning one scheduling unit surfaces only that unit first, not its sibling units from the same task.

### `packages/engine/src/units.ts` — new small helper

Add, next to `blankUnitId`/`noteUnitId` (same file, same "scheduling-unit id format" grouping), with a unit test in `units.test.ts`:

```ts
/** The item id underlying a scheduling-unit id: strips a cloze blank's
 * `::c<n>` suffix (added by `blankUnitId`) if present, otherwise returns
 * the id unchanged. Not meaningful for note unit ids (`note:<id>`). */
export function itemIdFromUnitId(unitId: string): string {
  const i = unitId.indexOf("::c");
  return i === -1 ? unitId : unitId.slice(0, i);
}
```

### `apps/web/src/screens/SessionScreen.tsx`

- Rename props: `pinnedTaskIds?: ReadonlySet<string>` → `pinnedUnitIds?: ReadonlySet<string>`; `onTogglePin?: (taskId: string) => void` → `onTogglePin?: (unitIds: string[]) => void`. Keep `taskIds` as-is — it still drives the render-gate and `onTaskAnswered`.
- **Do not change the render-gate.** The Pin button still only renders when `currentTaskId !== undefined` (i.e. only in the pooled unit-practice session, exactly as plan 0010 intended) — only the _identity_ of what gets pinned changes, not where Pin appears.
- Add a small local helper to compute the current question's unit ids:
  ```ts
  function questionUnitIds(q: Question): string[] {
    return q.kind === "matching"
      ? [...q.prompts, ...q.answers].map((p) => p.unitId)
      : [q.unitId];
  }
  ```
- In the Pin button: compute `currentUnitIds = questionUnitIds(question)` (guarded the same way `currentTaskId` already is), `isPinned = currentUnitIds.length > 0 && currentUnitIds.every((id) => pinnedUnitIds?.has(id))`, click handler calls `onTogglePin?.(currentUnitIds)`, label reads "Pinned"/"Pin" off `isPinned`.

### `apps/web/src/App.tsx`

Mechanical rename following the above: `getPinnedTaskIds`/`togglePinnedTask` imports → `getPinnedUnitIds`/`togglePinnedUnits`; every `pinnedTaskIds` local/prop → `pinnedUnitIds`; `UnitSession`'s prop types (`pinnedTaskIds: ReadonlySet<string>` → `pinnedUnitIds: ReadonlySet<string>`, `onTogglePin: (taskId: string) => void` → `onTogglePin: (unitIds: string[]) => void`); its `onTogglePin` callback body becomes `togglePinnedUnits(content.topic.domainId, unitIds)`. `ReviewSession`'s `getPinnedTaskIds(domainId)` call → `getPinnedUnitIds(domainId)`.

## Part 2 — Author Edit button on the question screen

Author-only (matches every other Edit affordance in the app). Non-authors get nothing new here — the existing `FeedbackWidget` (thumbs up/down + report, already in `session-header`) is their equivalent surface; do not build a second one.

### `apps/web/src/screens/EditScreen.tsx`

Extend `EditTarget` with three new optional fields, and add matching branches to `initialView` _before_ the existing lesson/unit/note branches (these new fields are never combined with `lessonId`/`unitId` by the new callers, so ordering only matters for clarity):

```ts
export interface EditTarget {
  lessonId?: string;
  unitId?: string;
  noteStem?: string;
  itemId?: string;
  entryId?: string;
  taskId?: string;
}
```

```ts
function initialView(target: EditTarget | undefined): View {
  if (target?.entryId !== undefined) {
    return { v: "entry", id: target.entryId };
  }
  if (target?.itemId !== undefined) {
    return { v: "item", backTo: { v: "root" }, id: target.itemId };
  }
  if (target?.taskId !== undefined) {
    return { v: "task", backTo: { v: "root" }, id: target.taskId };
  }
  // ...existing lessonId/unitId/noteStem branches, unchanged...
}
```

### `apps/web/src/screens/SessionScreen.tsx`

- New optional prop `onEdit?: (index: number) => void`.
- Render an Edit button in `session-header` (reuse `art/icons/edit.png`, the same icon `BookScreen`'s existing Edit link uses) whenever `onEdit !== undefined && question.kind !== "note"` — unlike Pin, this does **not** depend on `taskIds`/`currentTaskId`, so it appears in `TaskSession`/`ReviewSession` too, not just pooled unit sessions. `NoteQuestion` is excluded because it has no resolvable edit target in this spec (see below) — hide rather than show a dead button. Click handler: `onEdit(index)`.

### `apps/web/src/App.tsx`

Thread a new `isAuthor: boolean` prop into `TaskSession`, `UnitSession`, and `ReviewSession` (none currently receive it) from the existing top-level `isAuthor` state, and pass `isAuthor={isAuthor}` at their three call sites.

Each component builds its own `onEdit` closure (`isAuthor ? (index) => {...} : undefined`) using `itemIdFromUnitId` (from units.ts) plus its own local item-kind lookup, following this rule uniformly:

- **Matching question**: route to the task-level edit view — `docId: documentId("topic", content.topic.id)`, `target: { taskId }` — where `taskId` is whichever task produced that question (in `TaskSession` it's the fixed `task.id`; in `UnitSession` it's `taskIds[index]`; matching never occurs in `ReviewSession`, so this branch doesn't apply there).
- **Every other kind**: `itemId = itemIdFromUnitId(question.unitId)`; look up that item's `kind` (via `content.items.find(...)` in `TaskSession`/`UnitSession` — `Content.items` already includes any domain entries the book references, per validate.ts's doc comment). If `kind` is `"lexeme"` or `"concept"`: `docId: documentId("domain", domainId)`, `target: { entryId: itemId }`. Otherwise (`sentence`/`pair`): `docId: documentId("topic", content.topic.id)`, `target: { itemId }`.
- **`ReviewSession` only** (pools across every book in the domain, so a topic-owned item's book isn't known without a lookup): build a `Map<itemId, bookId>` once (in the `useEffect` that already builds `itemById`/calls `dueDomainUnits`, alongside `booksContent`) from every _non_-lexeme/concept item across `booksContent` (`content.items` for each book, skipping items whose `kind` is `lexeme`/`concept` — those always route to the domain doc, not a specific book, regardless of which book referenced them). Use it in place of `content.topic.id` for the sentence/pair branch above; if an item isn't found in the map, omit the Edit button for that question (return `undefined` from the closure's target resolution, i.e. treat it like the `note` exclusion — this shouldn't happen in practice, but don't throw).
- Navigate the same way the existing Edit links do: `setScreen({ screen: "edit", docId, target })`.

Notes/scope: `NoteQuestion` (review-only) has no lesson/unit context available from a bare question, so it's intentionally excluded (SessionScreen already hides the button for it) — an author can still reach note editing via the existing Unit-screen ✎ link. Do not attempt to resolve a `backTo` for the `{v:"item"}`/`{v:"task"}` views beyond `{v:"root"}` — landing at the editor root on back-navigation is fine.

## Done criteria

1. `corepack pnpm check` green.
2. Engine unit tests updated/added: `itemIdFromUnitId` (units.test.ts), `dueUnits`/`dueDomainUnits` pinning behavior narrowed to a single scheduling unit (store.test.ts), `taskSchedulingUnitIds` and its tests removed if dead (verify via grep first).
3. Browser pass via the `apps/web:verify` skill covering: pinning one blank of a multi-blank cloze task in a unit-practice session pins only that blank (review queue shows just it, not sibling blanks); pinning a matching question in a unit-practice session still pins the whole board (intentionally unchanged — a matching board is one question); non-author sees no Edit button anywhere; author sees Edit in `TaskSession`, `UnitSession`, and `ReviewSession` (except on note questions), and it opens `EditScreen` at the right item/entry/task in each case.

## Out of scope

Restricting a practice session to a single question type (the other reading of the original ask — explicitly not this spec). A non-author "suggest an edit" flow beyond the existing `FeedbackWidget`. Editing notes from the question screen.
