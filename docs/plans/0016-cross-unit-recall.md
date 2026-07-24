# Plan 0016: Cross-unit recall ("Remember: …" cards)

Status: **designed** · Owner: Moe · Date: 2026-07-24 · Direction pinned by a 7-question grilling session (2026-07-24), following a research pass on spacing/retrieval-practice literature (deep-research workflow, same date)

## Purpose

SM-2 already schedules individual items/scheduling-units for review, but that's a per-item due-date mechanism — it has no notion of "this unit specifically depends on that earlier unit, go remind the learner of it now." Retrieval-practice research (Carpenter et al. 2012; Karpicke & Roediger 2007, both confirmed via adversarial verification this session) supports a distinct, coarser mechanism: block-level review of prior material baked directly into later lessons, not just item-level spaced repetition. This plan adds that as a small, manually-authored link between units — an author who knows unit B leans on unit A's vocabulary/grammar can say so, and the learner gets an explicit, skippable "Remember: A" refresher when they reach B.

This is deliberately narrow. It does **not** attempt to compute which prior material is relevant (that's an algorithmic "what to review next" recommendation engine — a real idea, explicitly deferred by the owner) — it's a manual, author-declared pointer, same spirit as the existing `unlocksAfterUnitId` chaining, but for recall instead of gating.

## Goals

After this plan: a `Unit` can declare `recallUnitIds`, zero or more earlier units it wants to prompt a refresher on. The linking unit's Overview page shows one skippable card per linked unit ("Remember: {linked unit title}"), visually distinct from other cards. Tapping it launches a session over a fresh random sample of up to 5 of the linked unit's own tasks — reusing the exact task content already authored for that unit, no new content type. Grading these is practice-only: no SM-2 rescheduling, no effect on the *linking* unit's completion. No new persisted state — the card always shows, every visit, with no "already reviewed" tracking.

## Non-goals

- **No recommendation engine.** No automatic detection of which prior units are relevant, no spaced/delayed-trigger logic for when to first show the card, no "you haven't reviewed this in a while" heuristics. The owner explicitly deferred this broader idea; this plan is the manual-link mechanism only.
- **No new authored content.** The recall session is always sampled from the linked unit's existing `taskIds` — never a distinct question set written for the link itself.
- **No editor UI.** Like `unlocksAfterUnitId` today, `recallUnitIds` is set by hand in the unit's JSON via `/ingest`, not through `EditScreen`'s form editor (which doesn't expose unlock-chaining either — both are tracked together as editor long-tail gaps, `specs/0012-editor-long-tail.md`).
- **No retrofit pass.** The already-shipped Kyrgyz backlog is not revisited to backfill likely links; authors add them opportunistically as units are next touched.
- **No cross-book links.** `recallUnitIds` targets units within the same book only (mirrors `unlocksAfterUnitId`'s implicit scope — nothing in the schema currently supports a cross-book unit reference, and there's no design need for one yet).
- **No "done" tracking or one-time dismissal.** The card is a standing affordance, not a completable checklist item — see plan's design section 4.

## Design

### 1. Schema (`packages/schema`)

- `unitSchema` (`entities.ts`) gains `recallUnitIds: z.array(slugSchema).optional()` — many-to-many: one unit can list several prior units; one prior unit can be recalled-from by many later units. Absent/empty means no links.
- Validation (`validate.ts`), mirroring the existing `unlocksAfterUnitId` dangling-ref check (class (l) territory, same file, ~line 394): each id in `recallUnitIds` must resolve to a real unit in `unitById`, and must not equal the unit's own id (no self-reference). No cycle check — unlike `unlocksAfterUnitId`, recall links carry no gating semantics, so a cycle isn't a structural problem, just two units recalling each other (legitimate: "numbers" and "money" could reasonably recall each other). No enforced "must be an earlier unit" ordering, matching `unlocksAfterUnitId`'s existing permissiveness.
- `CONTENT_SCHEMA_VERSION` is **not** bumped — an additive optional field, ignored safely by non-strict parsing on older clients, per the existing 0015 §6a exemption (`documents.ts`'s bump-rule comment already documents this class of change).

### 2. Session sampling (`packages/engine`)

- New pure function in `session.ts`, next to `buildUnitSession`:
  ```ts
  const RECALL_SESSION_MAX_TASKS = 5;

  export function buildRecallSession(
    linkedUnit: Unit,
    content: Content,
    rng: Rng,
  ): { question: Question; taskId: string }[] {
    const sampledTaskIds = shuffle(linkedUnit.taskIds, rng).slice(
      0,
      RECALL_SESSION_MAX_TASKS,
    );
    return buildUnitSession({ ...linkedUnit, taskIds: sampledTaskIds }, content, rng);
  }
  ```
  Reuses `buildUnitSession` unchanged (it only ever reads `unit.taskIds` plus `content.tasks`/`content.items`) rather than duplicating its per-task question-building/shuffle logic. `RECALL_SESSION_MAX_TASKS` is a private constant, not schema/config — bump it in code if 5 ever needs to change.
- No new grading path: the caller (below) records grades through the same `recordGrade` every other session uses. "Practice-only, no rescheduling effect" isn't special-cased in the engine — it falls out for free, the same way replaying an already-scheduled unit's Practice button does today (grading an already-scheduled item outside its due window doesn't advance it early; see `recordGrade`'s existing due-gated semantics). No `markTaskAttempted` call from this session — the linking unit's completion must stay derived from *its own* `taskIds`, not the recalled unit's, and the recalled unit's completion is already true (it was completed to get here).

### 3. Web (`apps/web`)

- `UnitScreen.tsx`: on the Overview page, below the existing `FeedbackWidget`, render one card per id in `unit.recallUnitIds` (resolve each to its unit via `content.units`, skip silently if dangling — validation already prevents this in shipped content, but a stale cache during an update window shouldn't crash the screen). Each card: `<button className="card recall">Remember: {linkedUnit.title}</button>`, calling a new `onRecall(linkedUnitId: string)` prop (mirrors the existing `onPractice`/`onEdit` prop shape).
- New CSS: `.card.recall` — new token pair `--recall` / `--on-recall` in both `:root` and the dark-mode block (parallel to `--primary`/`--on-primary`), picked distinct from `--primary` (orange, Practice/due-Review) and `--correct`/`--incorrect`, AA-contrast checked in both themes. Exact hex chosen at implementation time within the existing warm-palette convention (plan 0009) — not a design decision left open, just an implementation detail.
- `App.tsx`: new `Screen` variant
  ```ts
  | {
      screen: "recall-session";
      bookId: string;
      lessonId: string;
      unitId: string;        // the linking unit, for onDone back-nav
      recallUnitId: string;  // the linked unit whose tasks are sampled
    }
  ```
  `UnitScreen`'s new `onRecall` prop sets this screen. A new `RecallSession` component (next to `TaskSession`/`UnitSession`) mirrors `UnitSession`'s shape but calls `buildRecallSession(linkedUnit, content, Math.random)` instead of `buildUnitSession`, and its `SessionScreen` `onTaskAnswered` is a no-op (design section 2 — no `markTaskAttempted` call). `onDone`/`onExit` return to the `"unit"` screen for `unitId` (the linking unit), not `recallUnitId`.

### 4. No new persisted state

Confirmed in grilling: the card shows on every visit to the linking unit's Overview, always skippable, no stored "already reviewed" flag, no derived-from-`attemptedTaskIds` suppression either (that signal can't distinguish "reviewed via this card" from "completed the unit originally" — both make `attemptedTaskIds` true). This is a deliberate simplicity choice, not an oversight: the alternative requires either new persisted state (violates the "derive, don't store" completion invariant) or accepting an ambiguous derived signal.

### 5. Authoring (`/ingest`)

One line added to `.claude/skills/ingest/SKILL.md`, step 1 (Scope) — where the author already thinks about the unit's goal and prerequisites: note that `recallUnitIds` exists and is worth setting when the new unit clearly leans on a specific earlier unit's vocabulary/grammar, without making it a mandatory per-unit question.

## Schema changes (`packages/schema`)

- `entities.ts`: `unitSchema` gains `recallUnitIds: z.array(slugSchema).optional()`.
- `validate.ts`: dangling-ref + no-self-reference check for `recallUnitIds`, alongside the existing `unlocksAfterUnitId` check.
- No `CONTENT_SCHEMA_VERSION` bump.

## Engine changes (`packages/engine`)

- `session.ts`: new `buildRecallSession(linkedUnit, content, rng)` + `RECALL_SESSION_MAX_TASKS` constant, exported alongside `buildUnitSession`.
- New unit test(s): sampling caps at 5 when the linked unit has more tasks, uses all of them when it has fewer, and produces the same per-task question shape `buildUnitSession` would for the same sampled subset.

## Web changes (`apps/web`)

- `screens/UnitScreen.tsx`: new `onRecall` prop; recall cards rendered on the Overview page from `unit.recallUnitIds`.
- `styles.css`: new `--recall`/`--on-recall` tokens (light + dark) and `.card.recall` rule.
- `App.tsx`: new `"recall-session"` `Screen` variant, new `RecallSession` component, `onRecall` wired from the `"unit"` screen case.

## Docs

- `docs/design.md`: new Design decisions row for the recall-link mechanism; a line in the Study loop requirements section noting the manual cross-unit recall affordance alongside SM-2.
- `docs/STATUS.md`: new `0016` row in the Plans table (designed, not yet implemented) and a new backlog entry.
- `.claude/skills/ingest/SKILL.md`: one line in step 1, per design section 5.

## Implementation order (each step delegable; `pnpm check` green after every step)

1. **Schema + validation** (`packages/schema`) — `recallUnitIds` field, dangling-ref/self-reference validation, unit tests. No dependency on later steps.
2. **`buildRecallSession`** (`packages/engine`) — depends on step 1's type only; unit tests against synthetic fixtures (same style as `countUnitQuestions`'s tests, plan 0011).
3. **Web wiring** (`apps/web`) — `UnitScreen` cards, new CSS tokens, `App.tsx` screen variant + `RecallSession` component. Depends on steps 1–2.
4. **`/ingest` doc line** — independent, can land in any order.

Final: **browser verification pass** (`apps/web:verify`) — a synthetic unit with `recallUnitIds` pointing at another unit shows a labeled "Remember: …" card on Overview; tapping it launches a session capped at 5 questions even when the linked unit has more tasks than that; grading it doesn't change the linking unit's completion state or the linked unit's SRS due dates; the card is still there on a second visit (no dismissal); a unit with an empty/absent `recallUnitIds` shows no card.

## Done-criteria

- `pnpm check` green after every step.
- Schema: a unit with a dangling or self-referencing `recallUnitIds` entry fails validation with a clear error; a valid one parses and round-trips.
- Engine: `buildRecallSession` never returns more than `RECALL_SESSION_MAX_TASKS` questions' worth of tasks, and returns fewer when the linked unit has fewer tasks than that.
- No existing SRS state, task-attempt data, unlock/completion logic, or `CONTENT_SCHEMA_VERSION` changes — this plan adds one optional array field and one new pure engine function; it doesn't touch `unlocksAfterUnitId`, `dueUnits`, `recordGrade`'s scheduling semantics, or any existing session-building path.

## Open questions

None — all seven decision points (schema shape/cardinality, session content source + cap, surfacing/placement, visual distinctness, persistence/repeat behavior, multi-link display, authoring workflow + retrofit scope) were resolved in the 2026-07-24 grilling session. Owner: Moe.
