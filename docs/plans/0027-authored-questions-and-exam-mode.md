# Plan 0027: Authored-option questions and exam mode

Status: **designed** · Owner: Moe · Date: 2026-09-07 · Direction pinned by four owner decisions this session (two task types, not one; an exam is its own entity, run in one sitting, timed; exams sit at the same level as lessons; licence-encumbered questions ship as a private Book). Grilling deliberately skipped by the owner.

## Purpose

The platform has eleven task types and none of them can hold an exam question. `recognize` is the only multiple-choice type; it is single-answer, and its distractors are **sampled from sibling items in the unit** (`TASK_NEEDS_DISTRACTORS`, `RECOGNIZE_DISTRACTOR_COUNT = 3`). Measured against the iSAQB CPSA-F Beispielprüfung — 4 single-answer, 21 multiple-response, 13 row-assignment questions — **34 of 38 have no representable form at all**, and the remaining 4 only work if their options are authored rather than sampled.

So the missing primitive is not "exam mode". It is **authored-option questions**: a question whose options and their correctness are properties of the question, not derived from its neighbours. Exam mode is what gets built on top, and it is the smaller half.

Both halves are topic-generic. Nothing below knows about software architecture, iSAQB, or German. Kyrgyz gains from the first half immediately: authored distractors beat random siblings pedagogically, and `recognize` cannot express one today.

## Goals

After this plan:

- A new **`question` item kind**, book-owned like `sentence`/`pair`, carrying a stem and authored options.
- Two new task types, **`choice`** (select-n multiple choice) and **`assign`** (row-wise binary assignment against two authored labels), each with its own auto-grader. They are mutually exclusive over the same payload: a question with `labels` is an `assign` question, one without is a `choice` question, and the validator enforces the pairing.
- A new **`exam` entity**, a **sibling of a lesson under the Book**: a fixed, ordered, complete list of `{ taskId, points }` plus a **ruleset record** (`passPercent`, `timeLimitMinutes`, `partialCredit`, `negativeMarking`). The iSAQB rules are one such record, not a code path.
- An **exam run**: deferred grading (answers revisitable until one submit), a wall-clock timer that auto-submits at zero, a result report against the pass mark, and an explicit "practise what you missed" action that hands the missed questions to an ordinary practice session.
- Exam attempts persist locally with an absolute deadline, so an app kill does not void an hour's work — see design §6.
- Questions carry an optional **`generated` flag** marking model-written content that has had no expert review, mirroring `lexemePayload.exampleGenerated`.

## Non-goals

- **No editor UI** for questions, exams or rulesets. Authored in JSON via `/ingest`, exactly like `unlocksAfterUnitId` and `recallUnitIds` today; tracked as an editor long-tail gap, not built here. §9 records what this costs private Books and why it is survivable.
- **No exam gating or placement in the unlock chain.** Exams are siblings of lessons in the Book's list, always available, with no completion effect in either direction. Interleaving an exam between two specific lessons ("chapter 3 test") is a placement feature and a separate decision.
- **No exam generation.** An exam lists its questions; it never samples from a pool. That is what "fixed and complete" means, and it is the property a Unit's pooled shuffled practice session does not have.
- **No result history or readiness dashboard.** One current attempt plus the last result per exam. Score history per lesson is a good later idea and out of scope.
- **No new SRS path.** Exam scoring never writes SM-2 state: partial credit on a 2-point question is not a `Quality`. Missed questions reach SRS only through the ordinary practice session the report offers.
- **No proctoring, anti-cheat, or shuffling of options.** Offline-first app on the learner's own device; there is nobody to cheat.
- **No cross-book exams**, mirroring `unlocksAfterUnitId`/`recallUnitIds` scope.
- **No curriculum-goal tagging** (`LZ 1-7`-style), no scenario items with a shared stem across questions. Both are real ideas from the same brainstorm; both are separate plans.
- **No content authored by this plan.** The iSAQB exam Book is content work under `/ingest`, gated on the licence rule in §8.

## Relationship to plans 0025 and 0026

**Updated 2026-09-07**, after the owner question that also amended 0026 — "should the tasks be in the unit already for every format or should it be auto generated depending on the difficulty needed right now? Often the tasks will be hand crafted with the wrong answers as well." Neither plan is a prerequisite, and this one conflicts with neither, but designing it is what surfaced 0026's amendment, so the two now agree by construction rather than by luck.

**0026 fits this rather than fights it — and this plan completes its central pattern.** 0026's thesis is that a `Task` carries no authored decision, because the decision already lives on the item: `cloze`'s blank is markup in the sentence, `minimal-pair`'s pair *is* the item, `build`'s bank is constructed. A `question` item is the same shape and the clearest case yet — stem, options, correctness and labels are all payload, and the task type is derivable from it (`labels` present → `assign`, absent → `choice`). So a hand-crafted question with authored wrong answers is **item data, not task data**, and is playable with no authored task at all. That is now written into 0026 §3 as the corollary of its amended authored-wins rule.

What 0026 must **not** do is construct authored questions from nothing: options and their correctness are authoring, which is its own "no generated _content_" non-goal, unchanged.

**The exam-reference seam, restated under the amendment.** §3 has an exam list `taskId`s. 0026's amended §2 no longer materialises constructed exercises at all, so there are no generated task ids for an exam to reference by accident — every `taskId` in the content is authored by construction. The validator rule §7 (ae) already states is therefore sufficient on its own, and the "whichever plan lands second owns it" hand-off is resolved: nothing extra is needed on either side. Should 0026's phase 2 ever run (now cosmetic — see its §9), an exam-referenced task is authored and stays in `taskIds` regardless.

**0025 touches this through its level table, and that is still an open cell.** `choice` and `assign` need a level like every other exercise type, and this plan deliberately does not assign one: the ladder is 0025's to define, and guessing here would put a second source of truth beside it. Two hints for whoever does place them, from this plan's own material rather than from taste — a `choice` question shows every option on screen, which puts it near `recognize` at level 2 in the comprehension direction; an `assign` question requires a judgement on every row with no elimination help, which puts it higher. Both are recognition, not production, so neither belongs above the level-4 production boundary 0025 §5's day guard is built around.

**One gap neither plan closes**, recorded in 0026's open questions as well: hand-picked distractors for a **lexeme** have no home. A `question` item is the natural one, but it is its own scheduling unit, so суу-the-word and суу-the-question would carry separate SRS state and both come due — against plan 0006's "one word, one SRS state". The minimal shape is probably an optional link letting an authored question grade an existing scheduling unit rather than minting its own. Nothing in this plan depends on it; the exam use case has stand-alone questions throughout.

## Design

### 1. The `question` item kind (`packages/schema/entities.ts`)

```ts
const questionOptionSchema = z.object({
  text: z.string().min(1),
  /** The statement holds. For `choice` that means "is a correct answer";
   *  for `assign` it means "belongs to labels[0]". */
  correct: z.boolean(),
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
  /** Model-generated, not taken from a source, and without an expert review
   *  pass. Same purpose and same honesty as `lexemePayload.exampleGenerated`;
   *  it sits on the question rather than the exam because a generated
   *  question in a Unit, outside any exam, needs the mark just as much. */
  generated: z.boolean().optional(),
});
```

Two decisions worth naming:

- **One `correct: boolean` serves both types.** For `assign`, `true` means the row belongs to the first label. That reads naturally wherever one label is the affirmative one, which covers most row-assignment questions — so **"the affirmative label goes first" is an authoring rule**, stated in the schema comment and in `/ingest`, not enforceable by code. Symmetric pairs (Blackbox/Whitebox) have no affirmative side and the order is simply the author's.
- **How many options to pick is derived, never authored.** For `choice` it is the count of `correct: true` options; for `assign` it is the row count. A separate `select` field could disagree with the options, so there isn't one. The human-readable "choose the three that fit best" goes in the task's existing optional `instructions`.

A `question` is **book-owned**, like `sentence` and `pair` — not a lexicon entry. `DOMAIN_ENTRY_KIND` is untouched.

`itemDisplayText`, `recognizePrompt`, `recallPrompt` and `recallReveal` get a `question` case that throws, exactly as `pair` does (`pairUnsupported`): a question item only ever feeds its own two task types, and every other presentation is unreachable by construction.

### 2. The two task types (`packages/schema/entities.ts`)

`TASK_TYPES` gains `choice` and `assign`, and all four contract records — each of which carries the comment "adding a type forces a decision here" — get the same rows for both:

| record | `choice` | `assign` |
| --- | --- | --- |
| `TASK_ALLOWED_ITEM_KINDS` | `["question"]` | `["question"]` |
| `TASK_REQUIRED_ASSET` | `null` | `null` |
| `TASK_NEEDS_DISTRACTORS` | `false` | `false` |

`TASK_NEEDS_DISTRACTORS: false` is the load-bearing one: options are authored, so the MCQ sampler must not run and classes (g)/(r) must not demand same-kind siblings. Precedent is `build`, which already constructs its own word bank from the payload rather than sampling.

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
  description: z.string(),
  questions: z.array(z.object({ taskId: slugSchema, points: z.number().int().min(1) })).min(1),
  ruleset: examRulesetSchema,
});
```

Points sit on the exam's own list rather than on the question, because they are the exam's weighting: the same question is worth 1 point in one exam and 2 in another. The iSAQB record is `{ passPercent: 60, timeLimitMinutes: 75, partialCredit: true, negativeMarking: true }`.

**An exam is a sibling of a lesson, one level under the Book** (owner decision). `bookSchema` gains

```ts
examIds: z.array(slugSchema).optional(),
```

next to `lessonIds`, and the Book screen lists exams in the same list as lessons, after them, in `examIds` order. `#/books/<bookId>/exams/<examId>` is already the sibling of `#/books/<bookId>/lessons/<lessonId>`, so the route shape needs no special case.

**`examIds` is optional, and that is forced, not a style choice.** Plan 0017 decision 5 makes the schema policy for private content **additive-only**, because no admin republish can ever reach a Book that exists on one device. A required `examIds` would permanently break every private Book already authored. For the same reason the bump in §7 is safe for private content: a private Book authored before it contains no `question` items and no `choice`/`assign` tasks, so there is nothing to migrate — and `content/private-migrations.ts` is there for the day something does.

`BookDocument` gains `exams: unknown[]`; `Content` and `ValidateContentInput` gain `exams`. Exams live **inside** the book document — no new document kind, so `documentId`'s `"topic" | "domain"` union is untouched, and a private Book's `.bbbook` export carries its exams for free (§9).

### 4. Scoring (`packages/engine`, one pure function)

For a question worth `P` points, with `n` marks required (`choice`: the count of correct options; `assign`: the row count), `c` correct marks given and `w` wrong ones:

- `partialCredit: false` → `P` if `c === n && w === 0`, else `0`.
- `partialCredit: true` → `P × (c − (negativeMarking ? w : 0)) / n`, **floored at 0**.

That one formula covers all three iSAQB question types. A single-answer question is `n = 1`: right scores `P`, wrong scores `−P` and floors to `0`. An unanswered row in an `assign` question is neither correct nor wrong, so it contributes nothing and costs nothing — which is the iSAQB rule for a blank row, falling out rather than special-cased. The exam total is the sum; pass is `total ≥ passPercent% × maxPoints`.

**The floor at 0 is hardcoded, not a ruleset field.** It is what "negative marking" means in every ruleset we have; a ruleset that lets a question drag the total negative can add the field when one exists.

**Deliberate deviation from the paper rules, recorded here rather than discovered later:** the iSAQB rules score a question 0 when the candidate marks more answers than requested. The runner instead **caps selection at `n`**, so over-selection is unreachable and the rule never fires. Every reachable state scores identically to paper; what is lost is the strategy of deliberately over-marking to guarantee a hit, which the penalty exists to punish. If paper fidelity is ever wanted it is one ruleset flag plus one branch in the scorer.

### 5. Engine question shapes and grading (`packages/engine/session.ts`)

```ts
export interface ChoiceQuestion {
  kind: "choice"; unitId: string; stem: string;
  choices: string[]; correctIndices: number[]; selectCount: number;
}
export interface AssignQuestion {
  kind: "assign"; unitId: string; stem: string;
  rows: string[]; labels: [string, string]; correctLabelIndex: number[];
}
```

Both join the `Question` union with auto-graders alongside `checkTypedAnswer`/`checkScrambleAnswer`. Option order is the authored order — not shuffled, so a question reads the same in practice as in the exam and an author can rely on "all of the above" style ordering.

`buildTaskSession` gains a case per type. **Scheduling: one unit per question item**, `id` equal to the item id — no `::` suffix, nothing new in `units.ts` beyond letting `question` fall through the existing "all other kinds contribute `<itemId>`" rule. `buildReviewSession` gets a `question` case returning that item's own `choice`/`assign` question, the same rule `pair` and cloze blanks already follow.

Grading in a **practice** session is the ordinary auto path (wrong → quality 2, correct → 4); partial correctness counts as wrong there. Exam scoring (§4) is a separate calculation that touches no SRS state.

### 6. The exam run (`apps/web`)

Three screens behind `#/books/<bookId>/exams/<examId>`:

- **Intro** — title, question count, max points, pass mark, time limit, and Start. If an unfinished attempt exists it says how much time is left and offers Resume instead.
- **Runner** — one question at a time (`?q=<n>`), a question navigator showing answered/unanswered, free movement in both directions, a visible countdown, and Submit. **No feedback of any kind before submit** — this is the one genuinely new interaction in the app, since every existing question grades immediately.
- **Report** (`?end=1`) — total, percentage, pass/fail against the ruleset, per-question points with the correct answer revealed, and one button: practise the questions you missed, which launches an ordinary practice session over those tasks and grades them into SRS normally.

**Attempt persistence** (`bb.exam.<examId>` in `localStorage`, alongside the existing `bb.item.*` / `bb.attempted` / `bb.streak.*` keys): `{ attempt?: { startedAt, deadlineAt, answers }, lastResult? }`. The deadline is an **absolute timestamp**, so the clock is wall-clock and never pauses: closing the app, backgrounding it, or having the PWA evicted all leave the attempt intact and resumable with the elapsed time gone. Opening a resumed attempt past its deadline submits it immediately with whatever is answered. That is what "one run" means here — you cannot bank half an exam and come back fresh tomorrow, but Android reclaiming memory does not cost you the attempt. The strict alternative (leaving the exam voids it) was considered and rejected by the owner.

`progress/backup.ts` must include the new key: learner state on-device with export/import as the durability floor is a standing requirement, and an in-flight attempt is learner state.

**Surfacing**: an exam card in the Book screen's lesson list, after the lessons, marked with its time limit and point total — and with an "KI-generiert" badge when every one of its questions carries `generated` (derived, never stored twice). Exams are not part of the lesson/unit unlock chain and have no completion effect on it.

### 7. Validation (`packages/schema/validate.ts`)

New classes, continuing after (ab):

- **(ac)** — a `question` payload: ≥2 options; with `labels` absent, at least one `correct: true` **and** one `correct: false` (an all-correct choice question is degenerate); with `labels` present, both labels non-blank. Question items are excluded from class (h)'s duplicate-display-text check exactly as `pair` items are, since `itemDisplayText` throws for them.
- **(ad)** — task/payload pairing: every item of a `choice` task must have no `labels`; every item of an `assign` task must have `labels`. This is what makes the two types mutually exclusive over one payload shape.
- **(ae)** — exams: `topicId` resolves to this book; every id in `book.examIds` resolves to an exam in the document and every exam in the document is referenced by `examIds` exactly once (ownership both ways, as `lessonIds` already has); every `taskId` resolves, is of type `choice` or `assign`, and holds **exactly one** item (an exam entry carries one question's points, so a multi-item task would be ambiguous); no duplicate `taskId` within an exam; `questions` non-empty. Unit practice tasks may still hold several question items — the one-item rule binds only exam-referenced tasks.

`CONTENT_SCHEMA_VERSION` **bumps to 3**. This is not covered by the 0015 §6a additive-optional exemption: a strict discriminated union in an older client rejects an unknown task type and an unknown item kind outright. The §8 bump procedure applies in full — bump, admin republishes every listed document, re-export the bundled seed.

### 8. Content and licence — three exams, three destinations

The candidate question sources have **different licences**, and plan 0017's private Books are what let all three exist without any of them being in the wrong place. This plan authors none of them; it fixes where each may go.

| Source | Licence | Destination |
| --- | --- | --- |
| **iSAQB Beispielprüfung** — `~/vault/sources/software-architecture/iSAQB CPSA-F Beispielprüfung.md`, 38 Fragen / 52 Punkte, Dokumentversion 2026.2 | Free redistribution for exam preparation **provided iSAQB® e.V. is named as source and copyright holder**; use in a real exam forbidden | **Public Library Book.** The attribution is a licence condition, so it goes in the Book description *and* the exam's `description`, not only in a repo comment. |
| **Rheinwerk Anhang A** — the book's own Beispielfragen | Copyrighted, no redistribution grant | **Private Book.** Never published, never in the Library, never on the backend. §9 is how it gets created. |
| **KI-generierte Übungsprüfung** — `~/vault/sources/software-architecture/Übungsprüfung Softwarearchitektur (KI-generiert).md`, written this session: 38 Fragen (4 A / 21 P / 13 K), 52 Punkte, same ruleset, each question anchored to a book section | Ours | **Public Library Book**, every question carrying `generated: true`. |

Every question item needs a resolving `sourceRef` like any other item, so each exam's origin document becomes a `resource` on its Book — the mock-exam PDF for the first, the book for the second, and for the third a resource that says plainly what it is.

**On the generated exam specifically:** it is honest practice material and nothing more. It is model-written, has had no expert review, and — the part worth saying out loud in the Book description as well as in the vault file — **it is calibrated against nothing**. Scoring 65 % on it does not predict 65 % on the real exam. That is exactly what the `generated` flag exists to keep visible, and why the badge is derived and rendered rather than left to the description.

### 9. Private exams, and the editor gap that bites here

"Anhang A stays private" is only meaningful if a private exam can actually be created, and this plan ships no editor for questions or exams (Non-goals). Checked rather than assumed: **it can, through the `.bbbook` import path, and that path is clean.**

A `.bbbook` is a plain JSON file — `{ kind, formatVersion, schemaVersion, book: BookDocument, domain: DomainDocument, assets }`. `checkImportFileShape` (`content/private-transfer.ts`) enforces only `kind` and a `schemaVersion` no newer than the app; the real checking happens in `content/source.ts`'s import, which runs the same `validateContent` every other content path runs. Nothing requires the Book to have been created in-app first. So a hand-built file carrying `exams` is validated exactly like a published Book's, and a malformed one is rejected rather than half-loading.

That makes the creation path for a private exam: build the `.bbbook` outside the app, import it through Settings. Ids are `crypto.randomUUID()` per 0017 decision 4. It is a developer's path, not a learner's — which is acceptable **because the one private exam this plan anticipates is the owner's own**, and unacceptable as a general answer. The in-app gap (create and edit questions, exams and rulesets on the learner screens, the way plan 0021 did for everything else) is real and belongs on the editor long-tail list, not in this plan.

Deliberately not solved here: 0017 non-goal "no publishing path" still stands, so a private exam cannot later be promoted to the Library. For the Anhang A exam that is the point, not a limitation.

## Schema changes (`packages/schema`)

- `entities.ts`: `questionOptionSchema`/`questionPayloadSchema` (incl. `generated`), `questionItemSchema` into `itemSchema`'s union; `choice`/`assign` in `TASK_TYPES` and the three contract records; `question` cases in the four presentation helpers (throwing, per `pair`); `examRulesetSchema`/`examSchema`; `bookSchema.examIds` (**optional**, per §3).
- `documents.ts`: `BookDocument.exams`; `CONTENT_SCHEMA_VERSION` → 3 with the reason in its comment, and a line noting why private content needs no migration.
- `validate.ts`: `Content.exams`, `ValidateContentInput.exams`, classes (ac)/(ad)/(ae), class (h) exclusion.

## Engine changes (`packages/engine`)

- `session.ts`: `ChoiceQuestion`/`AssignQuestion` + `Question` union members, their graders, `buildTaskSession` cases, `buildReviewSession` case.
- New `exam.ts`: `scoreExam(exam, answers)` → per-question points, total, max, percentage, pass — the pure function from §4, with the ruleset the only source of the rules.
- `units.ts`: no code change; a test pinning that a `question` item contributes exactly one scheduling unit equal to its item id.

## Web changes (`apps/web`)

- `route.ts`: `#/books/<bookId>/exams/<examId>` with `?q=<n>` and `?end=1` — the sibling of the existing `/lessons/<lessonId>` route.
- New `screens/ExamScreen.tsx` (intro), `ExamRunner.tsx` (runner + timer + navigator), `ExamReport.tsx`; `App.tsx` screen variants and wiring; exam cards in `BookScreen`'s lesson list, after the lessons, with the derived "KI-generiert" badge.
- `progress/exam-attempts.ts` for the `bb.exam.<examId>` key; `progress/backup.ts` includes it.
- Rendering for the two new question kinds in the session UI (a `choice` capped at `selectCount`, an `assign` two-column row picker), reused by practice sessions and the exam runner alike.

## Docs

- `docs/design.md`: rows for the `question` item kind and the two task types (the eleven-task-types line becomes thirteen), the exam entity as a lesson-level sibling and its ruleset-as-data decision, the wall-clock resumable-attempt decision, the `generated` flag, and the licence table from §8. **On landing, not on drafting** — the 0012 asset-pipeline precedent ("decisions graduate to the decision table when the code lands").
- `docs/STATUS.md`: a `0027` row in the Plans table.
- `.claude/skills/ingest/SKILL.md`: authoring notes for `question` items — affirmative label first where there is one, the pick count derived from the options, and `generated: true` on anything a model wrote.

## Implementation order (each step delegable; `pnpm check` green after every step)

1. **Schema + validation** — §§1, 2, 3, 7, including `bookSchema.examIds`. No dependency on later steps; the `CONTENT_SCHEMA_VERSION` bump rides here.
2. **Engine question shapes + graders** — §5. Depends on step 1's types.
3. **Engine scoring** — §4, `exam.ts`. Pure, testable against the iSAQB ruleset with a hand-computed fixture; depends only on step 1.
4. **Session UI for the two question kinds** — the renderers, wired into ordinary practice sessions first. Depends on steps 1–2, independent of the exam runner.
5. **Exam run** — §6: routes, three screens, attempt persistence, backup inclusion. Depends on steps 3–4.
6. **`/ingest` authoring notes** — independent.
7. **Bump procedure** (owner step, needs backend credentials): republish every listed document at `schema_version` 3, re-export the bundled seed.

Final: **browser verification pass** (`apps/web:verify`) — a synthetic Book with one `choice` question (3 correct of 5), one `assign` question (3 rows), and a two-question exam listed after the lessons: selection caps at 3; nothing grades before Submit; navigating away and back keeps the answers and the running clock; a deadline in the past submits on open; the report's arithmetic matches §4 by hand; the practise-what-you-missed session grades into SRS while the exam itself changed no SRS state; a Book with no `examIds` shows no exam card and still loads. Plus a `.bbbook` round trip (§9): export a private Book carrying an exam, re-import it, and get the same exam back.

## Done-criteria

- `pnpm check` green after every step.
- Schema: a `choice` task whose item carries `labels` fails validation, and so does an `assign` task whose item does not; an exam referencing a `recall` task, a two-item task, or a dangling task id fails with a clear error; an exam present in the document but absent from `book.examIds` fails, and so does the reverse.
- **A pre-bump private Book still loads** after the `CONTENT_SCHEMA_VERSION` bump, with no migration and no `examIds` — the additive-only policy (0017 decision 5) held.
- Engine: `scoreExam` reproduces the iSAQB rules on a hand-computed fixture — a wrong single-answer question scores 0 rather than −1, a 2-point question with 2 of 3 marks right and 1 wrong scores 2 × (2−1)/3, and a fully blank `assign` question scores 0 with no penalty.
- An exam run writes **no** SM-2 state, no `bb.attempted` entry, and no streak day; the practice session offered by the report writes all three.
- An exam whose questions all carry `generated` shows the badge on its card and its intro screen; one with a single non-generated question does not.
- No existing task type, scheduling rule, unlock/completion logic or review-queue behaviour changes.

## Open questions

- **Whether a `question` item should be reviewable at all**, or exam-only. This plan says reviewable (§5), because a question that can never come back is a worse flashcard than the `concept` it tests. If reviews of them turn out to be noise, dropping the `buildReviewSession` case is a one-line reversal.
- **Whether the generated exam ships publicly at all.** §8 says it may; whether an AI-written, unreviewed mock exam belongs in a public Library next to the official one is a judgement call about the Library's character, not a technical constraint. Keeping it private costs nothing and forecloses nothing.
