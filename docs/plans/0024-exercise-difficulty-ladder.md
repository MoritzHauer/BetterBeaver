# Plan 0024: Exercise difficulty ladder

Status: **drafted** · Owner: Moe · Date: 2026-08-17 · Origin: owner feature idea, 2026-08-17 — "there should be a schema in which exercise type order the content is learned, from easy to hard: recognise the foreign word and click the single-choice English word; recognise the English word; sentence building; gap text; writing the word"

## Purpose

Eleven task types exist and **nothing in the codebase knows that one is harder than another**. `buildUnitSession` (`packages/engine/src/session.ts:564`) pools a unit's tasks and shuffles the lot once, so a learner meeting a word for the first time can be asked to type it from audio before ever having seen it in a multiple-choice list.

One difficulty judgement does exist, hard-coded: plan 0022 §6's `SENTENCE_REVIEW_TASK_TYPES` (`session.ts:644`) is a three-element list whose doc comment argues that build/scramble/dictation are *production* and therefore stronger than the recall card, while a sentence's recognize/listen/matching tasks are MCQ and therefore *weaker*. That comment is a difficulty table with one row and no name.

This plan makes the ordering **explicit data** — a fourth exhaustive table beside `TASK_ALLOWED_ITEM_KINDS` / `TASK_REQUIRED_ASSET` / `TASK_NEEDS_DISTRACTORS` (`packages/schema/src/entities.ts:408–458`) — and then uses it twice: to order a unit's own session easy → hard, and to let a maturing card climb into harder exercises as its 0022 rung rises. 0022 §6 stops being an exception and becomes one row of the table.

Two of the five rungs the owner named do not exist today. Both turn out to be **derivable from already-published content**, so neither adds a task type, an authoring step, or a `CONTENT_SCHEMA_VERSION` bump — see §3.

## Goals

- One ordered table of exercise *steps*, exhaustive over `TaskType`, so adding a task type forces a difficulty decision the way it already forces an item-kind and asset decision.
- A unit's practice session runs easy → hard instead of fully shuffled.
- A due card is reviewed with a harder exercise as it matures, capped by what its unit actually authored, and never below the retrieval strength review already gives it today.
- The owner's two missing steps — **pick the foreign word for an English prompt**, and **type the foreign word** — become playable on every Book that is already published, Kyrgyz included, with no content edit.
- A learner with only a Russian keyboard can type ң, ө and ү — which today they cannot, in exercises that already ship (§9).
- An author gets the ladder built for them where it is mechanical, and recommended where it is not (§10): a vocabulary unit reaches five of the ten ranks from one press.

## Non-goals

- **No new task type, and exactly one new authored field.** This is the constraint that shapes the whole design: every exercise below is derived from content that already exists. The single exception is §9's optional `domain.extraChars`, which is an input-method fact about a writing system, not content.
- **No generated content.** §10's wizard builds exercises over items the author already wrote; it never writes a sentence, a gloss or an example, and it never accepts a pedagogical choice on the author's behalf (plan 0007 decision 2). Plan 0017 decision 5 (schema stays additive for anything a private Book can contain) and 0015 §6a (only non-additive change bumps the schema version) both bite here, and derivation sidesteps both.
- **No per-task or per-Book difficulty override.** Rank is a property of the exercise, read from the table, never authored. An author who wants an easier unit authors easier tasks.
- **No adaptive engine.** The rung → band mapping is a constant, identical for every learner. Same boundary 0016, 0020 and 0022 §7 each drew: no recommendation, no "which unit needs work" prompt, no per-learner model.
- **No change to grading, to either scheduler, or to the outcome-list contract.** The ladder chooses *which exercise a card is shown as*; `applyGrade`, `recognizeQuality`, `recallQuality` and the day-granular due dates are untouched.
- **No change to Daily Review's interleaving.** 0022 §7 pins interleaved review as the stronger option; the ladder never groups the review queue by exercise type, it only picks each card's presentation.
- **No ASR** (plan 0002 non-goal, unchanged). `shadowing` checks nothing, so it sits outside the ladder entirely — the same reason 0022 §6 left it out.

## Design

### 1. Difficulty is two axes, collapsed into one rank

An exercise's retrieval demand is set by two things, and the app currently models neither:

- **Demand** — how much the learner has to generate. Recognition (choose from options shown) < assembly (arrange material that is all in front of you) < cued typing (produce the form, with context) < free production (produce the form, no context).
- **Direction** — comprehension (foreign form → meaning) or production (meaning → foreign form). Production is the harder half of the same pair: recognising `суу` as "water" is possible from a fragment of memory that could never produce `суу` from "water".

A third property, **modality** (read / listen), is *not* difficulty — it is a different skill. It gets a tag so that a Book with no audio simply has fewer steps rather than a broken ladder, and so a listening step is never treated as a substitute for the reading step at the same rank.

Every existing helper needed for the direction axis is already in `entities.ts`: `recognizePrompt` (`:345`) yields the foreign side (`script` / `term` / stripped `text`) and `itemDisplayText` (`:331`) yields the meaning side (`gloss` / `definition` / `translation`). Today every MCQ in the app runs one way — `sampleMcq` (`session.ts:182`) builds choices with `itemDisplayText` — so `recognize`, `listen`, `picture` and `matching` are all comprehension-direction. **The production direction is not a presentation detail already covered**, as plan 0002 line 54 claims; it was never built.

### 2. The ladder

Rank is an integer, low = easy. Ties are deliberate: two steps at the same rank are equally hard and differ only in modality.

<!-- prettier-ignore -->
| Rank | Step | What the learner does | Demand | Modality | Checked |
| --- | --- | --- | --- | --- | --- |
| — | `shadowing` | hear it, say it, reveal the transcript, self-grade | exposure | listen | **no** |
| 1 | `matching` | board of N prompts and N answers, both sides visible | recognition, answer set exposed | read | auto |
| 2 | `recognize` · comprehend | see the foreign word → pick the meaning | recognition | read | auto |
| 2 | `picture` | see the image → pick the meaning | recognition | read | auto |
| 3 | `listen` | hear it → pick the meaning | recognition, no orthography | listen | auto |
| 3 | `minimal-pair` | hear one clip → pick which of two it was | perceptual discrimination | listen | auto |
| 4 | `recognize` · **produce** | see the meaning → pick the foreign word | production, options given | read | auto |
| 5 | `scramble` | reorder the sentence's own tokens | assembly, every token needed | read | auto |
| 6 | `build` | order tokens from a bank containing distractors | assembly + interference | read | auto |
| 7 | `cloze` | type the missing word into the sentence | typed production, context + hint | read | auto |
| 8 | `recall` | see the meaning, produce it, reveal, self-grade | free production | read | self |
| 9 | `write` · **produce** | see the meaning → type the foreign word | free production, spelled | read | auto |
| 10 | `dictation` | hear the sentence → type it whole | free production + perception, sentence-length | listen | auto |

The owner's five-step sketch is ranks 2 → 4 → 5/6 → 7 → 9, with the other six types slotted around it. Three placements are worth their justification:

- **`matching` below `recognize`.** A 5-pair board shows every answer at once and clears correct pairs, so elimination carries the last pair for free; a 4-option MCQ never gets easier as it goes.
- **`recall` below `write`, not above it.** Both are free production from the meaning side. `write` adds orthography and, more importantly, is *checked* — `recall` grades whatever the learner says it graded. Where both are available the checked one is the real rung; where only `recall` is (no typed step for this item kind, or the learner can't type the script), it is the honest fallback. Tie-break rule: **at equal demand, prefer the checked step.**
- **`shadowing` has no rank at all.** Nothing verifies the answer, so it can neither confirm a rung nor be a rung. It stays in unit sessions as exposure and is never selected for review — exactly 0022 §6's argument, now general.

`picture` at rank 2 records an existing wart rather than endorsing it: its choices are display texts, so "see the image → pick the English gloss" involves no foreign form anywhere. With a direction axis in hand the fix is one line (produce-direction choices, i.e. image → the word), but it changes a shipped exercise's meaning, so it is an open question below, not a silent slice.

### 3. The two new steps are derived, not authored

This is the load-bearing move. Both new steps read fields every item already has:

**`recognize` · produce.** Prompt is `itemDisplayText(item)`, choices are `recognizePrompt(candidate)` over the same distractor pool `sampleMcq` samples today. `Question` gains no new kind — it is a `RecognizeQuestion` with different strings — so `SessionScreen` needs no new component and the outcome-list contract is untouched. Any authored `recognize` task can emit either direction.

**`write` · produce.** Prompt is `itemDisplayText(item)`, target is `recognizePrompt(item)`, checked with the existing `checkTypedAnswer` / `normalizeTypedInput`. The interaction is the cloze/dictation text input with a different label. Any authored `recall` task can emit it — same item kinds, same prompt side, so a unit that teaches a word by flashcard can test it by typing with zero authoring.

Consequences worth stating plainly:

- **No `CONTENT_SCHEMA_VERSION` bump, no republish, no editor change.** A new member of `TASK_TYPES` would be a non-additive change (an old client's zod parse rejects the whole document), and would need every Book re-authored to use it. Derivation costs neither.
- **It works on the live Kyrgyz Book as it stands**, and on private Books, which have no republish path at all (0017 decision 5).
- The price is that an author cannot *choose* to include or exclude the derived steps for one unit. Given the non-goal above (rank is not authored) that price is the design, not a defect — but it is the thing to revisit first if the ladder ever feels wrong on real content.

**Typing a script the learner's keyboard doesn't cover** — see §9. Owner call, 2026-08-17: strict script, no transliteration fallback, plus an app-provided extra-key row. That row is a prerequisite for rank 9 and a fix for exercises that already ship.

### 4. Bands, not a sorted list — how a unit session uses the ladder

`buildUnitSession` keeps its signature, its pooling and its one-shuffle-per-session rng. What changes: questions are grouped into three **bands** by rank, shuffled *within* a band, and concatenated ascending.

<!-- prettier-ignore -->
| Band | Ranks | Reads as |
| --- | --- | --- |
| A — meet it | 1–4 (+ unranked `shadowing`) | choose, discriminate, repeat |
| B — assemble it | 5–6 | put it together from given material |
| C — produce it | 7–10 | type it, say it, spell it |

Full rank-sorting was rejected: it turns every session into a visibly sorted list, and it over-fits — the difference between `matching` and `recognize` is real but small, and shuffling across it keeps the variety that made the pooled session (plan 0010) an improvement in the first place. Three bands give the owner's easy → hard shape at the granularity where the difference is actually felt.

Accepted cost, stated because it is the honest one: the hard third moves to the end of every unit session, so a learner who quits halfway never meets it. That is the same trade any progression makes, and the alternative — hard exercises up front — is what the app does today by accident.

**The unit session cannot see SRS state.** `buildUnitSession(unit, content, rng)` is pure over content, deliberately (plan 0002's engine API shapes), while review builders take `dueUnits` carrying scheduling state. So slice 1 orders what the unit authored and nothing more; the *climb* lives in review (§5). Concretely: the first pass through a unit stays comprehension-direction, and the produce-direction MCQ first appears on the return visit. That ordering is right on its own merits — comprehension before production — but it means the ladder does **not** show all five of the owner's steps inside one unit session. Whether a unit session should also mix in produce-direction questions is the first open question below.

**The ladder orders questions; it never adds any.** A `recognize` task over 5 items yields 5 questions before and after this plan. Emitting both directions per task would double every session, which is a different feature (more practice) wearing this one's clothes.

### 5. How a review uses the ladder

Replaces `sentenceExerciseQuestion`'s hard-coded three-type list with one rule over the table, for every item kind:

1. **Floor.** Start from the step review uses today for this scheduling unit — recall for lexeme/concept/plain sentence, the cloze question for a blank, minimal-pair for a pair. The ladder may climb from there; it may never go below it. This preserves 0022 §6's finding (an MCQ is *weaker* than the recall card, so reviewing a mature lexeme by MCQ is a downgrade) as a rule instead of an exception, and guarantees the plan cannot make any existing review easier than it is now.
2. **Ceiling from the rung.** The 0022 rung (`SrsState.reps`, rungs 0–6) maps to a band ceiling by constant table: rungs 0–1 → band A, 2–3 → band B, 4+ → band C. A card that has survived to a 90-day interval is asked to produce; a card that just reset to rung 0 drops back to its floor. Since Again resets the rung, **failing a hard exercise automatically returns the card to an easier one** — the progression self-corrects with no extra state.
3. **Availability.** Take the highest-ranked step at or below the ceiling that this item can actually produce: an authored task of that type in the item's unit, or a derived step from one (§3). Fall back down the table until something is available; the floor always is.

For a lexeme this reads: recall until rung 3, then `write` from rung 4. For a sentence it reproduces 0022 §6 (build/scramble/dictation, now rank-ordered rather than list-ordered) and adds `cloze` at the bottom of band C. A due cloze blank and a due pair keep their own single question — neither has anywhere to climb.

Plan 0016's "Remember: …" sessions sample authored tasks and stay untouched; Vocabulary's ad-hoc modes are learner-chosen and stay untouched (both are practice-only, so no rung exists to read).

### 6. What the validator gains

One class, mirroring one that already exists. Class **(h)** (`validate.ts:645`) rejects duplicate *display texts* per kind within a unit, because two identical MCQ choices make the question undecidable. The produce direction needs the mirror: duplicate **prompt-side** texts (`recognizePrompt`) per kind within a unit — two items sharing a `script` but differing in gloss would produce an unanswerable reversed MCQ. Class (p) already does exactly this check, but scoped to one matching task's items; this widens the same check to the unit, for units that can generate a production MCQ. Same loop, same `pair`-skip.

Nothing else changes: `TASK_ALLOWED_ITEM_KINDS`, `TASK_REQUIRED_ASSET` and `TASK_NEEDS_DISTRACTORS` all still hold for the derived steps, since a derived step reuses its parent task's item set and asset requirements.

### 7. No new state

- Rank lives in a constant table in `packages/schema`.
- The rung is `SrsState.reps`, already written by 0022's ladder.
- The rung → band map is a constant.
- Nothing is persisted, exported, imported or migrated. No `ProgressStore` method, no `bb.*` key, no `CONTENT_SCHEMA_VERSION` bump — §9's `extraChars` is optional and additive, so a client that doesn't know it parses the domain unchanged (0015 §6a), and §10 writes only ordinary tasks into an ordinary draft.

This matches the constraint every recent plan has held to (0022's "no new persisted state of any kind"), and it is why the plan can ship in small slices without a migration story.

### 8. Where the author sees it

0021 §9's Exercises page already offers only the task types a unit can support. It gains one read-only line: which bands this unit currently reaches — `Meet it ✓ · Assemble it ✓ · Produce it —` — so an author can see that a unit tops out at band A before a learner discovers it. Derived steps count, so a unit with a `recall` task already reaches band C. Presentation only; it gates nothing, and a unit that reaches one band stays valid.

### 9. The three letters a Russian keyboard doesn't have

Plan 0002 left this open — "whether Kyrgyz cloze/dictation needs an input-method note or on-screen keyboard is decided when the first Kyrgyz sentence unit is authored". Kyrgyz sentence units have since been authored, so this closes it.

**The answer is strict script — no transliteration fallback — plus an app-provided extra-key row.** The Russian layout is what learners have and is treated as mandatory; the Kyrgyz alphabet is that layout's 33 letters plus exactly three it cannot produce: **ң, ө, ү**.

**This is a live defect, not a cost the new step introduces.** `cloze` and `dictation` already ship and are already auto-graded against the exact script, so any Kyrgyz blank or dictation target containing one of the three is **unanswerable today** — the learner cannot type a correct answer at all, and the grader marks them wrong for it. Rank 9 only makes it more visible. Worth checking the live Kyrgyz Book for such blanks before treating this as theoretical; plan 0008 point 11 already has its cloze blanks flagged for re-authoring, so the two passes can go together.

**The row is data, not a language branch.** `domainSchema` gains one **optional** `extraChars: string[]` — additive, and dropped by non-strict zod parsing on older clients, so it does not bump `CONTENT_SCHEMA_VERSION` (0015 §6a). Where set, the typed-input component (shared by cloze, dictation and `write`) renders those characters as ≥44px keys above the field, inserting at the caret without dismissing the on-screen keyboard. Absent field, no row — the English demo Book is untouched. Turkish would declare `ğ ı ş ç ö ü`, German `ä ö ü ß`, a maths domain `≤ ∈ ∀`.

Deriving the list instead of authoring it was rejected: it needs a per-language model of what a given keyboard already produces, and frequency cannot isolate the three (ө and ү are common in Kyrgyz — vowel harmony puts them everywhere). That is precisely the domain-specific code plan 0023 §9 pins as tier 3, built for one language. The list is tier 1 (content anyone authors) and the key row is tier 2 (generic capability that data activates). The editor can still **suggest** the set by scanning the Book's script inventory and offering the characters outside the gloss language's alphabet; the author confirms it, which is 0023 §7's shape.

**No folding, ever.** `normalizeTypedInput` must never map ң → н or ө → о: they are distinct letters and the distinction is the thing being taught. All three are precomposed codepoints (U+04A3, U+04E9, U+04AF), so NFC does not decompose them and today's normalization is already correct — the rule is written down here so that a future "typing this is too hard" bug report is not fixed by adding a fold. The right answer to a near-miss is presentational: a wrong typed answer highlights the differing characters in the reveal, which teaches the letter instead of hiding it.

### 10. Auto-generated exercises, and the wizard

Authoring a unit today means adding tasks one at a time, from a list of types, with no guidance about which set is enough. The ladder gives the editor something to say — coverage — and most of the generation is mechanical. 0021 §9 already built the hard half: the Exercises page lists only the task types a unit can support, pre-filled with eligible items, because `TASK_ALLOWED_ITEM_KINDS` / `TASK_REQUIRED_ASSET` / `TASK_NEEDS_DISTRACTORS` and validator classes (e)/(f)/(o) make invalid tasks unreachable rather than explained after the fact.

The line this feature must not cross is plan 0007 decision 2: **content selection is pedagogy and is never automated.** So the split is:

**Mechanical — generate it.** Which types a given item set supports, and with which items. For a vocabulary unit (lexemes only) the whole set is mechanical and one tap covers the ladder:

<!-- prettier-ignore -->
| Generated task | Floor it respects | Ranks it unlocks |
| --- | --- | --- |
| `matching` | 2–5 items, no two sharing a prompt text — class (p) | 1 |
| `recognize` | owning unit has ≥ 4 same-kind items — class (g)/(r) | 2, and **4** derived (§3) |
| `recall` | none | 8, and **9** derived (§3) |

That is ranks 1, 2, 4, 8 and 9 — the entire non-sentence ladder — from three generated tasks over items the author already wrote. This is why "with vocab it should be pretty easy" is right: the floors are exhaustive tables, so the generator can be total and still never emit an invalid task.

**Pedagogical — suggest it, and wait for a tap.** `scramble` and `build` gate on ≥ 3 tokens (class (q)) and are mechanical, but `cloze` is not: choosing which word to blank is teaching. The wizard proposes blanks — the sentence's tokens that resolve to items in *this unit's own* item list, i.e. the vocabulary the unit exists to teach — and writes `{{c1::…}}` only when the author accepts. Nothing is auto-accepted, which is 0023 §7's rule ("the author's confirm tap is the validation") applied to a second suggestion engine.

**The recommendation speaks in bands, not types.** "This unit stops at *Meet it*; add a recall task to reach *Produce it*" is actionable in a way that a list of eleven type names is not. Coverage is computed per item, not per unit — an item that no task above band A ever touches is the real gap, and a unit can look well-stocked while half its words are only ever recognised.

Rules that keep it safe to press twice:

- **Additive and idempotent.** Existing tasks are never rewritten or deleted; a type already covering an item is skipped. Generated ids follow spec 0018's `${book.code}-<uuid>`.
- **Assets gate themselves.** `listen` / `picture` / `dictation` / `minimal-pair` are offered only for items that carry the required ref, so a generated task can never dangle (`TASK_REQUIRED_ASSET`, class (n)).
- **Everything lands in the draft**, subject to the same Publish and the same validation as hand-authored tasks — including private Books, which is where a solo author will actually use this.
- **Non-goal: no generated _content_.** New sentences, glosses or examples are authoring, not rearranging. This feature only builds exercises over items that already exist. (`ToDo.md`'s "editor flow via AI" is a separate idea and stays separate.)

## Slices

Each is independently shippable, `pnpm check` green after every one.

1. **Extra-key row** (§9) — optional `domain.extraChars`, key row on the shared typed-input component, no folding in `normalizeTypedInput` (with a test pinning that ң ≠ н). Ships alone and ahead of everything else here: it fixes `cloze`/`dictation` on already-published Kyrgyz content. Needs a Kyrgyz content pass to set the field.
2. **The table** — `EXERCISE_RANK` (exhaustive over `TaskType`), the band split, the tie-break and modality tags in `packages/schema/src/entities.ts`, plus tests asserting exhaustiveness and that `shadowing` is unranked. No behaviour change anywhere. Small.
3. **Unit sessions run easy → hard** — `buildUnitSession` bands (`session.ts:564`); rng-injected tests pinning band order and within-band shuffle. No web change (`countUnitQuestions` is unaffected — ordering does not change counts).
4. **Produce-direction MCQ** — `sampleMcq`/`buildTaskSession` gain a direction, validator class (h) widened to the prompt side, fixture per the new error. `SessionScreen` unchanged by construction; a browser pass confirms the reversed question renders and grades.
5. **Typed production (`write`)** — derived from `recall` tasks, reusing the typed-input component and `checkTypedAnswer`; strict script, so it depends on slice 1.
6. **Review climbs the ladder** — replace `SENTENCE_REVIEW_TASK_TYPES` with the §5 rule; tests for floor, ceiling-by-rung, availability fallback, and that every existing review case (lexeme, cloze blank, pair, note, sentence) is unchanged at rung 0.
7. **Auto-generated exercises** (§10) — the mechanical generator over a unit's items, additive and idempotent, on 0021 §9's Exercises page; band coverage per item as the recommendation's language. Vocabulary units first (the table in §10); the cloze-blank suggester is its own step and ships behind an author confirm.
8. _(optional)_ **Band coverage line** — the read-only `Meet it ✓ · Assemble it ✓ · Produce it —` summary of §8, if slice 7 hasn't already put it on screen.

Slice 1 is independent of the ladder entirely and is worth landing first on its own merits. Slices 4 and 5 each deliver one of the owner's missing steps and are usable before slice 6 exists (they appear in unit sessions via slice 3's bands); slice 6 is what turns the ladder into a progression over time; slice 7 is the authoring half and needs only slice 2.

## Done-criteria

- Adding a task type to `TASK_TYPES` fails to compile until it is given a rank.
- A unit session presents band A before band B before band C, with order inside a band still rng-driven.
- On the live Kyrgyz Book, with no content edit: an English prompt with Kyrgyz options is playable, and typing a word from its English prompt is playable and auto-graded.
- A Kyrgyz cloze blank or dictation target containing ң/ө/ү can be answered correctly on a device with only a Russian keyboard, and ң typed as н is still graded wrong.
- A lexeme at rung 0 reviews exactly as it does today; the same lexeme at rung 4 reviews as `write`; failing it returns it to the recall card.
- A vocabulary unit with 4+ lexemes and zero tasks reaches ranks 1, 2, 4, 8 and 9 from one press, and pressing it twice changes nothing.
- `pnpm check` green; no `CONTENT_SCHEMA_VERSION` change; no new `bb.*` key; export/import untouched.

## Open questions

1. **Should a unit session mix directions?** §4 keeps the first pass comprehension-only, so the owner's step 2 first appears in review. The alternative — assign the direction per item within a `recognize` task, so both appear in one session without lengthening it — is closer to what the owner described but picks the harder direction for some items arbitrarily, with no learner state to pick it from. Owner call.
2. **Does `picture` flip to produce-direction?** Today it is image → English gloss, which tests no foreign form (§2). Flipping it is one line but changes a shipped exercise.
3. **Who sets `extraChars` on the live Kyrgyz domain, and when?** Slice 1 is inert until the field is set, and setting it is a content edit on a published Book (§9). Cheapest path is riding along with plan 0008 point 11's cloze re-authoring pass.
4. **Does the wizard also propose _which items_ a unit should drill hardest?** §10 deliberately stops at "this item never leaves band A". Ranking items by need starts to be a recommendation engine, which every plan since 0016 has refused. Probably no — but it is the natural next ask.
5. **Rung → band constants.** 0–1 / 2–3 / 4+ is a first guess against 0022's `1, 5, 15, 30, 90, 180, 365` ladder — production first asked at the 90-day rung. Under classic SM-2 (still selectable) `reps` is a repetition count, not a rung, and the same mapping reads as "after 4 correct answers", which is coincidentally reasonable but is a different quantity. Worth one deliberate decision rather than an accident.
6. **Does the ladder belong in Learning settings?** 0022 §8 pinned three global presets under `bb.learning`. A "how fast to push into production" preset would fit there, and would also be the third setting in a row added after a non-goal said no settings.
