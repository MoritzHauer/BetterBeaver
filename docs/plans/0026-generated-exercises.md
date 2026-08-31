# Plan 0026: Generated exercises

Status: **drafted** · Owner: Moe · Date: 2026-08-31 · Prerequisite: [plan 0025](0025-progression-engine.md) (generation is only principled once exercises carry a level) · Origin: owner proposal, 2026-08-31 — "remove all standard exercise questions and just let them be generated based on the content; specific task creation should still be possible"

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

Pure function over content: unit items (kinds, asset refs, cloze markup) + the domain lexicon + 0025's exercise level table + optional targets (§5) + a question budget → a task set. No `Rng`; shuffling stays where it is, in session building.

Its objective is **per-item level coverage**, not per-type presence — the distinction that keeps it from maximising:

- Every item is reachable across the level range, not clustered at one end: something at the recognition end, something at the production end, and the middle where its kind allows. Two exercises at the same level gain nothing, since 0025 §4 draws one of them anyway.
- One task per type per unit, so the knob is which types, not how many.
- Redundant levels collapse: two exercises sharing a level are interchangeable to the draw — generate one, not both.
- The budget is counted in **questions** (`countUnitQuestions`), not tasks, because that is what the learner experiences. Plan 0011's review already named question-count inflation; the restraint that answered it lives today as a prose guideline in the `/ingest` skill, which a generator either encodes or industrialises.
- Floors are **gates, not errors**: a unit with three same-kind items simply does not get an MCQ (§7).

Of these, the two with actual evidence behind them are 0025's comprehension-before-production ordering and spacing; the rest are defensible design heuristics and are labelled as such rather than dressed up as findings.

### 2. Generated task ids are derived and stable

`${unit.id}::${type}`, plus `::${n}` for a chunked matching board. Precedent and safety both exist: derived scheduling-unit ids already use `::`, and `slugPattern` forbids `:`, so a generated id can never collide with an authored one (plan 0002's argument, reused).

Stability matters because `buildUnitSession` returns `{question, taskId}` pairs that drive `onTaskAnswered` and the question screen's ✎ route. Pinning is unaffected — it has stored scheduling-unit ids, not task ids, since 2026-07-25. Completion is the one real dependency, and §4 removes it.

### 3. Authored tasks win, per type

`unit.taskIds` keeps working exactly as today. Where a unit authors a task of type T, generation of T for that unit is suppressed; every other type still generates.

Per-type rather than all-or-nothing on purpose: an author who wants one specific matching board — five deliberately confusable words rather than five arbitrary ones — should not lose generation for everything else as the price. The demo Book keeps its full authored set, because proving all eleven types remain playable is its job (plan 0002, still normative).

`instructions` survives on authored tasks. Generated tasks take a per-type constant, which is a small copy regression: "Pick the fact that matches each term" reads better than a generic string, and only the override buys it back.

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

### 7. Validation: errors become gates, and one new error appears

Classes (e), (f), (o), (g)/(r), (p), (q) and (n) are all task-shaped. For an authored task every one of them still applies, unchanged. For a generated set they become **generator preconditions** — the generator cannot emit a task that violates them, so the condition is unrepresentable rather than validated. That is strictly the better shape, and it is the same argument 0021 §9 already made for the Exercises page.

The cost is that a content problem goes quiet. Today "your unit has three items, so this MCQ is invalid" fails the build; generated, it is a silently missing exercise. Two compensating controls, and they are load-bearing rather than nice-to-have:

1. **Per-item level coverage is promoted to required.** An author has to be able to see the highest level a unit's content can actually reach — and which words no exercise reaches at all — or the silence is the whole experience.
2. **A new error class: a unit item that no exercise — generated or authored — reaches at all.** This is exactly the rot described in the Purpose, and generation is what finally makes it checkable: before, "in no task" was a legitimate authoring choice; now it means the item is unreachable.

### 8. Where the author sees it

0021 §9's Exercises page stops being a list of things to add and becomes a **preview with overrides**: what will be generated, with the highest level each item can reach; and a control to pin an authored task where the generated one is not what you want. The wizard sketched in the ladder plan's first draft largely dissolves here — with nothing to keep in sync, there is nothing to recommend, only budget and targets to tune.

Generated tasks appear in Preview but **not in Diff**: they are derived from content already in the diff, so showing them would double-count every item change as an exercise change too.

### 9. Schema version — why phase 1 is free and phase 2 is not

The tempting claim is that this is all additive. It is not, and the trap is worth writing down: making `unit.taskIds` **optional** is additive for a *reader*, but the moment a document actually omits it, every older client rejects that document — its zod schema still requires the field, and class (i) ("a unit with zero tasks") would reject `taskIds: []` as well. Learner clients run the validator per Book, so the failure is total, not cosmetic.

So the plan splits:

- **Phase 1 — supplement, no bump.** `taskIds` stays required and every document keeps its authored list. The generator runs as a *supplement*: it produces the exercises a unit does not already author. Opt-in per Book through one additive optional flag on the Book document, so no shipped content changes behaviour until its author ticks it. This is genuinely additive — no `CONTENT_SCHEMA_VERSION` bump, no republish, private Books untouched — and it already delivers guaranteed coverage, the end of index rot, and item targets.
- **Phase 2 — replace, and take the bump.** `taskIds` becomes optional and content stops listing tasks. This bumps `CONTENT_SCHEMA_VERSION`, which is precisely what the bump procedure is for (0012 §8: old apps keep cached content, old editors are refused, a reload beats a migration framework). Existing private Books all carry `taskIds` and keep parsing, so 0017 decision 5 is satisfied without a local migration.

**The free ride is already gone.** Plan 0023's `components` reshape took `CONTENT_SCHEMA_VERSION` 1 → 2, and §7 republished `domain:ky` at version 2 on 2026-08-30 — so phase 2 would be a standalone 2 → 3 and pays its own rollout wait. That is an argument for phase 1 carrying its weight alone (it does: coverage, the end of index rot, and item targets, all without touching a document), and for phase 2 waiting until another bump-worthy change wants to travel with it.

## Slices

1. **The generator** (`packages/engine`, pure) + the coverage query. Nothing consumes it yet beyond tests: same content in, same task set out, floors respected, budget respected.
2. **Supplement mode**, opt-in per Book — unit sessions become authored ∪ generated-for-missing-types, with 0025's ceiling draw choosing each question. The opt-in flag is what keeps this from silently lengthening every existing unit's session on the day it ships.
3. **Completion moves to items** (§4) with the legacy grandfather. Independent of 1–2 and worth landing on its own: it fixes the one-of-five bug today.
4. **Item targets** (§5) — the optional map, the validator rule, generation reading it.
5. **Exercises page becomes preview + override** (§8), including the promoted coverage display and the new unreachable-item error (§7).
6. **Phase 2** — `taskIds` optional, the version bump, and a content pass that drops the authored lists from Books that want generation. Only after 1–5 have proven out, and ideally riding 0023's bump.

## Done-criteria

- A unit with items and zero authored tasks produces a full, ladder-ordered session.
- Adding an item to a unit puts it in the session with no other edit.
- A unit authoring one `matching` task gets that board and generated everything else.
- Answering one question of a five-item unit no longer marks the unit complete; a unit completed under the old rule stays complete after upgrading.
- A unit item that no exercise reaches is a validation error.
- Phase 1: `pnpm check` green, no `CONTENT_SCHEMA_VERSION` change, no content edited, every existing Book behaves exactly as before until opted in.

## Open questions

1. **The budget number.** Questions per unit session is currently whatever content happens to author. Picking a target changes every generated unit at once, and it interacts with 0022's review-pace setting — possibly it belongs in `bb.learning` beside it.
2. **Matching board chunking.** A 12-item unit needs boards of 4, 5, or 3+4+5; the rule is arbitrary and visible. Deliberate groupings are exactly what §3's override exists for, but the default still has to pick something.
3. **Does opting a Book in change session length noticeably?** A unit that authored three types would gain five. The budget should absorb it; that needs measuring on the live Kyrgyz Book before phase 2, not reasoning about.
4. **Do generated tasks need `instructions` per domain?** A per-type constant reads worse than the seed's current copy (§3). A per-domain override table is cheap; a per-task one re-invents the field this plan is removing.
5. **Does 0025 §10 survive?** Most of its wizard dissolves into §8's preview. The part that does not is the cloze-blank suggester — but that authors *item* markup, not tasks, so it may belong with the editor work rather than with either plan.
