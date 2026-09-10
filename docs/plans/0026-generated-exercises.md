# Plan 0026: Generated exercises

Status: **implemented** (slices 1–5, 2026-09-10; slice 6 deliberately not done — see §9's amendment and the implementation notes) · Owner: Moe · Date: 2026-08-31 · Prerequisite: [plan 0025](0025-progression-engine.md) (generation is only principled once exercises carry a level) · Origin: owner proposal, 2026-08-31 — "remove all standard exercise questions and just let them be generated based on the content; specific task creation should still be possible"

> **Amended 2026-09-07**, owner question during the [plan 0027](0027-authored-questions-and-exam-mode.md) design — "should the tasks be in the unit already for every format or should it be auto generated depending on the difficulty needed right now? Often the tasks will be hand crafted with the wrong answers as well."
>
> One change, and everything else follows from it: **the generator produces a question for one item at one level, not a task set for a unit** (§1). Plan 0025 §4 asks for exactly that — the early slot at `{level−1, level}`, the later slot at `level+1` — and a task set would have to be filtered back down to a level to serve it.
>
> Consequences, each recorded in place: constructed exercises are never materialised and so need no ids (§2, rewritten); authored content wins per **(item, level)** rather than per type, and authored wrong answers turn out to be item data rather than task data (§3, amended); phase 2's schema bump drops from deferred to cosmetic (§9); open questions 1 and 3 close. Nothing about the level table, item targets (§5), completion (§4) or the validation posture (§7) changes.

## Purpose

A `Task` carries no authored decision. Checked against the shipped seed, all thirteen tasks are `{id, type, itemIds, instructions}` and every one of those four fields is either mechanical or boilerplate:

<!-- prettier-ignore -->
| Type | Apparent parameter | Where the decision actually lives |
| --- | --- | --- |
| `recognize`, `recall`, `matching`, `listen`, `picture`, `shadowing`, `scramble`, `dictation` | the item list | the unit's same-kind items, filtered by the type's own floor — a restatement of `unit.itemIds` |
| `cloze` | which word to blank | **on the item**, as `{{c1::…}}` markup in the sentence |
| `build` | the word bank | **generated at runtime** from sibling sentences' tokens (`BUILD_DISTRACTOR_COUNT`) |
| `minimal-pair` | the near-homophone pair | **is** the `pair` item |
| all of them | `instructions` | per-type boilerplate in all 13 seed tasks — "Fill in each blank", "Pick the matching answer" |

So the `tasks` layer is a hand-maintained index over `unit.itemIds`, and it is the kind of index that rots silently: add a word to a unit and you must remember to add it to the recognize task, the recall task and the matching board. **No validator class checks that an item appears in any task at all** — class (d) catches an orphaned item, nothing catches a present-but-undrilled one. An item can sit in a unit, render on the Vocabulary page, and never once be asked.

This plan derives the index from the item set and 0025's ladder, and keeps authoring as an override. It is the third thing in this codebase to become derived rather than stored, after progress and the symmetric link closure.

## Goals

- A unit with no authored tasks still has a complete, ladder-ordered exercise set.
- Adding an item to a unit is sufficient — nothing else has to be edited for it to be drilled.
- Unit completion stops depending on task identity, and stops reporting a unit complete when four of its five words were never shown.
- An author who wants a specific exercise still authors it, and it wins.
- Phase 1 ships with **no content change and no schema version bump** (§9).

## Non-goals

- **Not removing `tasks`.** The maximally non-additive version of this idea — deleting the field — would reject every published document on every older client and has no story for private Books, which have no republish path (0017 decision 5). Authored tasks stay first-class forever; generation fills what a unit did not author.
- **No generated _content_.** Sentences, glosses, examples and cloze markup are authoring. This plan only decides which exercises to build over items that already exist. (Unchanged from 0025 §10.)
- **No learner state in generation.** The generator is pure over content, like `buildUnitSession` — same content, same task set, on every device. Adaptation lives in 0025 §5's review climb, which reads the rung.
- **No authored difficulty level per item.** See §5: SRS discovers difficulty empirically and per learner; an authored number would be a second, stale source of truth.
- No change to grading, to either scheduler, or to the outcome-list contract.

## Design

### 1. The generator

**Amended 2026-09-07** (see the amendment note above): the signature below replaces "→ a task set". The rest of this section is unchanged and was always right; only the thing being produced moved.

Pure function over content: one item (kind, asset refs, cloze markup) + the domain lexicon + 0025's exercise level table + optional targets (§5) + a level →

```
exerciseAtLevel(item, level, content) → Question | null
```

No `Rng`; shuffling stays where it is, in session building. `null` means the content cannot build that level for that item — no audio for `listen`, too few same-kind siblings for an MCQ — which is exactly what 0025 §4's "a missing level is skipped, not waited for" already consumes.

**Why one item and one level, rather than a unit and a task set.** 0025 §4 asks the session engine for an exercise *at a specific level* for a *specific word*: the early slot draws from `{level−1, level}`, the later slot is `level+1`. A generator that returns a unit's task set would then have to be filtered back down to a level — an indirection with no consumer. Nothing in the app wants a list of generated tasks; the session wants the next question, and the author wants a coverage grid (§8), which is this same function run over every (item, level) cell.

Its objective is **per-item level coverage**, not per-type presence — the distinction that keeps it from maximising:

- Every item is reachable across the level range, not clustered at one end: something at the recognition end, something at the production end, and the middle where its kind allows. Two exercises at the same level gain nothing, since 0025 §4 draws one of them anyway.
- ~~One task per type per unit, so the knob is which types, not how many.~~ **Retired by the amendment** — there are no generated tasks to count. The knob is which (item, level) cells construction covers, which is the coverage grid itself.
- Redundant levels collapse: two exercises sharing a level are interchangeable to the draw — build one, not both.
- ~~The budget is counted in **questions** (`countUnitQuestions`), not tasks~~ — **retired**; see open question 1, now closed. 0025 §6 fixes session length at word count × the Progression preset, so there is no set to size. The question-count-inflation concern plan 0011 raised is answered by that, not by a budget here.
- Floors are **gates, not errors**: a unit with three same-kind items simply does not get an MCQ (§7). Under the amended signature this is literally `null`, not a suppressed task.

Of these, the two with actual evidence behind them are 0025's comprehension-before-production ordering and spacing; the rest are defensible design heuristics and are labelled as such rather than dressed up as findings.

### 2. Constructed exercises have no ids, because they are never materialised

**Rewritten 2026-09-07.** The original section minted derived task ids — `${unit.id}::${type}`, plus `::${n}` for a chunked board — and argued they could not collide with authored ones because `slugPattern` forbids `:`. That argument was sound and is no longer needed: under §1's signature nothing is materialised, so there is nothing to name.

A constructed exercise is built at draw time and discarded, exactly as `build`'s word bank is today. **Nothing new is stored** — not in content, not in the backend, not on the device.

That leaves three consumers of `taskId` to account for, and all three already resolve:

- **`onTaskAnswered` / completion** — §4 moves completion to items, so nothing needs a task id to record progress.
- **Pinning** — has stored scheduling-unit ids, not task ids, since 2026-07-25. Unaffected.
- **The question screen's ✎ route** — `design.md` already specifies it as "routing to the specific item/lexicon-entry, **or to the owning task for matching questions**". So the app's own editing rule already treats the item as the thing you edit and the task as the exception. A constructed exercise routes to its item; an authored matching board routes to its task. No change of rule, and no id to invent.

`buildUnitSession`'s `{question, taskId}` pair keeps its shape; `taskId` is simply absent for a constructed exercise. `SessionScreen` already handles an absent task id — review sessions pass none today.

### 3. Authored tasks win, per (item, level)

**Amended 2026-09-07 — the axis changed from type to (item, level).** The original rule was per type: authoring a task of type T suppressed generation of T for that whole unit.

That is too coarse once the draw is level-indexed. One authored `matching` board would switch off constructed matching for **every item in the unit**, including the items the board never names — so an author who hand-picks five confusable words silently costs the unit's other fifteen words their level-1 exercise.

**The rule:** an authored task covers the (item, level) cells it actually covers — its own `itemIds`, at its own type's level — and construction fills the rest. `unit.taskIds` keeps working exactly as today.

Finer is also what makes hand-authored content win *where it exists* without costing coverage everywhere else, which matters because most units will be partly hand-written. It preserves the original section's intent — the author who wants one specific board should not lose everything else as the price — and extends it from "everything else" meaning other types to meaning other items as well.

**Corollary, and it is the more important half: authored wrong answers are item data, not task data.** The plan's own opening table already concedes the pattern — `cloze`'s decision is markup on the item, `minimal-pair`'s pair *is* the item, `build`'s bank is constructed. Plan 0027 completes it: a `question` item carries its stem, its options and their correctness, and its two labels, and its task type is derivable from the payload. So a hand-crafted question with authored distractors needs **no authored task at all** to be playable, and it wins by being the item, not by suppressing anything.

Matching-board membership — which five words sit on a board together — is the one decision that genuinely cannot live on an item, and it is the one this section's override exists for.

The demo Book keeps its full authored set, because proving all eleven types remain playable is its job (plan 0002, still normative).

`instructions` survives on authored tasks. Constructed exercises take a per-type constant, which is a small copy regression: "Pick the fact that matches each term" reads better than a generic string, and only the override buys it back.

### 4. Completion moves from tasks to items

Today `isUnitComplete` is "every task id of the unit has been attempted", over a persisted set of attempted task ids (`progress.ts:12`). That set feeds unlock gates → `nextUnit()` → the Play button → lesson chaining → every progress bar. It is the navigation spine, and it is the one thing generated ids would destabilise.

**New rule: a unit is complete when every one of its items has at least one scheduling unit at word level ≥ 1** — answered *correctly* at least once (pinned by the 0025 grilling, 2026-08-31; the earlier form of this rule said "has SRS state", which a wrong answer also produces). The level is stored by 0025 anyway, so this is still derived from existing state and needs no new key.

Three things to get right:

- **It must be items, not scheduling units.** A unit's *notes* are scheduling units too (0008 §7) but are never asked in a unit session — only in review. "Every scheduling unit has state" would make a unit with a note permanently incomplete. Items only.
- **It is stricter than today's rule, twice over.** Answering one question of a five-item recall task currently marks that whole task attempted, so a unit can read complete with four of five words never shown — and an attempt counts even when the answer was wrong. The level rule fixes both. This is a fix, but it is learner-visible: units that read complete today can flip back to incomplete, re-locking gates and regressing bars.
- **So the legacy set is grandfathered**, in the repo's existing presence-based, self-erasing shape (0006): complete = new rule **or** the old attempted-task rule; the old key is read, never written again, and ages out as content is re-studied. A learner mid-Book keeps every completion they earned; only new units cost the honest amount.

Rejected alternative: keep writing attempted ids for generated tasks. It works, but it re-introduces the identity dependence this section exists to remove, and it preserves the one-of-five bug.

### 5. Item targets — intent, not difficulty

The owner's "content gets a rank for itself" splits into two readings, and only one is worth having.

**Rejected — how hard this item is.** SRS already discovers that, empirically and per learner, and writes it into the rung. An authored difficulty number is stale on arrival and duplicates state the app maintains better.

**Adopted — how far up the ladder this item should be taken.** "Passive vocabulary" versus "active vocabulary" is a real teaching decision every course makes, and one no amount of learner data can infer, because it is about intent. It maps onto 0025's level scale as a ceiling: stop this word at level 2 (recognise-only), or take it to 9 (write it). Default is the full ladder for the item's kind, so most items never set it.

**It hangs off the unit, not the item.** Lexemes and concepts are domain-owned and shared across Books (0006: one word, one SRS state), so a target on the entry would be global — and a word may legitimately be passive in unit 3 and active in unit 9. An optional `unit.itemTargets` map keyed by the unit's own item ids, holding a maximum level is additive and correctly scoped. A validator rule mirrors class (a): a target keyed by an id the unit does not own is a dangling reference.

### 6. What is lost

Stated plainly, because the escape hatch in §3 is the only thing that buys any of it back:

- **Unit flavour.** Every generated unit has the same rhythm. A dialogue-heavy unit and a vocabulary unit stop feeling different unless someone authors the difference.
- **Deliberate groupings.** A matching board of five confusable words teaches more than five arbitrary ones; chunking picks arbitrary ones.
- **Copy.** Per-type boilerplate instead of per-unit phrasing (§3).
- **Loud content errors.** See §7.

**The 2026-09-07 amendment recovers part of the first two.** Under the per-type rule, one authored board bought back matching for the unit and lost construction for that type everywhere in it; under per-(item, level), an authored task keeps its cells and construction fills only the gaps. So flavour and groupings survive wherever an author actually authored them, at no coverage cost. The other two items stand unchanged.

### 7. Validation: errors become gates, and one new error appears

Classes (e), (f), (o), (g)/(r), (p), (q) and (n) are all task-shaped. For an authored task every one of them still applies, unchanged. For a constructed exercise they become **constructor preconditions** — `exerciseAtLevel` returns `null` rather than an exercise that violates them, so the condition is unrepresentable rather than validated. That is strictly the better shape, and it is the same argument 0021 §9 already made for the Exercises page. _(Amended 2026-09-07: "the generator cannot emit a task" → the constructor returns `null`. Same posture, and now the same value 0025 §4's "a missing level is skipped, not waited for" already consumes.)_

The cost is that a content problem goes quiet. Today "your unit has three items, so this MCQ is invalid" fails the build; generated, it is a silently missing exercise. Two compensating controls, and they are load-bearing rather than nice-to-have:

1. **Per-item level coverage is promoted to required.** An author has to be able to see the highest level a unit's content can actually reach — and which words no exercise reaches at all — or the silence is the whole experience.
2. **A new error class: a unit item that no exercise — generated or authored — reaches at all.** This is exactly the rot described in the Purpose, and generation is what finally makes it checkable: before, "in no task" was a legitimate authoring choice; now it means the item is unreachable.

### 8. Where the author sees it

0021 §9's Exercises page stops being a list of things to add and becomes a **preview with overrides**: an (item × level) coverage grid — literally §1's function run over every cell — showing which levels each item can reach, which cells an authored task already covers, and which the constructor fills; plus a control to author a task where the constructed exercise is not what you want. The wizard sketched in the ladder plan's first draft largely dissolves here — with nothing to keep in sync, there is nothing to recommend, only targets to tune. _(Amended 2026-09-07: "budget" struck from that last clause with open question 1; and the grid is now the primary surface rather than a derived display, since it is the same function the session calls.)_

Generated tasks appear in Preview but **not in Diff**: they are derived from content already in the diff, so showing them would double-count every item change as an exercise change too.

### 9. Schema version — why phase 1 is free and phase 2 is not

The tempting claim is that this is all additive. It is not, and the trap is worth writing down: making `unit.taskIds` **optional** is additive for a *reader*, but the moment a document actually omits it, every older client rejects that document — its zod schema still requires the field, and class (i) ("a unit with zero tasks") would reject `taskIds: []` as well. Learner clients run the validator per Book, so the failure is total, not cosmetic.

So the plan splits:

- **Phase 1 — supplement, no bump.** `taskIds` stays required and every document keeps its authored list. The generator runs as a *supplement*: it produces the exercises a unit does not already author. Opt-in per Book through one additive optional flag on the Book document, so no shipped content changes behaviour until its author ticks it. This is genuinely additive — no `CONTENT_SCHEMA_VERSION` bump, no republish, private Books untouched — and it already delivers guaranteed coverage, the end of index rot, and item targets.
- **Phase 2 — replace, and take the bump.** `taskIds` becomes optional and content stops listing tasks. This bumps `CONTENT_SCHEMA_VERSION`, which is precisely what the bump procedure is for (0012 §8: old apps keep cached content, old editors are refused, a reload beats a migration framework). Existing private Books all carry `taskIds` and keep parsing, so 0017 decision 5 is satisfied without a local migration.

**The free ride is already gone.** Plan 0023's `components` reshape took `CONTENT_SCHEMA_VERSION` 1 → 2, and §7 republished `domain:ky` at version 2 on 2026-08-30 — so phase 2 would be a standalone 2 → 3 and pays its own rollout wait. That is an argument for phase 1 carrying its weight alone (it does: coverage, the end of index rot, and item targets, all without touching a document), and for phase 2 waiting until another bump-worthy change wants to travel with it.

**Amended 2026-09-07: phase 2 drops from deferred to cosmetic, and may never be worth doing.** The reason phase 2 existed was to stop content listing tasks it does not care about. Under §1's per-item construction, index rot is already fixed without emptying anything — an item added to a unit is reachable at every level its kind allows the moment it is added, because construction is keyed on the item, not on a list that has to mention it. So `taskIds` can stay required forever, holding only the exercises someone deliberately authored, and class (i) never has to be relaxed.

What is left of phase 2 is tidiness: deleting boilerplate task entries from Books whose authors do not want them. That is a per-Book content edit with no behavioural effect, and it is not worth a `CONTENT_SCHEMA_VERSION` bump on its own. If a bump-worthy change comes along later — [plan 0027](0027-authored-questions-and-exam-mode.md) carries one — phase 2 can ride it for free. Otherwise it can simply not happen.

## Slices

1. **The constructor** (`packages/engine`, pure) — `exerciseAtLevel(item, level, content)` + the coverage query over it. Nothing consumes it yet beyond tests: same content and level in, same question out, floors returning `null` rather than an invalid exercise.
2. **Wire it into the level draw**, opt-in per Book — 0025 §4 asks for a level, an **authored task covering that (item, level) cell answers if one exists, and the constructor answers otherwise**. _(Amended 2026-09-07: this slice previously read "unit sessions become authored ∪ generated-for-missing-types". That was a session-construction rule, and under 0025 §6 there is no set to union — the engine is a queue asked for the next question, and session length is already fixed at word count × the Progression preset. A union would have lengthened every session, which is what the original open question 3 was worried about. It is a **lookup** rule, not a construction rule.)_ The opt-in flag stays, because it is what keeps a Book's exercise mix from changing on the day this ships.
3. **Completion moves to items** (§4) with the legacy grandfather. Independent of 1–2 and worth landing on its own: it fixes the one-of-five bug today.
4. **Item targets** (§5) — the optional map, the validator rule, generation reading it.
5. **Exercises page becomes preview + override** (§8), including the promoted coverage display and the new unreachable-item error (§7).
6. **Phase 2** — `taskIds` optional, the version bump, and a content pass that drops the authored lists from Books that want generation. Only after 1–5 have proven out, and ideally riding 0023's bump.

## Done-criteria

- A unit with items and zero authored tasks produces a full, ladder-ordered session.
- Adding an item to a unit puts it in the session with no other edit.
- A unit authoring one `matching` task over five of its twenty items gets that board for those five, **and constructed level-1 exercises for the other fifteen** — the per-(item, level) rule of §3, and the case the retired per-type rule got wrong.
- A `question` item with authored options is playable with no authored task at all.
- Session length is identical whether a Book is opted in or not — only which exercise fills a slot changes.
- Answering one question of a five-item unit no longer marks the unit complete; a unit completed under the old rule stays complete after upgrading.
- A unit item that no exercise reaches is a validation error.
- Phase 1: `pnpm check` green, no `CONTENT_SCHEMA_VERSION` change, no content edited, every existing Book behaves exactly as before until opted in.

## Implementation notes

### Slices 1–5 (2026-09-10)

All five slices landed in one pass, `corepack pnpm check` green after each. Slice 6 is deliberately not done — §9's amendment already reduced it to tidiness, and nothing built here needs it. Eleven things the design did not pin, decided while building:

1. **`exerciseAtLevel` returns the `Exercise`, not a `Question`.** §1 writes the return type as `Question | null` and, in the next sentence, pins "no `Rng`; shuffling stays where it is, in session building" — and a `Question` is exactly the shuffled thing. Returning the exercise satisfies both halves: `session.ts`'s `buildExerciseQuestion` turns it into a question with the rng it already holds, and the coverage grid (§8) gets its answer without minting boards it will never show. It also fits the shape 0025 already built, where `availableExercises` → `drawExercise` → `buildExerciseQuestion` is three steps, not one.

2. **Every item kind is constructible somewhere, so §7's new error class can never fire.** `recall` needs only the item's own two sides and accepts lexeme, concept and sentence; `minimal-pair` *is* the pair item. Construction therefore reaches all four kinds at some level, and "a unit item that no exercise reaches at all" is unreachable rather than merely rare. That is §7's own stated preference — "the condition is unrepresentable rather than validated ... strictly the better shape" — so the class ships as the check that keeps it that way (validator class (ad)), asking about *reach* rather than floors, and starts biting on the first item kind that can fail to build. Plan 0027's `question` item is the obvious candidate.

   The tempting stronger version — "an item no authored task names, in a Book that has not opted in" — was rejected. It would fire on real content, but a validator error is total for a learner (the validator runs per Book on the device), and the Kyrgyz Book's 167 items live in the backend where this branch cannot check them. Phase 1 promises every existing Book behaves exactly as before; a publish-blocking rule that might reject a live Book is not that.

3. **Open question 2 closes, and the amendment is what closed it.** Chunking was a question about partitioning a unit into boards — "a 12-item unit needs boards of 4, 5, or 3+4+5". Per-item construction never partitions: it builds a board *for one word*, at draw time. The only decision left is which siblings join that word's board, and the default is the word plus its unit's same-kind siblings in authored order, capped at the five class (p) allows, skipping any that reads the same on the prompt side. Unit order is the author's own, so the board is stable across sessions and readable in the grid, and §3's override still exists for the five confusable words someone actually wants together.

4. **A constructed exercise mints no scheduling unit.** §2 says nothing new is stored; the case where that bites is cloze. A constructed cloze built through the ordinary builder would grade `<itemId>::c1`, a blank id `schedulingUnits` only emits for an *authored* cloze task — so the drill would credit a word it never planned, the owed-answer count and the queue would drift apart, and the session would end early with answers still showing as owed. Constructed questions are therefore pinned to the scheduling unit the caller planned. An authored cloze task keeps its blank ids, unchanged.

5. **The same mismatch already existed for an authored cloze task, and was fixed after an owner call (2026-09-10).** `startDrill` is handed `unit.itemIds`, while an authored cloze question grades `<itemId>::c1`; `advanceDrill` then consumed the visit without paying off the count, so a cloze-bearing unit ended still owing answers. It predates this plan and it changes behaviour for Books that have *not* opted in, which is why it was raised rather than folded in silently.

   The fix keeps both id spaces intact and translates once, at the boundary where they meet: `App.tsx` maps each outcome through `itemIdFromUnitId` before handing it to the drill, so `onGrade` still schedules the blank and the drill still credits the word it planned. Its other half is `itemLevels`, because the same split hid a second bug — nothing ever writes SRS state under a cloze sentence's *own* id, so reading the item id alone pinned such a sentence at level 0 for ever and every session opened it at the bottom of the ladder. A word split across several scheduling units is now at the level of its **weakest** one: the number decides how hard the next exercise may be, and a sentence whose third blank is still new is not one to ask at level 10 because its first two are.

   Rejected: making blanks first-class in the drill's plan (`startDrill` over scheduling-unit ids). It is the more honest model — a three-blank sentence really is three things to learn — but it changes session length for any cloze-heavy unit, which moves `countUnitQuestions`, the "N to go" number and the lesson-summary totals. That amends 0025 §6 rather than fixing a bug under it, and wants its own slice.

6. **In an opted-in Book every sentence a unit owns gets a scheduling unit**, whether a task names it or not. `schedulingUnits` gated sentences on task references, which is the same index rot this plan removes: the constructor can ask the sentence, so it must carry a level, or the unit bar and the completion rule would report on words the session drills. Cloze blanks are untouched — they still come from an authored cloze task alone.

7. **An item target caps which exercise a word is asked as, never how far its level climbs.** The scheduler advances on any correct answer, so a passive word still advances, still stretches its interval, and its unit still reaches 100%. Had the cap bound the level instead, 0025 §8's "100% is attainable on any content" would have quietly stopped being true.

8. **The target caps the union, not each half.** It governs authored tasks too — an author who caps a word at 2 and leaves an old dictation task pointing at it has contradicted themselves, and the cap is the more specific statement. But capping the authored set and the constructed set separately makes the never-silence-a-word floor fire on the authored side alone, dragging a level-8 `recall` into a Book whose constructor had a level-1 board ready. `availableExercises` and `itemCoverage` both cap once, over the union.

9. **The cap yields to one floor: a word is never left unaskable.** A target of 1 on a word whose unit cannot build a board is an authored contradiction; silence would leave the word undrilled and the session short, so the lowest available exercise survives the cap. `drawExercise` already reasons this way ("a word is never skipped for want of an exact match"). The coverage grid deliberately does *not* mirror the floor — where a target is set that nothing can reach, the grid shows the word unreached, which is the more useful half-truth on the one surface that exists to tell an author they asked for the impossible.

10. **`draftContent` had to learn both new fields.** It rebuilds a unit and a Book field by field, so `generatedExercises` and `itemTargets` were dropped the moment an author opened the editor — the author would have watched their own toggle revert on the next keystroke. `icon` and `hasCoverArt` recorded exactly this trap already.

11. **Slice 3 was half-done before this plan started.** §4's rule — a unit is complete when every word is at level ≥ 1 — landed with 0025 slice 7 on 2026-09-01. What did not land is the half that protects the learner from it: the level rule is stricter twice over, so units that read complete could flip back, re-locking gates. `bb.attempted` was deliberately left on disk when 0025 stopped writing it, so the completions were still there to honour; it is now read, never written, and ages out. Only `complete` is grandfathered — `percent` and `started` describe the levels and gate nothing.

`exerciseAtLevel` itself is exported and tested but has no in-tree caller: the draw goes through `constructibleExercises` + `drawExercise`, which also carry 0025 §4's slot semantics, and the grid goes through `itemCoverage`, which needs the whole set per cell rather than one exercise. It stays because it is the plan's named contract and the natural question a caller outside this plan asks. Its counterpart `isUnreachable` was deleted before landing: it would have been a second statement of validator class (ad)'s rule, in a second package, with nothing consuming it — exactly the drift this codebase avoids. Its guarantee is now a test on `constructibleExercises`.

Two done-criteria are not met here, both by design rather than by omission:

- **"A `question` item with authored options is playable with no authored task at all."** The `question` item kind is [plan 0027](0027-authored-questions-and-exam-mode.md)'s, and does not exist yet. `canConstruct`'s kind guards are positive precisely so that adding it forces a decision about which rungs it can fill rather than letting it inherit one it cannot render.
- **"Phase 1: ... no content edited."** Held: no file under `content/` changed, `CONTENT_SCHEMA_VERSION` did not move, and no Book opts in. Nothing generated reaches a learner until an author ticks the switch.

**Slice 6 stays deferred, pointed at [plan 0027](0027-authored-questions-and-exam-mode.md)** (owner call, 2026-09-10). §9's amendment already reduced it to tidiness with no behavioural effect, which does not earn a standalone `CONTENT_SCHEMA_VERSION` 2 → 3 bump and its rollout wait — but 0027 carries a bump-worthy change, so phase 2 can travel with it for free. Retiring the slice outright was the alternative and was not taken: `taskIds` staying required forever is fine, but there is no cost to leaving the tidy-up available for the next bump.

**Opting the demo Book in is an owner action, not a branch change** (owner call, 2026-09-10, and the one decision this branch could not carry out). `content/` is a frozen mirror of the backend's published catalog — `scripts/export-content.ts` writes it, and it is never hand-edited — so the flag has to be published on the live `topic:demo` document and the seed re-exported. Hand-editing the seed would leave it disagreeing with the catalog: bump `seed-versions.json` to match and `planUpdate`'s `published_version !== cached` fires a content update on the first boot of every fresh install (the exact bug that file was added to stop), and leave it alone and a fresh install silently gets a different demo Book from one that ever refreshes.

What this branch does instead is prove the opt-in is safe before anyone publishes it: `generatedExercises.test.ts` loads the shipped seed from disk, ticks the flag, and plays all three units to completion — and pins what the Book actually gains, which is smaller and more pointed than "generation fills the ladder" sounds. Nothing is gained where a floor bites (`dx-unit-make-your-own` holds three concepts, one short of class (g)/(r)'s MCQ floor) or where an author already covered the rung. What is left is exactly the index rot the Purpose describes: `dx-con-scent-mound` carries an `imageRef` the `picture` task never named, and the two sentences each lack the presentations the *other* one's task happened to author — `dx-item-sentence-gnaw` gains `matching`, `recall` and `scramble`, `dx-item-sentence-breath` gains `build`, `matching` and `recall`. Plan 0002 stays satisfied either way: §3 keeps the demo's full authored set, so all eleven types remain demonstrable and generation only fills.

Not browser-verified in the app itself, and left that way by owner call (2026-09-10) — `apps/web:verify` is the owner's pass to run — the coverage grid was rendered and screenshotted in both themes against the real stylesheet (which is what caught a `display: block` on a `td` collapsing the grid into one column, and the ten rungs not fitting a 400px screen), and its behaviour is covered by `UnitScreen.exercises.test.tsx`. An `apps/web:verify` pass through the editor is still worth doing.

## Open questions

1. ~~**The budget number.**~~ **Closed 2026-09-07 by the amendment.** There is no generated set to size. 0025 §6 fixes session length at word count × the Progression preset, and that is already a setting in `bb.learning`, which is where this question was heading anyway.
2. ~~**Matching board chunking.**~~ **Closed 2026-09-10 by the implementation** (see note 3). There is no partition to pick: construction builds a board for one word at draw time, so the only decision is which siblings join it — the unit's same-kind items in authored order, capped at five. The question was sharp against the retired "a task set for a unit" reading, which the amendment had already removed.
3. ~~**Does opting a Book in change session length noticeably?**~~ **Closed 2026-09-07 by the amendment.** It cannot: length comes from 0025 §6's word count × preset, not from how many exercises exist. Opting in changes *which* exercise fills a slot, never how many slots there are. The original worry was real against the "authored ∪ generated" reading of slice 2, which the amendment removes.
4. **Where a hand-picked distractor set for a _lexeme_ lives.** Raised by the 0027 design, 2026-09-07, and not answered by either plan. Authored wrong answers are item data (§3), and plan 0027's `question` item is the natural home — but a `question` item is its own scheduling unit, so суу-the-word and суу-the-question would carry separate SRS state and both come due, breaking plan 0006's "one word, one SRS state". The minimal shape is probably an optional link letting an authored question grade an **existing** scheduling unit instead of minting its own. Nothing above depends on it; it is the one real gap the amendment opened.
5. **Do constructed exercises need `instructions` per domain?** A per-type constant reads worse than the seed's current copy (§3). A per-domain override table is cheap; a per-task one re-invents the field this plan is removing. **Still open** — nothing shipped in slices 1–5 touches copy, so a constructed exercise takes whatever its builder already produces.
6. **Does 0025 §10 survive?** Most of its wizard dissolves into §8's preview. The part that does not is the cloze-blank suggester — but that authors *item* markup, not tasks, so it may belong with the editor work rather than with either plan.
