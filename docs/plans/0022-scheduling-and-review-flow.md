# Plan 0022: Scheduling ladder and review flow

Status: **designed + implemented** (designed 2026-08-05, all five slices landed 2026-08-12) · Owner: Moe · Date: 2026-08-05 · Direction pinned by a 13-question grilling session (2026-08-05), following a research pass over Anki/FSRS, Duolingo's half-life regression, and the retrieval-practice literature

## Purpose

The three self-grade buttons do not mean what they say. In `packages/srs/src/sm2.ts`, **Hard and Good take the same branch and produce the same next interval** — `1 / 6 / round(previousIntervalDays × ease)` computed with the *pre-update* ease. They differ only in the ease delta (−0.14 vs +0.10), which changes nothing until a later repetition. A learner pressing Hard on a mature card is saying "that was a struggle" and being told to come back in fifteen days, exactly as if they had pressed Good.

Three further gaps follow from the same place:

- A failed card vanishes for a whole day. `applyGrade` schedules it for tomorrow and the session moves on, so the one moment the learner is most primed to re-encounter it is spent on something else.
- There is no way to say "not this word, not this week". The only verbs are grade it or abandon the session.
- A sentence learned by building it from a word bank, unscrambling it and taking dictation on it is reviewed, forever, as a flip-card. `buildReviewSession` maps a due unit by *kind*, not by the task it was learned from, so every non-cloze sentence unit becomes `recallQuestion`. The exercise variety exists for one session and never returns.

This plan replaces SM-2's interval arithmetic with an explicit interval ladder, gives Again and Hard distinct and visible consequences, adds a same-session requeue and a skip verb, and lets sentences review as the exercise they were taught with.

## Goals

After this plan:

- **Good** advances one rung of a fixed ladder — `1, 5, 15, 30, 90, 180, 365` days, the last rung repeating forever. **Hard** steps back one rung and re-asks tomorrow. **Again** resets to rung 0, re-asks tomorrow, *and* re-shows the card inside the current Daily Review.
- A card can be **skipped** for a week (default), a month or a year from the question screen.
- A due **sentence** reviews as its authored `build` / `scramble` / `dictation` exercise instead of a flip-card.
- Unit and lesson cards carry a passive **`· 8 due`** badge, so "which unit am I forgetting" is answerable at a glance without a prompt.
- Settings gains a **Learning** section: review pace, scheduler, skip length. Three selects, no free-text intervals.
- **Classic SM-2 stays selectable**, and switching between the two schedulers is lossless in both directions.

## Non-goals

- **No new persisted state of any kind.** The ladder rides `SrsState.reps`, skip rides `SrsState.due`, the requeue is session-local memory, the config is one `bb.learning` key that the existing `bb.*` backup sweep already covers. No migration, no export/import field, no new store interface method.
- **No recommendation engine** — the boundary plans 0016 and 0020 both drew stands. "Which unit is decaying" is a due-count, not a model.
- **No start-of-session prompt** offering a previous unit to repeat. See §7.
- **No indefinite skip, and no un-skip surface.** Every skip length expires by itself, so nothing needs undoing. See §5.
- **No requeue in unit practice.** Daily Review only. See §4.
- **No free-text interval editing**, no exposed requeue gap, no per-Book or per-domain scheduling config. See §8.
- **No FSRS.** It needs a fitted parameter set and review-log history, neither of which exists here, and its own authors note short-term scheduling is not what the model was fit on.

## Design

### 1. The ladder replaces SM-2's interval arithmetic

`schedule(previous, quality, gradedAt)` keeps its exact signature and gains a scheduler branch. Under the ladder:

```
LADDER = [1, 5, 15, 30, 90, 180, 365]      // rung 6 repeats forever

rung r  = min(previous?.reps ?? 0, 6)      // absent state === rung 0

Good  (quality ≥ 4) → rung min(r + 1, 6),  intervalDays = LADDER[min(r + 1, 6)]
Hard  (quality = 3) → rung max(r - 1, 0),  intervalDays = 1
Again (quality < 3) → rung 0,              intervalDays = 1
```

`due` is the start of the UTC day of `gradedAt` plus `intervalDays` — unchanged from today. `ease` is **carried through untouched**.

**Rung 0 is only ever reached by Again or Hard**, and a card with no state behaves as rung 0, so a new card answered Good goes straight to 5 days and the two cases need no separate rule.

**Why Hard steps back rather than holding its rung.** If Hard held the rung, a card at 90 days could be pressed Hard today and Good tomorrow, landing on 180 days — buying the next interval for one day's wait. Any button that can be used as a promotion shortcut will be used as one. Stepping back means the next Good returns you to exactly the interval you were already on: pressing Hard costs one extra review and nothing else.

**Why Again and Hard share a due date.** Both re-ask tomorrow; they differ in what the *next* Good pays out — 5 days after Again, the rung you held after Hard — and in the requeue. At rungs 0 and 1 they are indistinguishable, because there is nowhere further to fall. That is inherent to a ladder with a floor, not a defect to design around.

**`ease` becomes inert under the ladder.** That is deliberate: it is what makes §3 work.

### 2. Quality buckets — auto-graded questions need no new plumbing

The ladder reads the `Quality` it is already handed: `< 3` → Again, `= 3` → Hard, `≥ 4` → Good. Auto-graded questions emit 2 (wrong) and 4 (correct) via `recognizeQuality`, so they land on Again and Good with no change to `recognizeQuality`, `recallQuality`, `applyGrade`, `recordGrade`, or any call site.

One inherited consequence, named rather than fixed: a correct four-choice MCQ now promotes a rung exactly as much as a self-graded Good does, guess included. That was already true of SM-2's `quality ≥ 3` branch — this plan does not make it worse, and does not make it better.

### 3. Classic SM-2 stays selectable, losslessly

Because the ladder writes `reps` (the rung) and never touches `ease`, and SM-2 writes `ease` and reads `reps` as a repetition count, **a card carries both schedulers' state at all times**. `SrsState` keeps its four fields. Flipping the setting mid-stream needs no migration and destroys no field either scheduler depends on.

Precisely, since "lossless" is easy to overclaim: the two read the same fields but interpret `reps` differently — rung versus repetition count — and the readings coincide except after Again, where the ladder writes `reps = 0` and SM-2 would have written `1`. A card switched back to SM-2 in that state is simply treated as new, which is what a just-failed card effectively is. No value either scheduler writes is one the other cannot consume.

**Migration of existing cards is implicit and is accepted as-is.** An existing SM-2 card's `reps` becomes its rung on the first graded answer after the switch, clamped to 6. A card at reps 5 with a 45-day interval therefore jumps to 365 days on its next Good. Defensible — six successful reviews is a mature card — but visible, and recorded here so it is not discovered as a bug.

Deriving the rung from the nearest ladder interval instead would be gentler, and was rejected: Hard sets `intervalDays` to 1, so an interval-derived rung would collapse to 0 on every Hard press and destroy the step-back semantics.

### 4. Again requeues, inside Daily Review only

On Again, the card is re-inserted into the running session:

```
insertAt = min(currentIndex + 4, queue.length)
```

One expression, no branch: with at least three cards remaining it lands exactly three cards later; with fewer, it lands at the end. The session is not over until every Again card has been answered again — textbook successive relearning, and the shape Anki's learning steps implement with intra-day scheduling, which day-granular UTC due dates forbid here.

**Nothing is persisted and nothing needs to be.** Again already put the card at rung 0 due tomorrow, so a closed app loses only a same-day drill. **The requeued answer has no grading effect at all**: the card is at the floor, `applyGrade` returns `null` for a not-due unit, and promoting a card the learner saw the answer to thirty seconds ago would be wrong anyway. This is correct behaviour, not a limitation to work around.

**Daily Review only.** Verified: `onAllAnswered` is passed by `TaskSession` alone (`App.tsx:305`), so a growing review queue cannot disturb it — but `SessionScreen`'s completion test is `index + 1 >= questions.length` against a **prop**, and unit sessions additionally drive `onTaskAnswered` and plan 0020's lesson-summary chaining off their answer counts. Keeping the mutable queue out of unit practice keeps it out of the code path that owns unit completion. Pedagogically the restriction costs little: a unit session already drills each item across several task types, whereas Daily Review shows each scheduling unit exactly once, which is where a failure genuinely disappears for a day.

**Mechanism.** `SessionScreen`'s internal representation becomes a mutable `{ question, taskId? }[]` in state, seeded from the props. The parallel `taskIds` array folds into it. Completion compares against the live queue length. A requeued card counts as an answer in `SessionSummary` (`autoTotal` / `recallCounts`) — it is one.

### 5. Skip for a week, a month, or a year

The question screen's existing action row (`Pin` / `Edit`, keyed on `currentUnitIds`) gains **Skip**, the mirror of Pin: surface later rather than surface first.

- **Tap** skips by the configured default (1 week out of the box).
- **`onContextMenu`** — right-click on desktop, long-press in Android Chrome, one native handler with `preventDefault()` and `-webkit-touch-callout: none` — opens a `Sheet` offering 1 week / 1 month / 1 year. No timer, and no conflict with the swipe-back detector already bound to the same element, because it is a separate event. Documented fallback if a device pass shows it not firing: a `pointerdown` timer.
- Implementation is `setItemState({ ...state, due })`. The rung, ease and interval are untouched, so the card resumes exactly where it was.

**Review sessions only.** A card with no SRS state is not in a queue to be annoyed by, and skipping in unit practice would do nothing visible, since unit practice is not due-driven.

**No indefinite option and no un-skip screen.** Every offered length expires by itself. Indefinite would be the one skip needing an undo, and an undo needs a way to *find* skipped cards — which a due date cannot provide, since a one-year skip and a card resting at rung 6 produce identical state. That marker would be a new optional field on the pinned `SrsState` interface, paid permanently for an option that is not needed: in this app the learner is also the author (plan 0021), so "this word is not worth learning" already has an author-side answer — delete the item. Anki needs suspend because Anki users study decks they did not write.

### 6. Sentences review as the exercise they were taught with

`buildReviewSession` gains one rule: for a due **sentence** scheduling unit (no `blankNumber`), find a non-cloze task in `content` referencing that item and build its question via `buildTaskSession` on a synthetic single-item task — the existing builder unchanged, distractor sampling included. Falls back to `recallQuestion` when no such task exists.

**Lexemes and concepts keep recall, and the asymmetry is principled.** A lexeme's authored tasks are `recognize` / `listen` / `picture` / `matching` — all multiple choice, all *weaker* retrieval than the recall card review already uses. A sentence's are `build` / `scramble` / `dictation` — all production, all stronger than a flip-card. The rule upgrades exactly the cases where the exercise beats the flashcard and leaves alone the ones where it does not.

Two costs, accepted: a sentence review goes from roughly four seconds to roughly twenty, so daily review gets longer for sentence-heavy Books; and auto-graded exercises emit only 2 and 4, so **there is no Hard button on those cards** — a struggled sentence can only be failed or passed.

### 7. Which unit to repeat: a badge, not a prompt

Unit cards (LessonScreen) and lesson cards (BookScreen) show `· 8 due`, bucketed from the `dueUnits` sweep `BookScreen` **already runs** for its Daily Review badge — mapped through `itemIdFromUnitId` → `unit.itemIds`. No new state, no new I/O, no timestamps, no stored accuracy (which plan 0020 explicitly declined).

**No start-of-session prompt**, for three reasons. Repeating a whole unit is *blocked* practice and Daily Review is *interleaved*, and interleaving beats blocking for long-term retention — a prompt would put the weaker option in front of the learner at the moment they were about to do the stronger one. After §6, Daily Review already replays that unit's exercises anyway, interleaved. And plan 0020 pinned "nothing auto-advances, every step is a tap": a prompt shown before every session is a step that only ever gets dismissed.

The badge composes with plan 0016's author-declared "Remember: …" cards rather than competing with them.

### 8. Configuration: three selects, global by force

A **Learning** section in `SettingsScreen`, stored under one new `bb.learning` key — which rides export/import and "erase all my data" for free, since both sweep every `bb.*` key (`backup.ts:28`).

| Setting         | Options                                                                                                          | Default    |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| **Review pace** | Thorough `1,3,8,20,45,90,180` · Balanced `1,5,15,30,90,180,365` · Light `1,7,21,60,150,300,365`                  | Balanced   |
| **Scheduler**   | Ladder · Classic SM-2                                                                                             | Ladder     |
| **Skip for**    | 1 week · 1 month · 1 year                                                                                         | 1 week     |

**Global, and that is forced rather than chosen.** design.md pins "one word = one SRS state across topics", and `bb.item.*` is keyed by item id with no Book scope. A per-Book ladder would have two schedulers writing contradictory intervals into one lexeme's single state.

**Presets, not numbers.** A typed interval list needs validating for ascending order, positive integers, non-emptiness and a sane ceiling, and every one of those failures needs an error surface and a test; a named constant table is correct by construction. A learner looking at `5, 15, 30, 90` has no basis on which to change one number — what they know is "too much" or "too little", which is what a three-way pace select expresses. Anki's own manual warns users away from its deck options; FSRS collapsed a dozen knobs into one. The requeue gap stays a code constant for the same reason: it has no learner-legible meaning.

**This reopens plan 0020's "No settings" non-goal, deliberately.** That reversal was made on 2026-07-28 about *daily-flow* behaviour where no default had annoyed anyone yet, and it named its own trigger for revisiting: "Add one when a default actually annoys someone." The owner contested the shipped intervals directly in this plan's grilling session, which is that trigger.

### 9. Button copy

Again, Hard and Good get sublabels — **"start over" / "keep my place" / "advance"**. Copy only, and it answers on the screen the question this plan opened with. Anki-style next-interval previews on each button would *not* work here: Again and Hard both read "1d", so a preview would make them look identical again.

## Steps

Five slices, shippable in order. `App.tsx` is 2323 lines and `SessionScreen.tsx` is 1261 — both at or past the ~1500-line ceiling in the delegation policy — so slicing is forced, not stylistic.

1. **Ladder scheduler + Settings** — `packages/srs/sm2.ts` (ladder branch, tests for every rung transition, the clamp, and the SM-2 branch's unchanged behaviour), `SettingsScreen.tsx`, the `bb.learning` key. Touches neither big file.
2. **Sentences review as their exercise** — `packages/engine/session.ts` + tests. Engine-only.
3. **Again requeue in Daily Review** — `SessionScreen.tsx`'s internal queue. The risky one; lands alone so its diff is reviewable in isolation.
4. **Skip verb** — `SessionScreen.tsx` action row, `Sheet`, small `App.tsx` wiring following `onTogglePin`'s existing prop path.
5. **Per-unit due badges** — `BookScreen.tsx`, `LessonScreen.tsx`, an engine grouping helper over the existing sweep.

Slices 3 and 4 both edit `SessionScreen.tsx` and must land in order, not in parallel.

## Verification

`corepack pnpm check` green after each slice, then a real-browser pass (`apps/web:verify`):

1. New card → Good → due in 5 days. Again → due tomorrow **and** re-shown 3 cards later in the same review.
2. Card at rung 4 (90d) → Hard → due tomorrow; next day Good → 90d again, not 180d (the promotion-shortcut regression).
3. Fail the last card of a review → it appends at the end, and the session does not finish until it is answered again.
4. Switch to Classic SM-2 and back mid-stream → no card changes state, no error.
5. Skip a card (tap) → gone from the queue for a week. Right-click / long-press → Sheet with three lengths.
6. A sentence taught by a `build` task appears in Daily Review as a word-bank question, not a flip-card; a lexeme still appears as a recall card.
7. Unit and lesson cards show due counts that match what Daily Review actually serves.
8. Change Review pace → the next graded card uses the new table; existing due dates are untouched.
9. Requeued cards appear in the session summary counts.

## Research inputs

Compact record of what the design leaned on, so a later reader can check the reasoning rather than re-derive it.

- **Anki** — Again returns a card to the first learning step, Hard repeats the current step, Good advances, Easy graduates; Hard's shorter interval comes from a dedicated **hard multiplier (default 1.20)**, a term SM-2 proper does not have. Learning/relearning steps are minute-granular (`1m 10m` / `10m`) — the mechanism this plan reproduces as a session-local requeue, because day-granular UTC due dates forbid intra-day scheduling. Anki splits "not now" into three verbs (bury = until tomorrow, suspend = until you say, set due date = N days) and auto-suspends leeches after 8 lapses. Its manual documents the new-card overwhelm failure and warns "only change options that you fully understand". Sources: [deck options](https://docs.ankiweb.net/deck-options.html), [leeches](https://docs.ankiweb.net/leeches.html), [studying](https://docs.ankiweb.net/studying.html).
- **FSRS** — now Anki's recommended scheduler; replaced a dozen knobs with **desired retention (default 90 %)**. Its short-term scheduling is explicitly not what the model was fit on, and the value of same-day learning steps is contested within its own community. Informs §8's presets-not-knobs and the Non-goals' rejection of FSRS itself. Sources: [fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki), [short-term scheduler issue](https://github.com/ankitects/anki/issues/3497).
- **Duolingo** — no card verbs at all: half-life regression (ACL 2016, roughly half the prediction error of Leitner) estimates each word's half-life, and BirdBrain assembles the *session*, mixing review into new lessons. The learner grades nothing and configures nothing. The counter-model to this plan, and the reason §6 exists: repetition as a property of generated sessions rather than of a queue. Source: [Settles & Meeder, ACL 2016](https://research.duolingo.com/papers/settles.acl16.pdf).
- **Successive relearning** — retrieval to a criterion, re-spaced across days, moved course-exam performance a full letter grade over spaced restudy. The direct support for §4's "the session is not over until every Again card has been answered again". Source: [Educational Psychology Review](https://link.springer.com/article/10.1007/s10648-013-9240-4).
- **Interleaving over blocking** — the basis for §7's refusal of a unit-repeat prompt.
- **Session size** — the consistent practitioner figure is 15–25 minute sessions, 10–20 new items/day settling to 60–150 reviews/day, with fatigue above ~200. No hard experimental optimum, so it informs the pace presets' shape and nothing normative.
- **Same-day repeats specifically** are *not* claimed as a research result anywhere in this plan. §4 is a product-feel requirement — a card you just failed should not vanish for a day — and is framed as one deliberately.

## Implementation notes (2026-08-12)

All five slices landed in order, `corepack pnpm check` green after each (582
tests, 4 skipped at the end). Four things the design did not pin, decided
while building:

1. **`schedule` gained an optional trailing `SchedulingConfig`**, rather than
   keeping its literal three-argument signature (§1). The config has to reach
   a pure function somehow, and the alternative — a module-level setting in
   `packages/srs` — is a hidden global in the one part of the codebase whose
   contract is "pure, deterministic, no I/O". Existing three-argument callers
   are unaffected; the default is the ladder on Balanced. `applyGrade` and
   `recordGrade` pass it through the same way, and `App.tsx` supplies
   `schedulingConfig()` at all six grade sites, read at grade time so a
   Settings change needs no invalidation path.
2. **A requeued visit never requeues again** (§4 did not say). "The session is
   not over until every Again card has been answered again" is the bar the
   plan sets, and it says *answered*, not *answered correctly* — so failing
   the repeat ends it. Otherwise a card the learner keeps failing extends the
   session without limit.
3. **Daily Review now pools every Book's units, items and tasks** into the
   `content` it hands `buildReviewSession`. `App.tsx` used to pass
   `booksContent[0]` under a comment saying the argument was unused; §6 made
   it load-bearing, and one Book's task list would have silently dropped every
   *other* Book's sentences back to the flip-card. Item ids are unique across
   Books, so the union is unambiguous.
4. **Completion compares against a live queue length carried in a ref.**
   `advance()` runs in the same tick as the requeue insertion, where the
   `queue` state is still pre-insertion — without the ref, failing the *last*
   card of a review ended the session on the spot and the requeued card was
   never shown (verification item 3, which is exactly the case that caught
   it). The queue itself holds positions into the `questions` prop rather
   than copies, so the in-session `✎` sheet's mid-session re-derivation still
   flows through.

Two of §6's task types were left out of the sentence-exercise rule
deliberately: `shadowing` (nothing checks the answer, so it grades no better
than the recall card it would replace) and every MCQ type (weaker retrieval
than the card, which is §6's own argument). A `dictation` candidate is
skipped when the sentence has no `audioRef` — `requiredAudioStem` throws on
those, and a throw would take down the whole review session rather than one
card.

**Browser pass** (headless Chromium against `pnpm dev`), 19 assertions across
two runs, no page or console errors:

- Settings shows Learning with the three pace presets and their intervals,
  and the choice persists to `bb.learning`.
- A first Good writes `intervalDays: 5, reps: 1` — the ladder, not SM-2's 1.
- Lesson cards read `0/3 · 4 due`.
- Daily Review shows Skip; right-click opens the three-length sheet; picking
  "1 year" pushes exactly one card ~365 days out with its rung, ease and
  interval untouched.
- A failed review card reappears later in the same session
  (`Incisors → Kit → Scent mound → Incisors`).
- A due sentence taught by `dx-task-build-gnaw` renders as a word bank while
  a due concept in the same session still renders as a recall card.

Not browser-driven, covered by unit tests instead: the rung-4 Hard → Good
promotion-shortcut regression (verification item 2), the mid-stream scheduler
switch (item 4), and the pace change applying to the next graded card only
(item 8).
