# Plan 0025: The progression engine

Status: **designed** · Owner: Moe · Date: 2026-08-31 · Pinned by an owner grilling (2026-08-31, 11 questions) that replaced the plan's original premise · **Supersedes [plan 0022](0022-scheduling-and-review-flow.md)** (its interval ladder, its Again semantics and its scheduler choice) · Prerequisite for [plan 0026](0026-generated-exercises.md); re-points [plan 0024](0024-focus-mode.md) §2

## Purpose

The app knows how well a learner remembers a word — that is `SrsState` — and nothing else about them. It does not know **what they can do with it**. Recognising `суу` in a list of four and typing it from the English prompt are different abilities acquired weeks apart, and today both are the same card.

The consequence is visible in three unrelated places, each solved by hand:

- `buildUnitSession` pools a unit's tasks and shuffles them once, so a first encounter can be dictation.
- Plan 0022 §6 hard-codes `SENTENCE_REVIEW_TASK_TYPES = ["build", "scramble", "dictation"]`, with the reasoning in a comment: production beats flashcard beats MCQ.
- Plan 0024 §2 hard-codes a second, different ordering — `recognize` → `listen` → `recall` — for the Focus drill.

Three hand-rolled difficulty judgements, none of them shared, none of them written down as data.

This plan gives every word **one number** — its level, 0 to 10 — which answers all three questions at once: how hard the next question about it should be, how long until it comes back, and how far along the learner is. Difficulty climbs first, intervals stretch after.

## Glossary

The terms this plan uses, and the ones it retires.

| Term | What it is | Range | Notes |
| --- | --- | --- | --- |
| **Exercise level** | How hard an exercise type is. A fixed property of the type, identical for every learner and every Book. | 1–10 | Constant table, §2. `shadowing` is unranked — nothing checks the answer. |
| **Word level** | How far this learner has taken this word. Deliberately the same scale: a word at level 6 is asked exercises up to level 6. | 0–10 | Stored, one per scheduling unit. Replaces `SrsState.reps`. |
| **Scheduling unit** | The thing progress is stored against — one word, one cloze blank, one note. Not the same as an item: a 3-blank sentence is 4 scheduling units. | — | Unchanged, plan 0002. |
| **Interval** | Days until the word is due again. Read from the level. | 1–365 | §3. |
| ~~rung~~ | Plan 0022's position on the interval ladder. | — | **Retired** — the word level replaces it. |
| ~~rank~~ | This plan's earlier name for exercise level. | — | **Retired** — it read as a synonym of "rung" and was the single most confusing thing in the draft. |
| ~~band~~ | Groups of levels (A/B/C) used to sort a session. | — | **Retired** — sorting a session into fixed blocks is itself "always the same order" (§4). |

## Goals

- One stored number per word drives difficulty, interval and progress display.
- Exercises get harder as the learner succeeds, and easier when they fail, with no cliff.
- A word is practised **more than once inside its first session**, at rising difficulty, without the session length becoming unpredictable.
- The same word does not come back as the same exercise every time.
- How fast the whole thing moves is a setting.
- The two abilities the owner named that no exercise currently tests — *pick the foreign word for an English prompt*, and *type the foreign word* — become playable on already-published content (§9).
- A learner with only a Russian keyboard can type ң, ө and ү, which today they cannot (§10).

## Non-goals

- **No second scheduler.** Classic SM-2 is removed, not kept alongside (§11). One model.
- **No new task type**, and no content re-authoring for the two new exercises — both are derived from what units already have (§9).
- **No adaptive engine beyond the level.** The level table is a constant, the same for everyone; the only personalisation is the level itself and the speed preset. Same boundary plans 0016, 0020 and 0022 §7 each drew.
- **No ASR** (plan 0002, unchanged). `shadowing` stays outside the level scale.
- **No mastery gate on navigation.** Mastery is displayed, never enforced (§8).

## Design

### 1. One number per word

`SrsState` today is `{ due, intervalDays, ease, reps }`. After this plan:

- **`reps` becomes the word level**, 0–10. It already carried plan 0022's rung, so the field survives; its meaning widens from "how long until this comes back" to "how far along is this word", and the interval is read from it.
- **`due` and `intervalDays` are written from the level** via the table in §3, exactly as they are written from the rung today.
- **`ease` becomes genuinely dead.** It stays in the type so that older exports still import, and nothing reads it. (Under plan 0022 it was inert-but-load-bearing, because it kept SM-2 losslessly selectable; §11 removes the thing it was preserved for.)
- **One new field: `levelDay`** — the UTC day the level last advanced, which is what makes the day guard in §5 possible. It is the only genuinely new state in this plan, it rides the existing `bb.*` backup sweep, and an absent value reads as "never", so no migration is needed for cards that predate it.

### 2. The exercise level table

Low is easy. Ties are deliberate — two exercises at the same level are equally hard and differ only in modality, which is what lets a Book with no audio simply have fewer options rather than a broken ladder.

<!-- prettier-ignore -->
| Level | Exercise | What the learner does | Checked |
| --- | --- | --- | --- |
| — | `shadowing` | hear it, say it, reveal the transcript | **no** — unranked |
| 1 | `matching` | board of N prompts and N answers, both sides visible | auto |
| 2 | `recognize` · comprehend | see the foreign word → pick the meaning | auto |
| 3 | `listen` | hear it → pick the meaning | auto |
| 3 | `minimal-pair` | hear one clip → pick which of two it was | auto |
| 4 | `recognize` · **produce** | see the meaning → pick the foreign word | auto |
| 4 | `picture` | see the image → pick the foreign word | auto |
| 5 | `scramble` | reorder the sentence's own tokens | auto |
| 6 | `build` | order tokens from a bank containing distractors | auto |
| 7 | `cloze` | type the missing word into the sentence | auto |
| 8 | `recall` | see the meaning, produce it, reveal, self-grade | self |
| 9 | `write` · **produce** | see the meaning → type the foreign word | auto |
| 10 | `dictation` | hear the sentence → type it whole | auto |

Three placements carry their own justification:

- **`matching` below `recognize`.** A five-pair board shows every answer at once and clears correct pairs, so elimination carries the last pair for free. A four-option MCQ never gets easier as it goes.
- **`recall` below `write`.** Both are free production from the meaning side; `write` adds orthography and, more importantly, is *checked*, where `recall` grades whatever the learner says it graded. At equal demand, prefer the checked exercise.
- **`shadowing` is unranked.** Nothing verifies the answer, so it can neither be a level nor confirm one — plan 0022 §6's argument, generalised. It stays available as exposure and is never chosen to advance a level.

**`picture` moves to the production direction** (image → the foreign word). Today its choices are display texts, so "see the image → pick the English gloss" involves no foreign form anywhere and tests nothing about the language.

### 3. The level table: interval, and the speed preset

The level indexes the interval. Difficulty climbs through the first four levels while the word is still being met daily; spacing takes over once it can be produced.

<!-- prettier-ignore -->
| Word level | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Days until due (Balanced) | — | 1 | 1 | 1 | 2 | 5 | 8 | 15 | 30 | 90 | 365 |
| Progress credit | 0% | 10% | 20% | 30% | 40% | 50% | 60% | 70% | 80% | 90% | 100% |

`REVIEW_PACES` survives as the interval row, widened from 7 entries to 11, keeping its three presets (Thorough / Balanced / Light). A second preset joins it — **Progression speed** — which sets how many correct answers a word needs per session (§6) and whether a clean streak may advance two levels in a day instead of one: Careful 3 / Normal 2 / Fast 1.

**The honest cost:** a new word is now due on days 1, 2, 3 and 5 before spacing begins, where plan 0022 sent it to day 6 after a single correct answer. That is roughly three times the contact in the first week — which is the point for acquisition, and also a materially larger daily queue while a Book is being learned. Thorough and Light shift the whole row; the Progression preset shifts how fast the level climbs into it.

### 4. Choosing the exercise: one repetition, one stretch

Each appearance of a word in a session fills one of two slots:

- **Repetition, early** — drawn at random from `{level − 1, level}`, clamped to at least 1: a level the word has already passed.
- **New attempt, later** — exactly `level + 1`. Getting this right is the only thing that advances the level.

<!-- prettier-ignore -->
| Session | Level at start | Early slot | Later slot | Level after |
| --- | --- | --- | --- | --- |
| 1 | 0 — new word | — | 1, then 2, then 3 | 3 |
| 2 | 3 | random of {2, 3} | 4 | 4 |
| 3 | 4 | random of {3, 4} | 5 | 5 |

This replaces the weighted draw over everything at or below a ceiling, and it is better on three counts. **Advancement becomes unambiguous** — the level rises if and only if the `level + 1` exercise was answered correctly, rather than depending on which exercise a draw happened to produce. **The learner gets a win before the stretch**, which weighting only approximated. And the repetitions stop being arbitrary: one consolidates, one advances. Variety survives, because the early slot is random within its window and levels 3 and 4 each hold two exercises.

Four rules complete it:

- **A brand-new word runs the bottom levels in its first session** — 1, then 2, then 3 — rather than taking three sessions to become recognisable. This is why the day guard starts where it does (§5).
- **A missing level is skipped, not waited for.** If `level + 1` has no exercise the content can build — level 3 is `listen`, and no Book has recordings — the new attempt goes to the next level that does. This is what keeps every level reachable, and 100% attainable, on content with gaps.
- **A failed repetition cancels the stretch.** The later slot becomes a second repetition instead. Pushing a learner who has just shown they are shaky is how a session goes bad.
- **Daily Review has one slot, so it draws from `{level, level + 1}`** — sometimes consolidation, sometimes progression, and it keeps its variety without becoming a drill.

### 5. Advancing, and falling back

**Up, at most one level per UTC day — from level 4 onwards.** A correct answer at the new-attempt slot advances the level; `levelDay` records the day, and a second advance that day is refused.

**Levels 1–3 are exempt, and the exemption is the point.** They are `matching`, `recognize` and `listen` — every one of them recognition, with the answer on screen. Recognising a word met a minute ago is a legitimate outcome of meeting it, so a new word climbs to level 3 in its first sitting (§4). The guard exists to stop a word reaching *production* on the strength of short-term memory, and production starts at level 4 — pick the foreign word — so that is where the guard starts.

Above that the codebase has met this problem twice and answered it the same way both times: plan 0022's practice-only rule advances a rung at most once per day, and plan 0024's graduation counts three separate *days* "because the thing being tested is overnight retention".

**Down, two levels, floored at 0.** A wrong answer costs two levels. More than Hard's one step, far less than a reset — and the word's interval drops with it, so a failure at level 8 comes back in 8 days at level 6 rather than in 30.

**Again's cliff and its requeue are both removed** (§11).

### 6. The session engine

Plan 0024's `drill.ts` becomes the shared session engine rather than a Focus-mode-only module: a queue that is asked for the next question and told how the answer went, instead of a fixed array built up front. `buildUnitSession` and `buildAdhocSession` become configurations of it.

**Length is known before the session starts.** Each word gets a fixed number of repetitions — the Progression preset's 3 / 2 / 1 — so a five-word unit at Normal is ten questions, computable from content exactly as `countUnitQuestions` does today. Plan 0011's decision that the unit card shows a real question count survives intact.

**The remaining counter decrements only on a correct answer.** A wrong answer re-queues the word at an expanding gap (2, then 5, then 10 cards — plan 0024's rule, which exists so the learner is not re-asked a card whose answer is still on screen) and comes back **one level lower**, so they get a win before being pushed again. The count stalls rather than growing: "10 to go" always means ten correct answers to go, and a struggling session never reads as getting longer.

**Difficulty rises inside the session** by construction: the early slot sits at or just below the word's level and the later slot one above it (§4). A new word therefore climbs `matching` → `recognize` → `listen` in one sitting, and an established word gets one consolidation and one stretch.

**A cap ends a session that will not finish**: 8 × word count, after which the summary names the words that did not get there.

Two consumers, same loop, different configuration:

- **Unit practice** — the unit's words, repetitions from the preset.
- **Focus drill** (plan 0024) — a hand-picked set, mastery 3, plus its daily-due clamp and graduation, which stay Focus-specific. **Its §2 rotation table is deleted** and replaced by §4's draw; shipping a hardcoded `recognize → listen → recall` that this plan immediately removes would be waste.

**Review is not a drill.** It stays one card per due scheduling unit, interleaved across the domain (plan 0022 §7's finding, unchanged) — it reads the level to choose the exercise and nothing more.

### 7. What review asks

The word's level picks the exercise by §4's draw, with one floor: **review never asks an exercise weaker than the one it uses today.** A due lexeme at a low level is not dropped to an MCQ, because plan 0022 §6 established that MCQ is weaker retrieval than the recall card it currently gets.

A due cloze blank and a due `pair` keep their own single question — a cloze question grades the *blank's* scheduling unit (`blankUnitId`), so it can never stand in for the sentence's own card without leaving that card ungraded and permanently due.

### 8. Progress, completion, and locks

Three different facts, currently blurred into one, now separated:

- **The unit progress bar is a percentage: the mean word level × 10.** A word at level 3 contributes 30%, a word at level 10 contributes 100%. It moves from the first session and keeps moving for weeks, and because §4 makes every level reachable on any content, 100% is always attainable.
- **Completion** — "you have been through this unit" — is **every word at level ≥ 1**, i.e. answered correctly at least once. This is stricter than today's rule, which counts a *wrong* answer as an attempt and marks a whole five-item task attempted after a single question. It replaces the persisted attempted-task set (see plan 0026 §4, which this supersedes in its details).
- **Locks are removed by default.** A learner starts any lesson or unit whenever they want. `isUnitUnlocked` already returns true for a unit with no `unlocksAfterUnitId`, so the mechanism is unchanged — what changes is that **content stops authoring the chain**, and a maintainer sets a prerequisite only where an earlier unit genuinely must come first. Where one is set, the gate is the completion rule above.

Mastery is never a gate. A unit read as complete at 40% is telling the truth twice: you have been through it, and you are not done with it.

### 9. Two new exercises, derived from existing content

Levels 4 and 9 do not exist today, and neither needs a new task type, an authoring step, or a `CONTENT_SCHEMA_VERSION` bump:

- **`recognize` · produce** — prompt is `itemDisplayText`, choices are `recognizePrompt` over the same distractor pool `sampleMcq` samples now. It is a `RecognizeQuestion` with different strings, so `SessionScreen` needs no new component.
- **`write`** — prompt is `itemDisplayText`, target is `recognizePrompt`, checked with the existing `checkTypedAnswer`. The interaction is the cloze/dictation text input with a different label. **Lexemes and concepts only**: typing a whole sentence from its translation is dictation without the audio, and belongs at level 10 if anywhere.

Both work on the live Kyrgyz Book as it stands and on private Books, which have no republish path at all (plan 0017 decision 5). Plan 0002 line 54's claim that direction is "a presentation detail already covered" was never true — every MCQ in the app runs one way.

**The duplicate-prompt hazard is a runtime gate, not a validator class.** Two items sharing a `script` but differing in gloss make a produce-direction MCQ ambiguous — for the prompt "beautiful", both кооз and сулуу are defensible answers. Class (h) only guarantees distinct *display* texts, so published content has never been checked on the prompt side. Adding a validator class would retroactively invalidate live Books, and a Book that fails validation is excluded and surfaced to the learner as broken. So the engine **skips the produce direction** for an item whose prompt text is not unique among its unit's same-kind items, exactly as it skips an exercise whose assets are missing.

### 10. The three letters a Russian keyboard doesn't have

Plan 0002 left this open — "whether Kyrgyz cloze/dictation needs an input-method note or on-screen keyboard is decided when the first Kyrgyz sentence unit is authored". Those units exist now.

**Strict script, no transliteration fallback, plus an app-provided key row.** The Russian layout is what learners have; the Kyrgyz alphabet is that layout's 33 letters plus exactly three it cannot produce — **ң, ө, ү**.

**This is a live defect, not a cost of level 9.** `cloze` and `dictation` already ship and are already graded against the exact script, so any Kyrgyz blank or dictation target containing one of the three is unanswerable today: the learner cannot type a correct answer, and the grader marks them wrong for it.

`domainSchema` gains an **optional `extraChars: string[]`** — additive, dropped by non-strict parsing on older clients, so no schema-version bump. Where set, the shared typed-input component renders those characters as ≥44px keys above the field, inserting at the caret without dismissing the keyboard. Absent, no row. Turkish would declare `ğ ı ş ç ö ü`, German `ä ö ü ß`, a maths domain `≤ ∈ ∀`. Deriving the list was rejected: it needs a per-language model of what a keyboard already produces, and frequency cannot isolate the three (ө and ү are everywhere in Kyrgyz — vowel harmony), which is the tier-3 domain-specific code plan 0023 §9 refuses. The list is tier 1 content; the key row is tier 2 capability.

**The platform keyboard is the real fix, so the row defaults to off.** Gboard supports Kyrgyz and ships on every Play-certified Android device; iOS is unconfirmed and may need a third-party keyboard (Gboard or Keyman), which is a bigger ask because of Apple's "Allow Full Access" prompt. A learner who adds the layout needs no row at all, and three keys under every typed answer is clutter for them. So the app ships a **keyboard setup card** — shown when the domain declares `extraChars`, per-platform steps from the user agent, dismissible, re-openable from Settings — and the key row becomes a **Settings toggle, default off**, offered by that card as the fallback for anyone who cannot or will not install a layout.

The fallback stays because the walkthrough can fail invisibly: nothing lets the app detect whether a layout was actually added, iOS may not offer one natively, and managed or Play-less devices (Huawei post-2019, work phones, some regional ROMs) can block the whole path. The card is data-driven rather than Kyrgyz-specific for the same reason the list is: `extraChars` already means "this script needs characters your keyboard may not have".

**Not authored as content.** The walkthrough cannot be a note: every note in a unit is a scheduling unit, so it would come back in Daily Review as a flashcard forever — and a note-only unit fails validator class (i) anyway. See §13, which removes the first half of that problem for every note.

**No folding, ever.** `normalizeTypedInput` must never map ң → н or ө → о: they are distinct letters and the distinction is what is being taught. All three are precomposed codepoints (U+04A3, U+04E9, U+04AF), so NFC does not decompose them and today's normalization is already correct — the rule is written down so a future "this is too hard to type" report is not fixed by adding a fold. The right answer to a near-miss is presentational: highlight the differing characters in the reveal.

### 11. What this supersedes, and how cards migrate

Plan 0022 shipped on 2026-08-12 and this plan replaces three of its decisions. Recording that deliberately, rather than discovering it during implementation:

- **Its interval ladder** becomes the interval row of the level table (§3). Same three paces, widened to 11 entries.
- **Again's reset to rung 0 is removed** — failure steps back two levels (§5). A cliff is not compatible with a level that also means "what can you do with this word".
- **Again's same-session requeue (§4) is removed** — §6's expanding-gap requeue supersedes it, works in every session type rather than Daily Review only, and comes back at a lower level.
- **Classic SM-2 is removed as an option.** The level carries difficulty *and* timing; SM-2 computes intervals and has no concept of difficulty, so under it half the model would be undefined. Keeping a second scheduler that cannot express the model is dead weight every future change must reason about. `SchedulerKind`, the setting and the branch all go.

**The Again *button* stays.** A learner who drew a blank needs somewhere to say so, `recallQuality("again")` is still quality 2, and pinning a note grades it `again` internally to make it due immediately (`App.tsx:2173`) — removing the grade would break that.

**Migration is by interval, and nobody's schedule jumps.** A card's current `intervalDays` is looked up in the new table and its level becomes the closest matching entry: a card at 30 days becomes level 8, one at 1 day becomes level 1. This holds for cards written by either old scheduler, since both wrote `intervalDays`. `levelDay` is absent, so the first correct answer after upgrading may advance a level immediately — which is correct: it is a new day.

### 12. Settings

The Learning section keeps its shape and swaps one row:

| Setting | Status |
| --- | --- |
| Review pace (Thorough / Balanced / Light) | kept, rows widened to 11 |
| **Progression speed (Careful / Normal / Fast)** | **new** — repetitions per word, and whether a streak advances two levels in a day |
| Skip length (week / month / year) | unchanged |
| ~~Scheduler (Ladder / Classic SM-2)~~ | **removed** (§11) |

Still one `bb.learning` key, still global by force — design.md pins "one word = one SRS state across topics", so a per-Book progression would write contradictory levels into one lexeme's single state.

### 13. Notes leave the review queue

Every note in a unit is a scheduling unit today (plan 0008 §7), so a unit's theory comes back in Daily Review as a self-graded flashcard forever. That is wrong for the same reason the keyboard walkthrough must not be a note: theory is reference material, read when it is needed, not a card to be drilled.

**Notes stop entering the due queue.** A note reaches review only when the learner **pins** it — which is already the mechanism, since pinning a note grades it `again` so that it becomes due immediately (`App.tsx:2173`). Pin's meaning widens for notes only, from "show me this first" to "include this at all".

- **Nothing to migrate.** Existing note SRS state stays where it is and is simply no longer read for queueing; a learner who wants a note back pins it.
- **This closes open question 3.** Notes are not part of progression, so they do not weight the unit's percentage bar either — §8's bar is the mean level of a unit's *words*.
- **Completion is unaffected** — §8 already counts items, not notes.

## Slices

1. **Extra-key row** (§10) — optional `domain.extraChars`, the key row on the shared typed input, a test pinning that ң ≠ н. Independent of everything else here and fixes shipped content; land it first. Inert until a domain sets the field.
2. **The exercise level table** (§2) — exhaustive over `TaskType` so a new type cannot compile without a level. `picture` flips direction. No behaviour change yet.
3. **Word level replaces the rung** (§1, §3, §5, §11) — the level table, advance/fall-back rules, the day guard, Again's cliff and requeue removed, SM-2 removed, migration by interval. The scheduler slice; touches `packages/srs` and Settings.
4. **The session engine** (§6) — `drill.ts` generalised, `buildUnitSession` on top of it, fixed repetitions, the stalling counter, the expanding-gap requeue, the cap.
5. **The ceiling draw** (§4) — exercise selection by level with the weighted random draw, replacing every fixed ordering; review's floor (§7).
6. **The two derived exercises** (§9) — produce-direction MCQ and `write`, with the duplicate-prompt runtime gate. Depends on slice 1 for `write`.
7. **Progress, completion and locks** (§8) — the percentage bar, completion at level ≥ 1, and the content pass that drops the authored unlock chain.
8. **Re-point Focus mode** (plan 0024 §2) — delete its rotation table, call the draw.
9. **Keyboard setup card + row off by default** (§10) — the per-platform card gated on `extraChars`, the Settings toggle, and the card's offer of the row as fallback. Depends on slice 1 only.
10. **Notes leave the review queue** (§13) — pin becomes the opt-in; notes drop out of the bar. Independent of everything else here.

## Done-criteria

- A word's level is one stored number, and the unit bar reads the mean of it as a percentage that reaches 100% on a Book with no audio.
- A new word reaches level 3 in its first session; a word at level 4 or above cannot gain more than one level in a day (two on Fast with a streak), however many times it is answered.
- A wrong answer at level 8 leaves the word at level 6, due in 8 days — never at level 0.
- The same word, appearing twice in a session, is asked one exercise at or below its level and one above it, and the first of those varies between sessions.
- Session length is shown before the session starts and never grows during it.
- On the live Kyrgyz Book, with no content edit: an English prompt with Kyrgyz options is playable, and typing a word from its English prompt is playable and auto-graded.
- A Kyrgyz cloze blank containing ң/ө/ү can be answered correctly on a device with only a Russian keyboard, and ң typed as н is still wrong.
- The key row is absent until the learner turns it on, and the setup card appears only for a domain that declares `extraChars`.
- A unit's notes never appear in Daily Review unless pinned.
- Every existing card keeps its due date across the migration.
- `pnpm check` green; no `CONTENT_SCHEMA_VERSION` change; one new `SrsState` field, covered by the existing `bb.*` backup sweep.

## Open questions

1. **Does the Fast preset's two-level streak jump need a floor on evidence?** Two levels a day means a word can reach `write` in five days. That may be right for a learner who is genuinely fast and wrong for one who is guessing well on four-option MCQs.
2. **What replaces the unit card's question count when a unit's words are at wildly different levels?** The count is computable, but "10 questions" over words at levels 1 and 9 describes two very different sittings.
3. **Who sets `extraChars` on the live Kyrgyz domain, and when?** It rides plan 0023's suffix-table content pass, which has not started.
4. **Does `minimal-pair` at level 3 make sense for a word that also has a `pair` item?** The pair is its own scheduling unit with its own level, so a word and its minimal pair climb independently — probably right, but untested against real content.
