# Plan 0027: Authored-option questions and exam mode

Status: **implemented 2026-09-11 (steps 1–9)**, uncommitted, browser-verified (48/48 plus the `.bbbook` round trip). **Step 10**, the schema-bump republish, is an owner step and has not run · Owner: Moe · Date: 2026-09-07 · **Amended 2026-09-11** from the [learning-format review](../learning-format-review-2026-09-11.md) and its five owner decisions (§0). Direction pinned by four owner decisions on 2026-09-07 (two task types, not one; an exam is its own entity, run in one sitting, timed; exams sit at the same level as lessons; licence-encumbered questions ship as a private Book). Grilling deliberately skipped by the owner. The review's §6 decisions and one follow-up question (depth override, 2026-09-11) played that role for the amendment. The amendment had three adversarial doc-review rounds on 2026-09-11, with 14, 13 and 8 findings, all addressed.
- **Round 1** caught the stall on unbuildable drill items, the draft/edit pipeline gap, cross-unit recall leaking Check questions, the float pass-mark comparison, and steps that could not compile alone.
- **Round 2** caught `draftItem` silently turning questions into sentences, the Check → Practice exit, the Check retakes that farm levels, and the render paths that a throwing stub would crash.
- **Round 3** (8 findings, all applied, none contesting a decision) caught the same level-farming through "practise what you missed", the report losing the learner's marks on reload, and the always-rendered practice dot.

## 0. Amendment 2026-09-11

The review traced how the `softwarearchitektur` Book ([plan 0028](0028-software-architecture-books.md)) actually plays under [0025](0025-progression-engine.md). Its finding: the ladder is harmless for `question` items, since a question is only ever asked as itself. It hurts `concept` items in a text-only Book. There it ends in `write` ("type the author's label"), and levels 5–8 are the same flashcard four times. The review also found that exam-prep platforms treat two things as table stakes, and this plan had neither: an explanation per question, and a check-after-reading. The owner decided:

| # | Decision | Lands in |
| --- | --- | --- |
| 1 | **A domain exercise allow-list**, not a second level table | §10 |
| 2 | Unit questions are **checked once, then spaced**, not drilled | §12, §5 |
| 3 | Questions carry an **explanation** and per-option reasons. The official mock exam's explanations are **model-written** | §1; content in 0028 B2 |
| 4 | Practice depth is a **Book-declared default**. The learner's own Settings choice overrides it (follow-up, 2026-09-11) | §11 |
| 5 | An exam entry carries an optional **`lessonId`**. The report and the Book screen show readiness per lesson | §3, §6 |

This amendment also closes plan 0028's two hand-backs (0028 §6):

- Exam-only questions are exempt from unit ownership, and structurally out of Practice and Review until the learner has practised them (§3a).
- The exam intro renders the exam's `description` (§6).

§10 and §11 are **additive, need no schema bump, and do not depend on the rest of this plan**. They ship first (implementation order, steps 1–2).

What this amendment deliberately does not do: replace the scheduler, add a second level table, or make the ladder domain-aware in code. The review's option E (ordering, scenario stems, cloze without translation) stays out. So do its "topic sets" (all questions of one lesson as an ad-hoc run).

## Purpose

The platform has eleven task types, and none of them can hold an exam question. `recognize` is the only multiple-choice type. It is single-answer, and its distractors are **sampled from sibling items in the unit** (`TASK_NEEDS_DISTRACTORS`, `RECOGNIZE_DISTRACTOR_COUNT = 3`). Measured against the iSAQB CPSA-F Beispielprüfung (4 single-answer, 21 multiple-response and 13 row-assignment questions), **34 of 38 have no representable form at all**. The remaining 4 work only if their options are authored rather than sampled.

So the missing primitive is not "exam mode". It is **authored-option questions**: questions whose options, and which of them are correct, belong to the question itself rather than being derived from its neighbours. Exam mode is what gets built on top, and it is the smaller half.

Both halves are topic-generic. Nothing below knows about software architecture, iSAQB, or German. Kyrgyz gains from the first half immediately: authored distractors beat random siblings for teaching, and `recognize` cannot express one today.

## Goals

After this plan:

- A new **`question` item kind**, book-owned like `sentence`/`pair`. It carries a stem, authored options, an optional explanation, and an optional reason per option.
- Two new task types, **`choice`** (select-n multiple choice) and **`assign`** (sort each row into one of two authored labels). Each has its own auto-grader. They are mutually exclusive over the same payload: a question with `labels` is an `assign` question, one without is a `choice` question, and the validator enforces the pairing.
- A new **`exam` entity**, a **sibling of a lesson under the Book**. It holds a fixed, ordered, complete list of `{ taskId, points, lessonId? }` and a **ruleset record** (`passPercent`, `timeLimitMinutes`, `partialCredit`, `negativeMarking`). The iSAQB rules are one such record, not a code path.
- An **exam run** with:
  - deferred grading: answers stay revisable until a single submit;
  - a wall-clock timer that auto-submits at zero;
  - a result report against the pass mark, **grouped by lesson**;
  - an explicit "practise what you missed" action, which hands the missed questions to an ordinary practice session.
- A **review mode** for every exam: the same questions, untimed, with immediate feedback and the explanation. It keeps no score and writes no state.
- Exam attempts persist locally with an absolute deadline, so an app kill does not void an hour's work (§6).
- Questions carry an optional **`generated` flag** marking model-written content that has had no expert review, mirroring `lexemePayload.exampleGenerated`. `explanationGenerated` does the same for a model-written explanation on a question that is not itself generated.
- A unit's questions are answered on a **Check** page between reading and practice, once, with feedback. They never enter the practice drill (§12).
- A domain may **restrict which exercises the practice drill may ask** (§10), and a Book may **declare a default practice depth** (§11).

## Non-goals

- **No editor UI** for questions, exams or rulesets. They are authored in JSON via `/ingest`, exactly like `unlocksAfterUnitId` and `recallUnitIds` today. This is tracked as an editor long-tail gap, not built here. §9 records what this costs private Books and why it is survivable. `domain.exercises` and `book.practiceDepth` get no editor control either.
- **No exam gating or placement in the unlock chain.** Exams are siblings of lessons in the Book's list, always available, with no completion effect in either direction. Placing an exam between two specific lessons ("chapter 3 test") is a placement feature and a separate decision.
- **No exam generation.** An exam lists its questions and never samples from a pool. That is what "fixed and complete" means, and it is the property a Unit's pooled, shuffled practice session lacks.
- **No result history.** One current attempt plus the last result per exam. Readiness per lesson (§6) is computed from that last result alone. A score history is a good later idea and out of scope.
- **No new SRS path.** Exam scoring never writes SM-2 state, because partial credit on a 2-point question is not a `Quality`. Missed questions reach SRS only through the ordinary practice session the report offers.
- **No proctoring, anti-cheat, or option shuffling.** This is an offline-first app on the learner's own device; there is nobody to cheat.
- **No cross-book exams**, mirroring `unlocksAfterUnitId`/`recallUnitIds` scope.
- **No curriculum-goal tagging** (`LZ 1-7`-style), and no scenario items that share one stem across questions. Both are real ideas from the same brainstorm; both are separate plans. The `lessonId` tag (§3) is a lesson reference, not an LZ tag.
- **No content authored by this plan.** The iSAQB exam Book is content work under `/ingest` (plan 0028), gated on the licence rule in §8.

## Relationship to plans 0025, 0026 and 0028

**Updated 2026-09-07**, after the owner question that also amended 0026: "should the tasks be in the unit already for every format or should it be auto generated depending on the difficulty needed right now? Often the tasks will be hand crafted with the wrong answers as well." Neither plan is a prerequisite, and this one conflicts with neither. Designing it is what surfaced 0026's amendment, so the two now agree by construction rather than by luck.

**0026 fits this rather than fights it, and this plan completes its central pattern.** 0026's thesis is that a `Task` carries no authored decision, because the decision already lives on the item:

- `cloze`'s blank is markup in the sentence;
- `minimal-pair`'s pair *is* the item;
- `build`'s word bank is constructed from the payload.

A `question` item has the same shape and is the clearest case yet. Stem, options, correctness and labels are all payload, and the task type follows from it (`labels` present → `assign`, absent → `choice`). So a hand-crafted question with authored wrong answers is **item data, not task data**, and could be played with no authored task at all. That is now written into 0026 §3 as the corollary of its amended authored-wins rule.

What 0026 must **not** do is construct authored questions from nothing. Options and their correctness are authoring, which falls under 0026's own "no generated _content_" non-goal, unchanged. **Amended 2026-09-11:** 0026's generator must also never build a question for a `question` item. Such items are answered only as themselves (§12), and an exam-only one must never be reachable outside its exam (§3a).

**The exam-reference seam, restated under the amendment.** §3 has an exam list `taskId`s. 0026's amended §2 no longer materialises constructed exercises at all, so there are no generated task ids for an exam to reference by accident: every `taskId` in the content is authored. The validator rule in §7 (ae) is therefore sufficient on its own, and the "whichever plan lands second owns it" hand-off is resolved. Nothing extra is needed on either side. If 0026's phase 2 ever runs (now cosmetic, see its §9), an exam-referenced task is authored and stays in `taskIds` regardless.

**0025 touches this through its level table, and that cell is filled:** `choice` at 2 and `assign` at 3, decided 2026-09-07 with the reasoning in §2a. 0025 §2 carries a pointer back. This is a hard dependency in one direction: 0025's table is exhaustive over `TaskType`, so this plan's step 3 cannot compile without it. **Amended 2026-09-11:** §10 adds a per-domain filter in front of 0025 §4's draw. The draw itself, the level table and the interval row are unchanged.

**0028 is the first content on these rails.** Its §6 handed back two requirements, both closed by this amendment (§0). Its phase B authors questions with explanations under decision 3.

**One gap neither plan closes**, also recorded in 0026's open questions: hand-picked distractors for a **lexeme** have no home. A `question` item is the natural home, but a question is its own scheduling unit. So суу-the-word and суу-the-question would carry separate SRS state and both come due, against plan 0006's "one word, one SRS state". The minimal fix is probably an optional link that lets an authored question grade an existing scheduling unit rather than minting its own. Nothing in this plan depends on it: the exam use case has stand-alone questions throughout.

## Design

### 1. The `question` item kind (`packages/schema/entities.ts`)

```ts
const questionOptionSchema = z.object({
  text: z.string().min(1),
  /** The statement holds. For `choice` that means "is a correct answer";
   *  for `assign` it means "belongs to labels[0]". */
  correct: z.boolean(),
  /** Why this option is right or wrong. Shown under the option once the
   *  question is graded (§5), in the Check, in Review, in exam review mode
   *  and in the exam report. Own words. */
  why: z.string().min(1).optional(),
});

const questionPayloadSchema = z.object({
  stem: z.string().min(1),
  options: z.array(questionOptionSchema).min(2),
  /** Present iff this is an `assign` question: exactly two category labels.
   *  Where one of the two is the affirmative one it goes first
   *  (Richtig/Falsch, Geeignet/Nicht geeignet); where the pair is genuinely
   *  symmetric (Blackbox/Whitebox, enge/lose Kopplung) the order is just an
   *  authoring choice, and `correct: true` means "the first one". */
  labels: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  /** Shown under the question once it is graded, wherever `why` is shown.
   *  The reasoning behind the answer as a whole; `why` is per option. */
  explanation: z.string().min(1).optional(),
  /** Model-generated, not taken from a source, and without an expert review
   *  pass. Same purpose and same honesty as `lexemePayload.exampleGenerated`;
   *  it sits on the question rather than the exam because a generated
   *  question in a Unit, outside any exam, needs the mark just as much.
   *  Covers the whole question, explanation and `why`s included. */
  generated: z.boolean().optional(),
  /** The `explanation` and `why`s are model-generated and unreviewed while the
   *  question itself is not — the official mock exam's case (owner decision
   *  3, 2026-09-11). Meaningless when `generated` is set. */
  explanationGenerated: z.boolean().optional(),
});
```

Three decisions worth naming:

- **One `correct: boolean` serves both types.** For `assign`, `true` means the row belongs to the first label. That reads naturally wherever one label is the affirmative one, which covers most row-assignment questions. So **"the affirmative label goes first" is an authoring rule**, stated in the schema comment and in `/ingest`; code cannot enforce it. Symmetric pairs (Blackbox/Whitebox) have no affirmative side, and the order is simply the author's.
- **How many options to pick is derived, never authored.** For `choice` it is the count of `correct: true` options; for `assign` it is the row count. A separate `select` field could disagree with the options, so there is none. The human-readable "choose the three that fit best" goes in the task's existing optional `instructions`.
- **Explanations are optional per question, not per exam** (2026-09-11). Every exam-prep platform the review surveyed ships an explanation per question, and research favours feedback that says why each distractor is wrong (review §2). Optional, because the source of an official exam has answer keys only, and a question without an explanation still works. `why` sits on the option because that is where the reason belongs. A parallel `whys: string[]` array could fall out of step with `options`.

A `question` is **book-owned**, like `sentence` and `pair`, not a lexicon entry. `DOMAIN_ENTRY_KIND` is untouched.

`itemDisplayText`, `recognizePrompt`, `recallPrompt` and `recallReveal` each get a `question` case that throws, exactly as `pair` does (`pairUnsupported`). A question item only ever feeds its own two task types, and every other presentation is unreachable by construction.

### 2. The two task types (`packages/schema/entities.ts`)

`TASK_TYPES` gains `choice` and `assign`. Each of the contract records below carries the comment "adding a type forces a decision here", and each gets the same rows for both types:

| record | `choice` | `assign` |
| --- | --- | --- |
| `TASK_ALLOWED_ITEM_KINDS` | `["question"]` | `["question"]` |
| `TASK_REQUIRED_ASSET` | `null` | `null` |
| `TASK_NEEDS_DISTRACTORS` | `false` | `false` |
| `TASK_EXERCISES` | `["choice"]` | `["assign"]` |

`EXERCISES` gains `choice` and `assign` too.

`TASK_NEEDS_DISTRACTORS: false` is the row everything else depends on. Options are authored, so the MCQ sampler must not run, and classes (g)/(r) must not demand same-kind siblings. The precedent is `build`, which already constructs its own word bank from the payload rather than sampling.

### 2a. Where the two types sit on plan 0025's ladder

Decided 2026-09-07 (owner: "you decide"). [Plan 0025](0025-progression-engine.md) slice 2 made its level table exhaustive over `TaskType`, so that a new type cannot compile without a level. Placing the two types is therefore a required part of adding them.

| Level | Exercise | Why here |
| --- | --- | --- |
| 2 | `choice` | Every option is on screen: comprehension, not production, so it belongs in 0025's 1–3 band, which its §5 day guard exempts. Level 2 is where `recognize` · comprehend already sits, and `choice` is the same act with better distractors. |
| 3 | `assign` | Every row must be judged on its own, and **elimination never helps**. That is the exact inverse of the reason 0025 §2 puts `matching` at 1 ("elimination carries the last pair for free"). Harder than a single MCQ, but still recognition. |

Neither type is placed above 3. That keeps 0025 §5's guard meaning what it says: the day guard starts at 4 because production starts at 4, and a question whose answers are all on screen is not production, however hard it is.

**Amended 2026-09-11.** Since §12, question items never enter the practice drill, so no draw ever picks `choice` or `assign`. For a question item the level is just a counter. It drives the interval row (0025 §1) and the unit bar, and nothing else; the review already called the ladder "a no-op" here. Two claims the original section made are therefore **withdrawn**:

- "Authored quality is delivered as a better level-2 exercise": there is no level-2 draw to win.
- "`assign` at 3 fixes the hole at level 3 for text-only Books": a concept item can never be asked as `assign`, so it never fixed a concept's level 3. It only ever filled level 3 for question items. [Plan 0028](0028-software-architecture-books.md) §4 repeated this claim and is corrected alongside.

The placement itself stands, because the table is exhaustive and the numbers are still the right ones should a future plan put question items back into a draw.

### 3. The `exam` entity (`packages/schema`)

```ts
export const examRulesetSchema = z.object({
  passPercent: z.number().min(1).max(100),
  timeLimitMinutes: z.number().int().min(1),
  /** false = all-or-nothing per question; true = 1/n per correct mark. */
  partialCredit: z.boolean(),
  /** Wrong marks cost 1/n. A question never scores below 0 either way. */
  negativeMarking: z.boolean(),
});

export const examSchema = z.object({
  id: slugSchema,
  topicId: slugSchema,          // wire-format name, per the 0015 DO-NOT-TOUCH rule
  title: z.string(),
  /** Rendered on the intro screen (§6). For the official iSAQB exam it
   *  carries a licence condition (0028 §2), so it is never optional to show. */
  description: z.string(),
  questions: z.array(z.object({
    taskId: slugSchema,
    points: z.number().int().min(1),
    /** The lesson this question tests, for readiness per lesson (§6). */
    lessonId: slugSchema.optional(),
  })).min(1),
  ruleset: examRulesetSchema,
});
```

Points sit on the exam's own list rather than on the question because they are the exam's weighting: the same question can be worth 1 point in one exam and 2 in another. **`lessonId` sits there for the same reason** (owner decision 5): one question can serve two exams, and "which lesson does this test" belongs to the exam that asks it. It is a weaker and cheaper tag than an LZ id, and it is enough for readiness. The iSAQB record is `{ passPercent: 60, timeLimitMinutes: 75, partialCredit: true, negativeMarking: true }`.

**An exam is a sibling of a lesson, one level under the Book** (owner decision). `bookSchema` gains

```ts
examIds: z.array(slugSchema).optional(),
```

next to `lessonIds`. The Book screen lists exams after the lessons in the same list, in `examIds` order. `#/books/<bookId>/exams/<examId>` (added in step 8) is the sibling of `#/books/<bookId>/lessons/<lessonId>`, so the route shape needs no special case.

**`examIds` is optional because it has to be.** Plan 0017 decision 5 makes the schema policy for private content **additive-only**, because no admin republish can ever reach a Book that exists on one device. A required `examIds` would permanently break every private Book already authored. The same reason makes the bump in §7 safe for private content: a private Book authored before it contains no `question` items and no `choice`/`assign` tasks, so there is nothing to migrate. `content/private-migrations.ts` is there for the day something does.

`BookDocument` gains **`exams?: unknown[]`, optional**, and every reader treats a missing key as `[]`. No document stored today has the key: cached catalog rows, backend rows, private Books and `.bbbook` files all lack it. So `bookDocumentShapeError` (`documentSource.ts:126-137`, which requires every array field it lists) must **not** require `exams`. Requiring it would report every existing Book as malformed, and for a private Book that is permanent. It does gain the additive check "`exams`, **when present**, must be an array". A hand-built `.bbbook` with `"exams": {}` is exactly §9's creation path, and it must land in `broken`, not throw. `validateContent` zod-parses `exams` (phase 1) before any check iterates them. `Content`, `ValidateContentInput` and the draft pipeline's `ParsedSet` gain `exams` as a required array. The readers that build them (`documentSource.ts`'s `ValidateContentInput` assembly, `draftContent.ts`, and through it `documentProblems.ts`'s `checkReferences`) pass `doc.exams ?? []`. Without the draft half, every exam-only task would show up as a class (d) orphan in edit mode, on every keystroke. `draftBook` carries `examIds` (and, since steps 1–2, `practiceDepth`, guarded against `PRACTICE_DEPTHS`), and `draftDomain` carries `exercises` (filtered against `EXERCISES`). **`draftItem` gains a `question` branch** (`draftQuestionPayload`, never throws): its `default` branch turns any unknown kind into an empty `sentence`, and tsc cannot flag a switch that has a default. Without the branch, every question task in edit mode would fail class (o), and Preview would drill questions as sentences. Exams live **inside** the book document. There is no new document kind, so `documentId`'s `"topic" | "domain"` union is untouched, and a private Book's `.bbbook` export carries its exams for free (§9).

### 3a. Exam-only questions (closes 0028 §6.1)

Putting an exam's questions in a unit spoils the exam in three ways:

- the unit's Check or Practice asks them;
- each question is its own scheduling unit, so Daily Review serves it;
- 0026 could construct them.

So an exam may reference **exam-only tasks**: tasks that no unit's `taskIds` lists. Their items sit in no unit's `itemIds`. Ownership is by reference; the exam carries no new field.

- **Class (d) exemption.** A book-owned task with no owning unit is legal **iff** at least one exam references it. A book-owned item with no owning unit is legal **iff** every task that references it is exam-only and at least one does. Every other orphan is still an error, and multiple ownership by units is still an error.
- **Class (f) for exam-only tasks.** There is no owning unit to check against. Instead, an exam-only task's items must be owned by **no** unit. Otherwise a unit would drill an item whose task the author kept out of units.
- **A unit-owned task may still appear in an exam.** That is the author's choice. It suits a chapter test built from questions the learner has already met, which is exactly the case the exam-only rule does not cover.

With that, "not reviewed and not constructed until the learner has practised them" holds **without an exam-state check anywhere**:

| Surface | Why an exam-only question cannot reach it |
| --- | --- |
| Practice drill, Check | Both read `unit.itemIds` / `unit.taskIds` (§12), and the question is in neither. |
| Cross-unit recall ("Remember: …", plan 0016) | It samples the linked unit's `taskIds`, and an exam-only task is in none. It also skips every `choice`/`assign` task outright (§5), so unit questions stay out too. |
| Unit and lesson bars, completion | Both count `unit.itemIds`. |
| Daily Review | `reviewQueue` skips any scheduling unit **without SRS state** (`progress.ts:217`). The only writers of a question's state are the Check, Review itself, and the report's "practise what you missed" session. The first two never see an exam-only question. Exam scoring and review mode write nothing (§6). |
| 0026 construction | 0026 builds per item of a unit (its §2). Its §1 now also says, in its own text, that the constructor returns `null` for `question` items. |

After the learner takes "practise what you missed", those questions carry state and join Daily Review like any card. That is intended: the learner asked to practise them.

### 4. Scoring (`packages/engine`, one pure function)

For a question worth `P` points, let `n` be the number of marks required (`choice`: the count of correct options; `assign`: the row count), `c` the correct marks given, and `w` the wrong ones:

- `partialCredit: false` → `P` if `c === n && w === 0`, else `0`.
- `partialCredit: true` → `P × (c − (negativeMarking ? w : 0)) / n`, **floored at 0**.

That one formula covers all three iSAQB question types. A single-answer question has `n = 1`: right scores `P`, and wrong scores `−P`, which floors to `0`. An unanswered row in an `assign` question is neither correct nor wrong, so it adds nothing and costs nothing. That is the iSAQB rule for a blank row, and it falls out of the formula rather than needing a special case. The exam total is the sum, and pass is `total ≥ passPercent% × maxPoints`, **compared with a tolerance**: `total + 1e-9 >= passPercent / 100 * maxPoints`. Partial credit sums fractions of `1/n`, which are inexact in floating point. For example, adding 1/5 156 times gives `31.19999999999992`, so without the tolerance a learner at exactly the iSAQB mark (60 % of 52 = 31.2) reads as failed. Displayed points and percentages round to one decimal.

**Readiness per lesson** (2026-09-11) is a second pure function over the same per-question result. For each `lessonId` it sums the points scored and the points available; entries with no `lessonId` are grouped as one "Other" bucket. It returns the buckets **in Book lesson order**, with "Other" last. Sorting is left to the renderer: the report sorts weakest first, while the card reads only the weakest. **The weakest lesson** is the bucket with the lowest percentage, ties going to the earlier lesson; "Other" is never named weakest. A question the stored result has no points for (the exam changed after the result, §6) is **left out of its bucket entirely**, neither scored nor available: the learner never saw it.

**The floor at 0 is hardcoded, not a ruleset field.** It is what "negative marking" means in every ruleset we have. A ruleset that lets a question drag the total below zero can add the field when one exists.

**Deliberate deviation from the paper rules, recorded here rather than discovered later:** the iSAQB rules score a question 0 when the candidate marks more answers than requested. The runner instead **caps selection at `n`**, so over-selection is unreachable and that rule never fires. Every reachable state scores exactly as it would on paper. What is lost is the strategy of deliberately over-marking to guarantee a hit, which is what the penalty exists to punish. If paper fidelity is ever wanted, it costs one ruleset flag and one branch in the scorer.

### 5. Engine question shapes and grading (`packages/engine/session.ts`)

```ts
export interface ChoiceQuestion {
  kind: "choice"; unitId: string; stem: string;
  choices: string[]; correctIndices: number[]; selectCount: number;
  /** Per choice, aligned with `choices`; undefined where the option has none. */
  whys: (string | undefined)[];
  explanation?: string; explanationGenerated: boolean;
}
export interface AssignQuestion {
  kind: "assign"; unitId: string; stem: string;
  rows: string[]; labels: [string, string]; correctLabelIndex: number[];
  whys: (string | undefined)[];
  explanation?: string; explanationGenerated: boolean;
}
```

`explanationGenerated` on the engine shape is `payload.generated === true || payload.explanationGenerated === true`. The renderer marks a generated explanation with one rule, whichever flag caused it.

Both shapes join the `Question` union, with auto-graders alongside `checkTypedAnswer`/`checkScrambleAnswer`. Option order is the authored order and is never shuffled. A question then reads the same in practice as in the exam, and an author can rely on ordering for "all of the above" style options.

`buildTaskSession` gains a case for each type: one question per item, in `itemIds` order. **Scheduling: one scheduling unit per question item**, with `id` equal to the item id. There is no `::` suffix, and nothing new in `units.ts` beyond letting `question` fall through the existing "all other kinds contribute `<itemId>`" rule. `buildReviewSession` gets a `question` case that returns that item's own `choice`/`assign` question, the same rule `pair` and cloze blanks already follow. To find the type it reads `labels`, never a task.

**Question items are not drilled** (2026-09-11, owner decision 2). Unit practice (0025 §6) runs over the unit's **non-question** items. A new engine helper, `drillItemIds(unit, content, allowed?)`, returns the unit's items that are **not** `question` items **and** for which `availableExercises(item, content, allowed)` contains **at least one exercise other than `matching`**. `buildVisitQuestion` removes `matching` for a word a board already covered, so an item whose only exercise is `matching` would draw `null` on its second visit. `App.tsx`'s `startDrill` call uses it. The second condition is not optional. The drill never advances past a visit that builds no card: `extend` runs only after an answered card. So an unbuildable item stalls the session, either on an empty screen or re-showing the previous card. Filtering it out before the drill starts is what makes §10's "an item left with nothing" safe. A unit's questions are answered in its Check instead (§12).

`countTaskQuestions` stays truthful. It counts `choice`/`assign` questions like any other type, one per item, because `LessonSummaryScreen`'s "questions" tile reads it and a Check question is a question. The Practice bar's count is the one number that must leave them out. `UnitScreen` calls `countUnitQuestions` there on the unit with its `choice`/`assign` task ids removed.

**Cross-unit recall** (plan 0016's "Remember: …") also stays drill-shaped. `buildRecallSession` samples only among the linked unit's **non-`choice`/`assign`** tasks, filtering **before** its shuffle-and-take-5; filtering after would let a mixed unit draw five question tasks and produce no cards. The filter is engine work, in step 4. So a Check question is never asked, shuffled and graded, from another unit's Overview. A link whose unit has no such task (an all-question unit) is **not rendered** by `UnitScreen`, rather than opening an empty session. That is web work, in step 7, with a test.

**Grading.** In a practice session, the Check or Review, grading is the ordinary auto path (wrong → quality 2, correct → 4), and partial correctness counts as wrong. Exam scoring (§4) is a separate calculation that touches no SRS state.

**Feedback.** After a `choice`/`assign` question is graded, the renderer shows:

- the correct answer marked;
- the learner's marks;
- the `why` under each option that has one;
- the `explanation` under the question.

A generated explanation (`explanationGenerated`) carries the same "KI-generiert" badge the exam card uses (§6). This is the same component in practice, the Check, Review, exam review mode and the exam report.

**A fixed-order session builder.** `buildFixedSession(taskIds, content, rng)` returns `buildTaskSession` over each task in the given order, flattened and **not shuffled**. The Check (§12), exam review mode and "practise what you missed" (§6) all use it. `buildUnitSession` shuffles and cannot be reused for them.

### 6. The exam run (`apps/web`)

Three screens behind `#/books/<bookId>/exams/<examId>`:

- **Intro** shows:
  - title, question count, max points, pass mark and time limit;
  - **the exam's `description`, in full** (2026-09-11; for the official iSAQB exam it carries the licence attribution, 0028 §2);
  - **Start**;
  - **Review mode**, the second action (below).

  If an unfinished attempt exists, the intro says how much time is left and offers Resume in place of Start.
- **Runner** (`?q=<n>`): one question at a time, a question navigator showing answered and unanswered, free movement in both directions, a visible countdown, and Submit. **No feedback of any kind before submit.** This is the one genuinely new interaction in the app, since every existing question grades immediately.
- **Report** (`?end=1`) shows:
  - total, percentage, and pass/fail against the ruleset;
  - **points per lesson** (§4), weakest lesson first;
  - per question: points, the correct answer, the learner's marks, and **the explanation and `why`s**. This uses the §5 feedback component, not a second rendering of it;
  - one button, practise the questions you missed. **Missed means scored below the question's full points**, so a partial-credit question counts as missed. It launches an ordinary practice session over those tasks (`buildFixedSession`, exam order). **It follows §12's once-per-question rule:** it grades into the real store only questions at level 0 when the session opens, and every other question against the no-op store. The button stays available, because `lastResult` never changes, so without the rule repeated runs would climb a question to level 4 in one sitting. Route: the exam route with `?practice=1`. `onDone` and the session's exit both return to the report (`?end=1`), and there is no `nextAction`. This is its own small `App.tsx` component in the `RecallSession` mould, because exam-only tasks have no unit and `UnitSession`'s wiring does not fit them.

**Review mode** (2026-09-11, review option D) is the exam's questions in exam order. Each question gets immediate feedback with its explanation, through `buildFixedSession`. There is no clock and no score. It **writes nothing**: no SM-2 state, no attempt, no `lastResult`, no streak day. `App.tsx`'s preview path already runs a session against a no-op `ProgressStore` (`RecallSession`'s `store` prop, spec 0021-9 §1), and review mode uses the same mechanism. Review mode deliberately does not respect "unseen until practised": it reveals every answer, and choosing it is the learner's call. It writes no state, so §3a's guarantees still hold.

**Attempt persistence** (`bb.exam.<examId>` in `localStorage`, alongside the existing `bb.item.*` and `bb.streak.*` keys; exam ids carry the Book code prefix under class (c), §7, so two Books cannot share one key):

```ts
{
  attempt?: {
    startedAt, deadlineAt,
    /** Selected option indices per question; for `assign`, the chosen label
     *  index per row, `null` for an unanswered row. */
    answersByTaskId: Record<string, (number | null)[]>,
  },
  lastResult?: {
    submittedAt,
    pointsByTaskId: Record<string, number>,
    answersByTaskId: Record<string, (number | null)[]>,
  },
}
```

- **The deadline is an absolute timestamp**, so the clock is wall-clock and never pauses. Closing the app, backgrounding it, or having the PWA evicted all leave the attempt intact and resumable, with the elapsed time gone.
- **Opening a resumed attempt past its deadline submits it immediately** with whatever is answered.

That is what "one run" means here: you cannot bank half an exam and come back fresh tomorrow, but Android reclaiming memory does not cost you the attempt. The strict alternative (leaving the exam voids it) was considered and rejected by the owner.

**Both halves are keyed by `taskId`, not by position**, so a content update that reorders or edits an exam cannot shift stored answers or points onto other questions. Within one question, answers are option indices. Whenever stored answers are read (resume, and the report), an answer that no longer fits its question is **discarded**, and that question reads as unanswered:

- a `choice` answer with any index ≥ `options.length`, or with more selections than the current `selectCount`;
- an `assign` answer whose length differs from the row count.

This needs nothing extra stored. A reorder, or a `choice` whose option list grew, is not detected. That is accepted: updates are opt-in, and the learner would have to accept one mid-attempt.

**On submit**, `attempt` is cleared, and its `answersByTaskId` (after the discard rule) is copied into `lastResult` next to `pointsByTaskId`, so the report can show the learner's marks after a reload or a return from `?practice=1`. `?end=1` with no `lastResult` redirects to the intro. Once a result exists, the intro shows **"Last result"**, a link to `?end=1`. Readiness is recomputed from `lastResult` against the current exam on every render. An entry whose `taskId` no longer exists in the exam is ignored, and a question with no stored points is left out (§4). If no stored `taskId` matches the current exam, the card shows no readiness at all.

`progress/backup.ts` already sweeps every `bb.*` key (`backup.ts:29`), so the new key is covered with no change. It must not grow a special case. Keeping learner state on the device, with export/import as the durability floor, is a standing requirement, and an in-flight attempt is learner state.

**Surfacing**: an exam card sits in the Book screen's lesson list, after the lessons. It shows:

- the time limit and point total;
- a "KI-generiert" badge when every one of its questions carries `generated` (derived, never stored twice);
- **once a result exists, the last percentage and the weakest lesson's title** (2026-09-11, owner decision 5): "Last: 62 % · weakest: Muster".

Exams are not part of the lesson/unit unlock chain and have no completion effect on it.

### 7. Validation (`packages/schema/validate.ts`)

New classes, continuing after (ab):

- **(ac)** A `question` payload needs ≥2 options.
  - With `labels` absent: at least one `correct: true` **and** one `correct: false`, since an all-correct choice question is degenerate.
  - With `labels` present: both labels non-blank.
  - `explanation` and every `why`, when present, must be non-blank after trimming. `min(1)` alone lets `" "` through.

  Question items are excluded from class (h)'s duplicate-display-text check, exactly as `pair` items are, since `itemDisplayText` throws for them.
- **(ad)** Task/payload pairing: every item of a `choice` task must have no `labels`, and every item of an `assign` task must have `labels`. This is what makes the two types mutually exclusive over one payload shape.

  **Placement:** (ac) runs per item, and (ad) runs in the per-task loop **before** the `owningUnit === undefined → continue` guard (`validate.ts:465-470`). Everything after that guard is skipped for tasks with no single owning unit, which would silently exempt every exam-only task from the pairing check.
- **(ae)** Exams:
  - `topicId` resolves to this book;
  - every id in `book.examIds` resolves to an exam in the document, and every exam in the document is referenced by `examIds` exactly once (ownership both ways, as `lessonIds` already has);
  - every `taskId` resolves, is of type `choice` or `assign`, and holds **exactly one** item. An exam entry carries one question's points, so a multi-item task would be ambiguous;
  - no duplicate `taskId` within an exam, and `questions` non-empty;
  - **every `lessonId` resolves to a lesson in `book.lessonIds`** (2026-09-11);
  - exam ids join class (c) (prefix `<book.code>-`, like lessons, units and tasks) and class (j) (`reportDuplicateIds(exams, "exam")`: no two exams of the book share an id; like every (j) check it is per kind). `book.examIds` joins class (k)'s duplicate-entry check, beside `lessonIds`.

  Unit practice tasks may still hold several question items; the one-item rule binds only exam-referenced tasks.
- **(af)** (2026-09-11) The §3a amendments to classes (d) and (f): the exam-only ownership exemption, and "an exam-only task's items are owned by no unit". Implemented as edits inside (d)/(f), not a separate pass. The letter exists so an error message can name the rule.

`CONTENT_SCHEMA_VERSION` **bumps to 3**. The 0015 §6a exemption for additive optional fields does not cover this: in an older client, a strict discriminated union rejects an unknown task type and an unknown item kind outright. The full §8 bump procedure applies: bump, have the admin republish every listed document, and re-export the bundled seed. §10 and §11 ride **none** of this (see there).

### 8. Content and licence: three exams, three destinations

The candidate question sources have **different licences**, and plan 0017's private Books are what let all three exist without any of them ending up in the wrong place. This plan authors none of them; it fixes where each may go.

| Source | Licence | Destination |
| --- | --- | --- |
| **iSAQB Beispielprüfung**: `~/vault/sources/software-architecture/iSAQB CPSA-F Beispielprüfung.md`, 38 Fragen / 52 Punkte, Dokumentversion 2026.2 | Free redistribution for exam preparation **provided iSAQB® e.V. is named as source and copyright holder**. Use in a real exam is forbidden. | **Public Library Book.** The attribution is a licence condition, so it goes in the Book description *and* the exam's `description`, which the intro renders (§6), not only in a repo comment. **Explanations are ours**, model-written (owner decision 3), so every question in it carries `explanationGenerated: true`. |
| **Rheinwerk Anhang A**: the book's own Beispielfragen | Copyrighted, no redistribution grant | **Private Book.** Never published, never in the Library, never on the backend. §9 is how it gets created. |
| **KI-generierte Übungsprüfung**: `~/vault/sources/software-architecture/Übungsprüfung Softwarearchitektur (KI-generiert).md`, written 2026-09-07. 38 Fragen (4 A / 21 P / 13 K), 52 Punkte, same ruleset, each question anchored to a book section | Ours | **Public Library Book**, every question carrying `generated: true`. |

Every question item needs a resolving `sourceRef` like any other item, so each exam's origin document becomes a `resource` on its Book: the mock-exam PDF for the first, the book for the second, and for the third a resource that says plainly what it is.

**On the generated exam specifically:** it is honest practice material and nothing more. It is model-written and has had no expert review. And, the part worth saying out loud in the Book description as well as in the vault file, **it is calibrated against nothing**: scoring 65 % on it does not predict 65 % on the real exam. That is exactly what the `generated` flag exists to keep visible, and why the badge is derived and rendered rather than left to the description.

### 9. Private exams, and the editor gap that bites here

"Anhang A stays private" only means something if a private exam can actually be created, and this plan ships no editor for questions or exams (Non-goals). Checked rather than assumed: **it can, through the `.bbbook` import path, and that path is clean.**

A `.bbbook` is a plain JSON file: `{ kind, formatVersion, schemaVersion, book: BookDocument, domain: DomainDocument, assets }`. `checkImportFileShape` (`content/private-transfer.ts`) enforces only `kind` and a `schemaVersion` no newer than the app. The real checking happens in `content/source.ts`'s import, which runs the same `validateContent` every other content path runs. Nothing requires the Book to have been created in-app first. So a hand-built file carrying `exams` is validated exactly like a published Book's, and a malformed one is rejected rather than half-loaded. Plan 0028's `scripts/pack-bbbook.ts` builds such a file from a scratch tree, and it already carried L0 through a fresh-profile import on 2026-09-10.

That makes the creation path for a private exam: build the `.bbbook` outside the app, then import it through Settings. Ids are `crypto.randomUUID()` per 0017 decision 4. This is a developer's path, not a learner's. It is acceptable **because the one private exam this plan anticipates is the owner's own**, and it would be unacceptable as a general answer. The in-app gap (creating and editing questions, exams and rulesets on the learner screens, the way plan 0021 did for everything else) is real, and it belongs on the editor long-tail list, not in this plan.

Deliberately not solved here: 0017's non-goal "no publishing path" still stands, so a private exam cannot later be promoted to the Library. For the Anhang A exam that is the point, not a limitation.

### 10. Domain exercise allow-list (2026-09-11, owner decision 1)

The review's §1 trace, for a concept in a text-only Book, reads: board → term→definition MCQ → definition→term MCQ twice → **the same flashcard four times** → **type the term** twice. Two of those exercises are wrong for a knowledge domain:

- `write` tests the author's label, not the concept. "Standpunkt (Viewpoint)" and "R3 (Kennen)" are terms the learner would have to type, and a miss costs two levels.
- `recognize-produce` asks for a term from a 25-word definition, which the exam never does.

The fix is to curate which exercises exist, per domain. `domainSchema` gains:

```ts
/** The exercises unit practice may draw for this domain's items (plan 0027
 *  §10). Absent means every exercise, so no shipped Book changes. Names are
 *  `EXERCISES` values; `write` and `recognize-produce` are listable although
 *  no task authors them, which is the point — they are the derived ones. */
exercises: z.array(z.enum(EXERCISES)).min(1).optional(),
```

- **Where it filters.** `availableExercises(item, content, allowed?)` gains the optional list and drops every exercise not on it, after everything else it does today. `buildVisitQuestion` passes it through, and `App.tsx`'s unit session passes the unit's domain `exercises`. `drawExercise` is untouched: it already walks past a missing level (0025 §4), and a filtered-out exercise is just another missing level. The coverage grid (0026 §8, unbuilt) must read the same field when it is built.
- **What it does not govern.** Daily Review never draws: it asks each kind in a fixed presentation (a concept as the recall flashcard, a cloze blank as its cloze, a sentence as its authored production exercise). Those presentations ignore the list. The same goes for the Check, exam runs and ad-hoc Vocabulary study, which never call the draw either. This is deliberate: the list removes exercises from a *ladder*, and those surfaces have none. If a domain ever needs Review's presentation restricted too, that is a new decision, not a bug here.
- **Validation.** None beyond zod: `.min(1)` rejects an empty list and the enum rejects an unknown name. No validator class.
- **An item left with nothing.** An item the list strips of every exercise but `matching` has no question the drill can reliably show, and the drill cannot skip a card it cannot build (§5). So `drillItemIds` leaves such an item out of the session entirely. It still counts in the bar and in completion, so its unit **can never complete**. That is an authoring error, and it is surfaced as one: `documentProblems` reports "`<item>` cannot be practised under the domain's `exercises`" for every such item, through the same `drillItemIds` rule. A validator class was considered and rejected, because the schema package cannot call the engine's `availableExercises`, and a second copy of that rule would drift. For `sa` this cannot happen, because `/ingest`'s scratch-tree section authors a `recall` task over every concept. It can happen in a language domain, for example to a sentence whose only tasks are `scramble`/`build` under a list without them. Until step 6 wires `drillItemIds` into the unit session, such a list stalls the session. No shipped domain declares one.
- **No schema bump.** The field is additive and optional, so an older client's non-strict parse drops it (0015 §6a, the `extraChars` precedent). **Forward-compatibility rule:** a document may list an exercise only if every client that can read that document's `schema_version` knows the exercise's name. Otherwise the older client's enum rejects the whole domain. Every exercise added so far arrived with a new task type, and a new task type bumps the schema, so this has held by construction. It is stated here for the first derived exercise that arrives without one.
- **Value for `sa`** (content, plan 0028): `["matching", "recognize", "recall"]`. A concept's **new attempts** become: board → MCQ → flashcard at every level from 2 up. Repetition slots draw from `{level − 1, level}` and fall back to the nearest level below (0025 §4). So under an explicit Normal or Careful, a repetition at levels 4–7 is the `recognize` MCQ. Under §11's Fast default for `sa` there are no repetition slots, only retries after a miss. The unit bar still climbs; it now measures spaced flashcard survival, which is what it always measured past level 4. `choice`/`assign` need not be listed, because question items never enter the draw (§12).

A per-item ceiling (0026 §5) and a second level table per domain kind were the alternatives. The review rejected both (§4 A2/A3), and the owner chose this.

### 11. Book-declared practice depth (2026-09-11, owner decision 4)

Practice depth (0025 §3, `REPETITIONS_PER_WORD`) is the number of correct answers each word is owed per session. At Normal, a 10-concept unit is 20 correct answers of definition MCQs and flashcards, which is a lot for an exam Book. The owner chose a **Book-declared default the learner can override**.

- **Schema.** `bookSchema` gains `practiceDepth: z.enum(PRACTICE_DEPTHS).optional()`, where `PRACTICE_DEPTHS = ["careful", "normal", "fast"] as const` moves into `packages/schema`. `apps/web`'s `Progression` type becomes that enum's type. Additive and optional, so no bump.
- **Setting.** `LearningSettings.progression` widens to `Progression | "book"`, and **the default becomes `"book"`**, labelled "Book's choice". Under `"book"`:
  - unit practice in a Book asks `REPETITIONS_PER_WORD[book.practiceDepth ?? "normal"]`;
  - the scheduler behaves as Normal: `LEVELS_PER_DAY` is 1.

  An explicit Careful, Normal or Fast applies to every Book, exactly as today. Settings lists "Book's choice" first.
- **Only session length follows the Book.** The Fast preset's other effect, the double step at the production level (0025 slice 11), stays global, because it is SRS state. `learning.ts` records why the settings are "global by force": one word has one SRS state across Books, and a per-Book step would have two rules writing one lexeme's level. Repetitions only decide how long *this* session is, which no other Book ever reads.
- **Existing learners.** `setLearning` persists the whole object. It is also what the in-session keyboard setup card's dismiss calls (`interactions.tsx:387-391`), so learners who never opened Settings may have `progression` stored as well, usually as `"normal"`. Their choice is kept, and they do not get Book defaults until they pick "Book's choice". This was accepted with the follow-up decision. There is no migration, since a stored value cannot be told apart from a deliberate one.
- **Value for `sa`** (content, plan 0028): `"fast"`, so one correct answer per concept per session. With §10, a new concept then costs one board, one MCQ and one flashcard across its first sittings.

### 12. The Check (2026-09-11, owner decision 2)

The pattern the review found on every platform that teaches knowledge rather than vocabulary: read a short unit, answer a few curated questions with explanations, and later take a mixed test. Microsoft Learn calls this a knowledge check; in Moodle it is a Lesson's question page. Drilling a check question at the preset's repetitions is what 0027 did before this amendment, and it is the wrong tool. So a unit's questions get their own page and leave the drill.

- **Where.** A **Check** page in `UnitScreen`'s trail, after the content pages (after Examples) and before the edit-only Exercises page. It is the last page a learner sees. It exists when the unit has at least one `choice`/`assign` task. In edit mode it is still shown only when it has questions, because there is no question editor (Non-goals), so an empty Check page would have no add control.
- **What the page shows.** The question count, "answered correctly: n / m" (**derived** from SRS: a question counts once its level is ≥ 1, the completion rule of 0025 §8, so nothing new is stored), and **Start check**. Start check always asks **every** question of the unit, on a first visit and on a return alike. A check is usually 3–5 questions, and "Retry the missed ones" covers the partial case. An all-question unit (0028 B4's 13) asks all of them too.
- **The session.** `buildFixedSession` over the unit's `choice`/`assign` tasks in `unit.taskIds` order: each question once, with immediate feedback from the §5 component. There is no drill queue, no repetitions and no reinsertion. The summary shows n / m and offers **Retry the missed ones**: the same session over the missed tasks.
- **Grading: once per question, ever.** A Check answer is graded into SRS through the ordinary `recordGrade` **only for a question whose level was 0 when the session opened**, meaning it has never been answered correctly. Any other question is graded against the no-op store: feedback, no state. Below level 4 the scheduler advances every correct answer whether it is due or not (`applyGrade`, `progress.ts:329-341`), so without this rule three retakes in one sitting would take a question from level 1 to 4. That would skip the spacing below and inflate the bar, and "checked once, then spaced" would be false. The rule is read once when the session opens, so a question answered wrong and then right on a same-session retry is graded both times, which is the ordinary new-card path. Once a question has been answered right, only Daily Review moves it.
- **Navigation.** The trail's bar is "one bar, two jobs" (`UnitScreen.tsx`): Next on every content page, Practice on the last page. With a Check, the Check page is the last page. On it, the bar is **Practice** when `drillItemIds` is non-empty. When it is empty:

- the bar is **hidden**;
- the trail's **practice dot** (`UnitScreen.tsx:1137-1142`, always rendered today) is hidden too;
- `goNext` (ArrowRight and the swipe as well as the bar) **does nothing** on that page.

The page's own Start check button is then the only action. The unit-session route with an empty `drillItemIds` redirects to **the unit screen, opened at the Check page**, not into the Check session. Every earlier page keeps Next.
- **Session exits.** Each session sends the learner to whichever half is unfinished, so neither offers "Next unit" while the completion guard would refuse it:
  - **After the Check**: if any `drillItemIds` item is below level 1, `nextAction` is **"Practice"**, which opens the unit session. Otherwise it is the ordinary Next unit, or Lesson complete when the unit finishes its lesson.
  - **After Practice**: if any Check question is below level 1, `nextAction` is **"Take the check"**, which opens the Check session. Otherwise it is the ordinary one.

  Neither session can change the other half's levels, since the Check never grades drill items and Practice never grades questions. So each session decides its label from levels read when it **opens**, synchronously, with no store read added before the summary. `UnitSession` already reads every `unit.itemIds` level once, and the Check session does the same. The optimistic `finishesLesson` label applies only in the ordinary case.
- **Spacing.** After the Check, a question is an ordinary scheduling unit, and Daily Review asks it on its level's interval (§5's `buildReviewSession` case). On the shipped rows that is **daily for the first few days**: Balanced is `1, 1, 1, 1, 2, 5, …` (`scheduler.ts:140`), so a question answered right in the Check is due tomorrow, and it gets its first two-day gap only after four daily correct answers. The once-per-question grading rule above is what keeps a retake from short-cutting this. A question answered wrong lands at the same place (level 0 or 1, both one day). For `sa`, at 3–5 questions a unit, that adds 3–5 cards a day per unit recently checked. This is accepted as the existing ladder's behaviour, not changed here; see Open questions.
- **Completion and the bar.** Question items are in `unit.itemIds`, so they count in the unit bar and in completion (every word at level ≥ 1, 0025 §8) with no change to `progress.ts`. **A unit with questions is complete only once its Check is passed.** That is intended: the Check is part of the unit, not an extra.
- **Practice without words.** A unit whose items are all questions has an empty drill (§5). Its Check page shows no bar (Navigation above), and the Check is its only activity.
- **Route.** Sessions in `route.ts` are path segments (`/practice`, `/recall/<id>`), not flags. The Check session is `#/books/<b>/lessons/<l>/units/<u>/check`.

This closes the original open question "whether a `question` item should be reviewable at all". The answer is yes, but through the Check and then Review, never the drill.

## Schema changes (`packages/schema`)

- `entities.ts`:
  - `questionOptionSchema` (incl. `why`) and `questionPayloadSchema` (incl. `explanation`, `generated`, `explanationGenerated`); `questionItemSchema` into `itemSchema`'s union;
  - `choice`/`assign` in `TASK_TYPES`, `EXERCISES`, the four contract records, **and plan 0025's exercise level table** (2 and 3, per §2a). The table is exhaustive over `TaskType`, so this does not compile without them;
  - `question` cases in the four presentation helpers (throwing, as `pair` does);
  - `examRulesetSchema`/`examSchema` (incl. `lessonId`);
  - `bookSchema.examIds` (**optional**, per §3) and `bookSchema.practiceDepth` (§11), with `PRACTICE_DEPTHS`;
  - `domainSchema.exercises` (§10).
- `documents.ts`: `BookDocument.exams?` (optional, §3); `CONTENT_SCHEMA_VERSION` → 3, with the reason in its comment and a line on why private content needs no migration.
- `validate.ts`: `Content.exams` and `ValidateContentInput.exams`; classes (ac)–(af), with (ad) placed before the owning-unit guard; exams in classes (c)/(j); the class (h) exclusion; the §3a edits inside (d)/(f).

## Engine changes (`packages/engine`)

- `session.ts`:
  - `ChoiceQuestion`/`AssignQuestion` and their `Question` union members, their graders, and `buildTaskSession` cases;
  - the `buildReviewSession` case;
  - `countTaskQuestions` cases for both types (one per item, truthful);
  - `buildFixedSession`;
  - `drillItemIds`;
  - `buildRecallSession` samples only non-`choice`/`assign` tasks.
- `draw.ts`: the `allowed` parameter on `availableExercises` (§10); `buildVisitQuestion` passes it through. **Landed 2026-09-11 (step 1).**
- `scripts/content-fs.ts` (the on-disk tree that `content.test.ts`, `pack-bbbook.ts`, `pull-book.ts` and `republish-content.ts` share): `loadContentDocuments` reads `<book>/exams/*.json` into `exams` **only when that directory exists**, leaving the key absent otherwise, so every existing tree loads byte-identically. `writeBookDocument` writes `exams/` only when `doc.exams` is non-empty. Without this, no exam could ever be authored for a scratch-tree Book (0028 phase B).
- `documentSource.ts`: pass `exams: doc.exams ?? []` into `ValidateContentInput`; `bookDocumentShapeError` unchanged (§3).
- `draftContent.ts`: `ParsedSet.exams` and `Content.exams` from `doc.exams ?? []`; `draftItem`'s `question` branch (§3); `draftBook` keeps `examIds`; `draftBook`'s `practiceDepth` and `draftDomain`'s `exercises`/`extraChars` are done (steps 1–2, guarded). `documentProblems.ts` then sees exams through `ParsedSet`, and in step 4 it gains §10's "cannot be practised" problem.
- **Kind and type sites step 3 must handle so it compiles alone and renders safely.** The list is split by behaviour; mirroring `pair` blindly is wrong, because `pair` returns a label on the render paths.
  - **Render and label paths return `payload.stem`:** `apps/web/src/screens/edit/exerciseOffers.ts` `itemLabel` and `KIND_PLURAL` (`"questions"`), and `apps/web/src/screens/edit/WhatChanged.tsx` `itemTitle`. Both files document that a throw there white-screens the page.
  - **Asset and validation loops skip a question as they skip a `pair`:** `validate.ts`'s per-item asset loop (a question has no `audioRef`/`imageRef`), and `exerciseOffers.ts` `hasAudio`/`hasImage`.
  - **Throw, as `pair` does:** the four presentation helpers in `entities.ts`, and `session.ts` `shadowingTranscript`.
  - **Need nothing:** `lookup.ts` `entryText` and `NoteEditor.tsx` `lexiconEntryText` already have `default` branches.
  - **Over `TaskType`:** `session.ts` `buildTaskSession` throws "choice/assign: not built until step 4". `countTaskQuestions` gets its real case, one per item.

  The step-3 spec re-runs `tsc` to catch any site this list missed, and it greps `switch (item.kind)` for switches with a `default` branch, since tsc stays silent on those. The list is a floor, not a promise. Over `Question`, step 4 adds a throwing placeholder branch to `interactions.tsx`'s `question satisfies never` switch, and step 6 replaces it.
- **`scoreExam(exam, answersByTaskId, content)`**: it needs `content`, because `n`, `c` and `w` come from the question item's options and labels, which an exam entry does not carry.
- New `exam.ts`:
  - `scoreExam(exam, answersByTaskId, content)` → per-question points, total, max, percentage, pass and the missed task ids (points below full): the pure function from §4, with the ruleset the only source of the rules;
  - `readinessByLesson(exam, pointsByTaskId, lessonIds)` → the §4 buckets plus the weakest lesson.
- `units.ts`: no code change. A test pins that a `question` item contributes exactly one scheduling unit, equal to its item id.

## Web changes (`apps/web`)

- `route.ts`: `#/books/<bookId>/exams/<examId>` with `?q=<n>` and `?end=1` (the sibling of the existing `/lessons/<lessonId>` route), a review-mode flag on it, `?practice=1` for practise-what-you-missed, and the unit Check session's `/check` path segment (§12).
- New `screens/ExamScreen.tsx` (intro), `ExamRunner.tsx` (runner, timer and navigator) and `ExamReport.tsx`; `App.tsx` screen variants and wiring; exam cards in `BookScreen`'s lesson list, after the lessons, with the derived "KI-generiert" badge and the last result.
- `progress/exam-attempts.ts` for the `bb.exam.<examId>` key; `progress/backup.ts`'s `bb.*` sweep already covers it.
- Renderers for the two new question kinds in the session UI: a `choice` capped at `selectCount`, an `assign` two-column row picker, and the post-grade feedback component (§5). The Check, practice, Review and the exam screens all reuse them.
- `UnitScreen`: the Check page (§12). `App.tsx`: the Check session, `drillItemIds` in the unit session, and the domain's `exercises` passed to `buildVisitQuestion`.
- `learning.ts`/`SettingsScreen.tsx`: the `"book"` progression (§11). `repetitionsPerWord` takes the Book's `practiceDepth`.

## Docs

- `docs/design.md`, **on landing, not on drafting** (the 0012 asset-pipeline precedent: "decisions graduate to the decision table when the code lands"). Rows for:
  - the `question` item kind and the two task types (the eleven-task-types line becomes thirteen);
  - the exam entity as a lesson-level sibling, and its ruleset-as-data decision;
  - the wall-clock resumable-attempt decision;
  - the `generated`/`explanationGenerated` flags;
  - the licence table from §8.

  For the amendment: the domain exercise allow-list (§10), the Book-declared depth and its "session length only" rule (§11), and the Check (§12). §§10–11 graduate when their own step lands, not with the rest.
- `docs/STATUS.md`: the `0027` row in the Plans table, updated per step.
- `.claude/skills/ingest/SKILL.md`: authoring notes for `question` items:
  - the affirmative label goes first where there is one;
  - the pick count is derived from the options;
  - `generated: true` on anything a model wrote, and `explanationGenerated: true` on a model-written explanation for a question that is not itself generated;
  - an explanation per question, and a `why` per option wherever the distractor encodes a specific misconception;
  - exam-only questions go in no unit (§3a).

  The scratch-tree section gains `domain.exercises` and `book.practiceDepth`.

## Implementation order (each step delegable; `pnpm check` green after every step)

Steps 1–2 are the amendment's independent half and ship first. Steps 3–9 are the original plan, amended.

1. **Domain exercise allow-list** (§10): the schema field, the engine filter, the `App.tsx` wiring, and `draftDomain` carrying the field for Preview. No bump. **Landed 2026-09-11.** Setting `exercises` on the live `sa` domain waits until step 6 has wired `drillItemIds` into the unit session. `sa` cannot hit the stall (§10), but it costs nothing to wait. Then republish (content, plan 0028).
2. **Book-declared practice depth** (§11): the schema field, `learning.ts`, Settings, `App.tsx`, and `draftBook` carrying the field. No bump. After it lands: set `practiceDepth` on `softwarearchitektur` and republish (content).
3. **Schema + validation** (§§1, 2, 3, 3a, 7, including `bookSchema.examIds`), plus the document/draft readers (§3) and the exhaustive-switch stubs (Engine changes) that let it compile alone. The `CONTENT_SCHEMA_VERSION` bump rides here. It may be delegated in two slices if one exceeds the context budget: entities/documents/readers/stubs, then the validator. **From step 3 until step 7, no version-3 content may reach any device.** The app accepts a v3 `.bbbook` from step 3 on, but it drills question items until step 6 wires `drillItemIds` into the unit session, and it throws on them until step 4. So no `question` item goes into a `pack-bbbook.ts` file or a republish before then. Step 10's republish comes after all of that by construction.
4. **Engine question shapes, graders, `buildFixedSession`, `drillItemIds`, the recall-session filter** (§5), plus the `interactions.tsx` placeholder branch. Depends on step 3's types.
5. **Engine scoring and readiness** (§4, `exam.ts`). Pure, and testable against the iSAQB ruleset with a hand-computed fixture. Depends only on step 3.
6. **Session UI for the two question kinds**: the renderers and the feedback component, wired into Review, plus `drillItemIds` in the unit session. Depends on steps 3–4.
7. **The Check** (§12): the page, the session, the `/check` route, the practice-dot and `goNext` rules, and hiding empty Remember links. Depends on step 6.
8. **Exam run** (§6): routes, the three screens, review mode, attempt persistence, backup inclusion, and the exam card with its last result. Depends on steps 5–6.
9. **`/ingest` authoring notes**. Independent.
10. **Bump procedure** (owner step, needs backend credentials): republish every listed document at `schema_version` 3, then re-export the bundled seed.

**Final: browser verification pass** (`apps/web:verify`), on a synthetic Book with:

- one `choice` question (3 correct of 5, with an explanation and one `why`) and one `assign` question (3 rows), both in a unit;
- one exam-only `choice` question;
- a two-question exam listed after the lessons, whose entries carry `lessonId`s.

Check that:

- the unit shows a Check page, the Check asks both unit questions once in authored order, feedback shows the explanation and the `why`, and the Practice drill never asks either;
- selection caps at 3;
- nothing grades before Submit, and navigating away and back keeps both the answers and the running clock;
- a deadline in the past submits on open;
- the report's arithmetic matches §4 by hand, and its per-lesson rows match too;
- the intro shows the description;
- review mode shows feedback per question and changes no `bb.item.*`, `bb.streak.*` or `bb.exam.*` key (`bb.navDiary` moves on navigation and is not part of the check);
- Practice in a unit with an unpassed Check ends on "Take the check", and a first Check in a unit with undrilled words ends on "Practice";
- on an all-question unit the Check page shows no bar, ArrowRight does nothing there, and the unit's practice URL lands on the Check;
- the exam-only question appears in no Check, Practice or Review until the report's practice session has graded it;
- the practise-what-you-missed session grades into SRS, while the exam itself changed no SRS state;
- a Book with no `examIds` shows no exam card and still loads.

Plus a `.bbbook` round trip (§9): export a private Book carrying an exam, re-import it, and get the same exam back.

## Done-criteria

- `pnpm check` is green after every step.
- **Schema:**
  - a `choice` task whose item carries `labels` fails validation, and so does an `assign` task whose item does not;
  - an exam referencing a `recall` task, a two-item task, a dangling task id or a dangling `lessonId` fails with a clear error;
  - an exam present in the document but absent from `book.examIds` fails, and so does the reverse;
  - an exam-only task (in no unit, referenced by an exam) passes, and the same task referenced by no exam fails as orphaned;
  - an exam-only task whose item also sits in a unit fails;
  - an exam-only `choice` task over a labelled item fails (class (ad) runs for exam-only tasks);
  - an exam id without the `<book.code>-` prefix fails (class (c)), and two exams sharing an id in one Book fail (class (j), which is per kind: an exam and a lesson may share an id, since `bb.exam.*` is its own key space);
  - a blank `explanation` or `why` fails;
  - an edit session on a Book with an exam-only question **and** a unit question reports **zero** problems. Its draft Preview keeps `examIds`, `practiceDepth` and the domain's `exercises`, and shows the unit's Check page;
  - a `.bbbook` whose `exams` is not an array lands in `broken` and does not throw.
- **A pre-bump private Book still loads** after the `CONTENT_SCHEMA_VERSION` bump, with no migration and no `examIds`. The additive-only policy (0017 decision 5) held.
- **Engine:**
  - `scoreExam` reproduces the iSAQB rules on a hand-computed fixture: a wrong single-answer question scores 0, not −1; a 2-point question with 2 of 3 marks right and 1 wrong scores 2 × (2−1)/3; and a fully blank `assign` question scores 0, with no penalty;
  - a fixture scoring **exactly** the pass mark through partial credit (31.2 of 52 at 60 %) passes;
  - `readinessByLesson` groups that fixture by `lessonId`, puts unlabelled entries under "Other" and never names it weakest;
  - `drillItemIds` excludes question items; excludes a sentence whose only tasks are `scramble`/`build` when `allowed` lists neither; and excludes an item whose only available exercise is `matching`. `documentProblems` reports each such non-question item;
  - a Check retake grades a question already at level ≥ 1 into no store, and a first-time question into the real one. A second practise-what-you-missed run changes no `bb.item.*` for questions answered right in the first;
  - a stored `choice` answer with an index past the options, or more selections than `selectCount`, is discarded on resume;
  - `buildRecallSession` over a unit with a `choice` task never returns a `choice` question;
  - with `allowed = ["matching", "recognize", "recall"]`, `availableExercises` never returns `write` or `recognize-produce`, and a drill over a concept draws `recall` at every new attempt from level 2 up.
- **Isolation:**
  - an exam run and review mode write **no** SM-2 state (`bb.item.*`) and no streak day (`bb.streak.*`), while the practice session offered by the report writes both. `bb.attempted` is dead since 0025 §8 and is neither written nor checked;
  - review mode writes no `bb.exam.*` key either.
- **Depth:** with progression `"book"`, a Book declaring `practiceDepth: "fast"` starts a drill owing 1 correct answer per word, and a Book declaring none owes 2. An explicit `"careful"` owes 3 in both. `schedulingConfig().levelsPerDay` is 1 under `"book"`.
- **Badges:** an exam whose questions all carry `generated` shows the badge on its card and its intro screen; one with a single non-generated question does not. An explanation from a question with `explanationGenerated` shows the badge.
- **Unchanged:** no existing task type, unlock logic or review-queue behaviour changes. The scheduling and completion rules change only as §§10–12 state: the drill's exercise set under a declared `exercises`, the drill's item set (question items excluded), and repetitions under `"book"`. A domain declaring no `exercises` and a Book declaring no `practiceDepth` behave exactly as before for any learner whose stored progression is not `"book"`.

## Open questions

- **Whether the generated exam ships publicly at all.** Answered by plan 0028 decision 4 (2026-09-10): yes, badged.
- **Daily Review load from Check questions** (§12). A checked question is due daily until it reaches level 4, which is the shipped interval row's behaviour for any new card. If `sa` learners find Review crowded by questions, the candidate fix is to let a question answered right in the Check enter the row at a higher index. That changes 0025's one-ladder rule, so it is an owner decision. Trigger: owner feedback after the first `sa` lessons carry questions. Owner: Moe.
- **The Fast double step under "Book's choice".** §11 makes `"book"` schedule as Normal, even in a Book declaring `"fast"`. If owners of such Books want the faster climb too, it needs a per-domain, not per-Book, step. That is a new decision, since a domain spans Books. Trigger: the first owner who asks. Owner: Moe.
