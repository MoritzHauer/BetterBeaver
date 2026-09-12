# Learning-format review: the software-architecture Book (2026-09-11)

Scope: how the `softwarearchitektur` Book ([plan 0028](plans/0028-software-architecture-books.md)) actually plays under the progression engine ([0025](plans/0025-progression-engine.md)), what [0027](plans/0027-authored-questions-and-exam-mode.md) will add, what comparable platforms do, and which options would make BetterBeaver a better platform for knowledge domains in general. Review only, no code or content changed. No doc-reviewer round was run.

Trigger: owner, 2026-09-11 — "levels and ladder is not really helpful here. They should all be curated. Single choice, multiple choice and flash cards are probably the best task types."

## Verdict

The owner's intuition is right, and the problem is narrower than "the ladder does not help":

- For **`question` items** (0027) the ladder is already a no-op. A question can only ever be asked as itself, so its "level" is just a counter that drives the interval. That is exactly what an exam-prep Book wants: a curated question that comes back on a spaced schedule.
- For **`concept` items** the ladder is actively harmful in a text-only Book. It turns each of ~300 definitions into a ten-step climb of which four steps are the same flashcard repeated, and it ends in "type the label the author chose" — an exercise the exam never asks and that fails on multi-word terms.
- Neither issue needs a new task type. The fix is **per-domain curation of which exercises exist**, plus two additions to 0027 that every platform surveyed treats as table stakes: an **explanation per question** and a **check-after-reading** placement for unit questions.

The one thing the app has that the surveyed platforms lack is spacing across sessions. Keep it. Everything below keeps the scheduler and changes what it is allowed to ask.

## 1. What the learner gets today (traced, not assumed)

A shipped unit (L1.2 "Bausteine und Schnittstellen"): one note of ~220 words, ten concepts (term, ≤25-word definition, example), and five authored tasks: `recognize`, `recall`, three `matching` boards of 3–4 pairs.

The exercises a concept can be asked as, from `TASK_EXERCISES` and the derived pair (`entities.ts:583-620`, 0025 §9):

| Level | Exercise                 | For a concept                                                              |
| ----- | ------------------------ | -------------------------------------------------------------------------- |
| 1     | `matching`               | board: terms ↔ definitions                                                 |
| 2     | `recognize` · comprehend | term → pick the definition (3 sibling definitions as distractors)          |
| 4     | `recognize` · produce    | definition → pick the term                                                 |
| 8     | `recall`                 | term → say the definition, reveal, self-grade                              |
| 9     | `write`                  | definition → **type the term**, exact match after case/punctuation folding |

Levels 3, 5, 6, 7 and 10 do not exist for a concept (audio and sentence exercises). Two mechanisms interact here:

1. The draw skips a missing level upward: the "new attempt" at level 2 is asked the level-4 exercise (`draw.ts:139-152`).
2. The scheduler advances **one level per correct answer, whatever exercise was asked** (`scheduler.ts:264-270`); it never reads the exercise.

So a concept's ten-level life is: board → term→definition MCQ → definition→term MCQ twice (levels 3, 4) → **the same self-graded flashcard four times** (levels 5–8) → type the term twice (levels 9, 10). Under Balanced pace that is spread over ~150 days (0025 slice 11's simulation), which is fine as a spacing schedule and meaningless as a difficulty ladder: the level number stops describing skill after level 4.

Concrete problems, in order of how much they hurt:

- **`write` is wrong for this domain.** Terms in the `sa` lexicon include "Angebotene Schnittstelle", "Architektur und Anforderungsmanagement", "Standpunkt (Viewpoint)", "R3 (Kennen)" and "Twin-Peaks-Modell". Typing them from a 25-word definition tests the author's labelling, not the concept, and `normalizeTypedInput` folds "(Kennen)" to a required word. A miss costs two levels and drops a 30-day interval to 8 days. The exam never asks a candidate to produce a term.
- **Sampled distractors do not target misconceptions.** `recognize` draws three sibling definitions from the same unit. "Ein Verein, der den Lehrplan …" is never confused with "Eine Sicht auf …". The exam's distractors are plausible statements written to catch a specific misunderstanding; that is authored data, which is precisely 0027's `question` item.
- **Definition-length boards.** A matching board shows 3–4 definitions of up to 25 words each on a phone screen. 0028 §3 already caps definitions at 25 words for this reason. Boards also give the last pair for free (0025 §2's own argument for level 1). They are a fine warm-up and a poor test.
- **Levels 5–8 are the same card.** Four consecutive "advances" are four repetitions of `recall`. The unit bar reads 50–80% while nothing new has been demonstrated. The bar is honest about repetitions and misleading about mastery.
- **Volume.** 32 units × ~10 concepts ≈ 300 scheduling units, each due daily through level 3 and on day 2 and 5 after. A learner working one unit a day carries a growing daily queue of definition flashcards within the first week. That is the Anki model, and it works for people who choose it, but it is not what a six-week exam prep looks like on any of the platforms below.
- **What is never asked: what the exam asks.** The iSAQB paper is 4 A / 21 P / 13 K questions; 34 of 38 are statement-judgement or scenario questions ("which four of these seven statements about cross-cutting concepts hold", "is method X suitable for a consistent documentation"). R1 means _apply_. Today's five exercises are all "define/name". 0027's `choice` and `assign` close that gap in principle — see §3 for the two ways the current design still undersells them.

What already works and should stay: Daily Review asks a concept as a **self-graded flashcard** and nothing else (`buildReviewSession`, `session.ts:934-968`); the level draw only runs inside unit practice. Notes are out of the review queue (0025 §13). The Unit screen's Theory → Concepts → Practice trail is the right reading flow for a knowledge domain.

## 2. What other platforms do

Surveyed 2026-09-11 from public documentation and reviews; sources at the end. "Pure Moodle courses" exist and are the common case in universities and corporate training: content as pages or a Book, activities as Quiz and Lesson, interactives via H5P.

| Platform                                                                                | Content presentation                                                                                                        | Exercise formats                                                                                                                                                                                                   | Feedback & grading                                                                                                                                                                                  | Scheduling                                                        |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Moodle Quiz**                                                                         | Question bank, categories, random draw from a category                                                                      | MCQ single/multi, true/false, matching, short answer, numerical, essay, **embedded answers (cloze)**, drag-and-drop text/image/markers, **ordering**, select-missing-words                                         | Per-option ("specific") feedback plus general feedback; modes: deferred (exam), immediate, **adaptive with hints and penalties**, interactive with multiple tries                                   | None; attempts and grades per quiz                                |
| **Moodle Lesson**                                                                       | **Content pages interleaved with question pages**; branching on the answer; a wrong answer can route to a remedial page     | Same question types, one per page                                                                                                                                                                                  | Per-answer response text and jump target                                                                                                                                                            | None                                                              |
| **H5P** (in Moodle, WordPress, Pressbooks)                                              | Course Presentation (slides with embedded questions), Interactive Book, Question Set                                        | Single choice set, MCQ, true/false, fill in the blanks, **drag the words**, mark the words, **summary** (pick the true statement, build a summary), dialog cards (flashcards), sort the paragraphs, image hotspots | Per-option feedback, retry, solution reveal; score bar per set                                                                                                                                      | None                                                              |
| **Microsoft Learn**                                                                     | Module = 5–10 short text units, then a **knowledge check** (3–5 MCQ, immediate feedback, unlimited retries), then a summary | MCQ only                                                                                                                                                                                                           | Right/wrong plus explanation per question; 100% first time earns bonus points                                                                                                                       | None; learning paths are linear                                   |
| **Brilliant**                                                                           | Every screen is a problem; explanation arrives after the answer, not before                                                 | MCQ, numeric, drag/arrange, simulations                                                                                                                                                                            | Explanation per problem; hints                                                                                                                                                                      | None                                                              |
| **Khan Academy**                                                                        | Video or article, then practice sets                                                                                        | Mostly MCQ and numeric                                                                                                                                                                                             | Hints, worked solution; **mastery per skill** (Familiar → Proficient → Mastered) earned from mixed quizzes and unit tests, not per fact                                                             | Mastery decays when unit tests are failed                         |
| **Quizlet**                                                                             | Term/definition sets                                                                                                        | Flashcards, **Learn** (adaptive: MCQ first, then written), Test (mixed MCQ, true/false, written, matching), Match (timed board)                                                                                    | Right/wrong; Learn promotes a term from MCQ to written                                                                                                                                              | In-session weighting; cross-session scheduling only on paid plans |
| **Anki** (dominant for medical and certification prep)                                  | None; cards only                                                                                                            | Basic, reversed, **cloze deletion**; MCQ is a poor fit and rarely used                                                                                                                                             | Self-graded, Again/Hard/Good/Easy; the "twenty rules" push atomic, unambiguous cards                                                                                                                | Full SRS (SM-2, FSRS)                                             |
| **Exam-prep sites** (Tutorials Dojo, Whizlabs; Udemy has a CPSA-F practice-test course) | Question sets by topic and by full exam                                                                                     | Single/multi MCQ mirroring the real exam's formats                                                                                                                                                                 | **Timed mode** vs **review mode** (answer and explanation after each question); an **explanation with references per question** is the product; retake only the missed ones; score per topic domain | None; explicit "readiness" per domain                             |

Research on the question-format question, which the owner's list implicitly raises:

- Retrieval practice in any format beats re-reading. Short-answer retrieval beats MCQ for long-term retention **without feedback**; **with feedback, MCQ is about as effective** (McDermott et al. 2014; the 2022 university study and the 2024 medical-education study both find the gap closes or reverses with feedback and effort).
- Feedback that explains **why each distractor is wrong** beats right/wrong feedback for transfer to new questions (medical-education RCT, PMC7550480). Every platform above that is used for exam prep ships this; the app has no field for it.
- Spacing and interleaving are the best-supported effects in the vault's own evidence note (`~/vault/projects/betterbeaver-research/learning-methods.md`). None of the platforms above except Anki and (partially) Quizlet does spacing at all. That is BetterBeaver's genuine edge and should not be traded away.

The pattern across the platforms that teach knowledge rather than vocabulary: **read a short unit → answer 3–5 curated questions with explanations → later, a mixed test**. Nobody drills definitions ten ways. Flashcards, where they appear (Quizlet, Anki, H5P dialog cards), are one format among several and are chosen by the learner, not imposed.

## 3. What plan 0027 gets right, and the two places it undersells itself

0027 is the right primitive: authored options with authored correctness, `choice` for A/P questions, `assign` for K questions, and questions as their own scheduling units. Two consequences of its placement decisions are worth reopening before slice 1 is built:

1. **Unit questions are drilled like words.** 0025 §6 owes every scheduling unit of a unit the preset's repetitions (Normal: 2 correct answers). A unit with 10 concepts and 5 questions becomes 30 correct answers per practice session, and the questions come back on the SRS schedule like any card. Both are defensible for a _bank_ of practice questions. Neither is what a _knowledge check_ is for. A check is answered once after reading, explained, and then belongs to the exam pool. 0027's open question "whether a `question` item should be reviewable at all" is really this question.
2. **No explanation field.** `questionPayloadSchema` carries stem, options, correctness and labels. The exam report "reveals the correct answer" and nothing else. For the official mock exam the source itself has only answer keys, so explanations are authoring work under 0028 §3's own-words rule — but the schema needs the slot first, and it is free to add before the type ships.

Neither reopens 0027's design. Both are additive fields or a placement rule.

## 4. Options

Ordered by size. Each names its mechanism and cost. Levels and the interval row survive in every option; what changes is which exercises a domain is allowed to ask.

### A. Curate the exercise set per domain (removes the harm)

**A1 — a domain-level exercise allow-list. Recommended.** An optional `domain.exercises?: Exercise[]` (additive, no `CONTENT_SCHEMA_VERSION` bump, same shape as `extraChars`). Absent means every exercise, so no shipped Book changes. `drawExercise` filters `available` by it; the coverage grid (0026 §8, unbuilt) reads the same field. For `sa`: `["matching", "recognize", "recall", "choice", "assign"]`, which deletes `write` and the produce-direction MCQ. A concept's life becomes: board → MCQ → flashcard (levels 3–10). The unit bar still climbs; it now measures spaced flashcard survival, which is what it is.

One schema field, one validator line, one filter in `draw.ts`, one test. Half a day.

**A2 — per-item ceilings** (`unit.itemTargets`, 0026 §5, designed and unbuilt). Right for "passive vs active vocabulary" in a language Book; wrong tool here, because the ceiling would be the same for all ~300 concepts and would have to be authored 300 times.

**A3 — a second level table per domain kind.** A `general` ladder with three rungs. Cleaner on paper, but it makes the level scale mean different things in different Books while the interval row and Settings are global by design (0025 §12). A1 gets the same result without a second constant.

### B. Read → check → drill (the Microsoft Learn / Moodle Lesson pattern)

Turn a unit's authored questions into a **Check** page between Theory and Practice, and treat concepts as the flashcard layer.

- **Check**: the unit's `choice`/`assign` questions, in authored order, answered once with immediate feedback and the explanation. No repetitions, no drill queue. Result shown as n/m; retry allowed. This is 0028 B1's "handful of questions per unit" with a home of its own.
- **Practice** stays the concept drill (A1 has already made it board → MCQ → flashcard).
- **Daily Review** takes question items on the ordinary schedule, so a question missed in the check comes back tomorrow, and a question answered right comes back in a week. The "reviewable at all" open question closes as "yes, but the check is not a drill".

Mechanism: a unit-level flag or simply "question items are owed one visit, not the preset's repetitions" in `startDrill`, plus a Check page in `UnitScreen` reusing the 0027 renderers. Depends on 0027 steps 1–4. Two to three days on top of 0027.

Rejected variant: interleaving questions inside notes, Moodle Lesson style. It would make notes non-atomic for pinning and editing (0021), and the trail already separates reading from checking.

### C. Explanations (the cheapest large win)

Add to `questionPayloadSchema`:

```ts
/** Shown after the answer in practice, in the Check, and in the exam report. Own words. */
explanation: z.string().optional(),
options: z.array(z.object({ text, correct, /** why this option is right or wrong */ why: z.string().optional() }))
```

Rendering: after grading, the explanation under the question; per-option `why` inline under each option where present. The exam report shows both per question. Free to add before 0027 ships; content work is per question and is the same authoring budget the surveyed exam-prep sites spend most of their effort on. For the 38 official questions the explanations are ours and carry no licence problem.

### D. Exam mode as the exam-prep sites do it (extends 0027 §6)

- **Review mode** next to timed mode: same question list, immediate feedback with explanation, no clock, no score kept. One flag on the run.
- **Retry the missed ones** exists already ("practise what you missed").
- **Readiness per lesson**: each exam entry gets an optional `lessonId` (the generated exam already names the book section per question; the official one can be mapped by hand). The report groups points by lesson and the Book screen can show "weakest lessons". This is the feature every certification-prep platform leads with, and it is where the concept drill's bar stops mattering.
- **Topic sets**: "all questions of lesson 3" as an ad-hoc untimed run over unit questions. Falls out of B plus the tag.

Half a week after 0027 lands. Needs the `lessonId` tag, which 0027 lists as a non-goal (curriculum tagging); the lesson id is a weaker, cheaper tag than LZ ids and is enough.

### E. Formats worth adding later, ranked by fit for knowledge domains

| Format                                             | Source                                                  | What it would teach here                                      | Fit                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Ordering / sequence                                | Moodle Ordering, H5P Sort the paragraphs                | ATAM steps, the design-process loop, a documentation workflow | High. Reuse `ScrambleQuestion` over authored lines; a `sequence` payload of ordered strings. Small. |
| Shared scenario stem                               | iSAQB scenario questions, Moodle "description" question | Apply R1 objectives to a case                                 | Medium. 0027 non-goal; needs a `scenario` wrapper around several questions.                         |
| Statement cloze / drag the words                   | H5P, Moodle embedded answers                            | Key sentences with the decisive word blanked                  | Low now. Needs a `sentence` without `translation` (0028 §6.3).                                      |
| Diagram labelling / hotspots                       | H5P, Moodle drag-and-drop markers                       | Views, C4, UML                                                | Later. Needs the asset pipeline (backlog 3).                                                        |
| Summary (pick the true statement, build a summary) | H5P Summary                                             | Chapter recap                                                 | Low; a `choice` with one correct option per row already covers it.                                  |
| Very short answer, auto-graded                     | Research favours it                                     | Type a term                                                   | **No** for this domain, for the reasons under §1's `write`.                                         |
| Confidence-weighted answers                        | Some medical prep tools                                 | Calibration                                                   | No.                                                                                                 |

### F. UX changes for the wider platform

- **Practice depth per Book, or per domain kind.** Settings are global by force (one word, one SRS state). But depth is a session-length preference, not SRS state, and "Normal" is 20 correct answers for a 10-concept unit, which is a lot of definition MCQs. A per-Book override (`bb.learning.depth.<bookId>`) is additive learner state. Alternatively the Book declares a default depth. Owner call.
- **The unit bar.** For a general domain the bar's honest reading is "how well spaced are these flashcards". With D's readiness per lesson, the Book screen for an exam Book should lead with readiness, and the bar can stay as the secondary number. No change needed until D exists.
- **Concepts page as a glossary.** Already a Term/Definition table. Make it searchable across the Book (the Vocabulary screen already does this for the domain lexicon; the Book-level entry is what a learner revising for an exam wants).
- **Skip the boards on repeat sessions.** A board answered three times has taught what it can. Not worth engineering; A1 plus depth 1 for question items already shortens sessions. Listed so it is not raised again.

## 5. Recommendation

Do these, in this order:

1. **Now, no code:** keep authoring phase A as it is. The content is fine; the definitions are short; the notes are the right length. Nothing about the content needs to change for any option below.
2. **A1**, the domain exercise allow-list. Removes `write` and the produce-direction MCQ from `sa` before any learner meets them. Independent of 0027.
3. **C** as an amendment to 0027 §1, before slice 1 is built: `explanation` and per-option `why`.
4. **B** as an amendment to 0027 §5/§6: question items are owed one visit in a drill, and the unit gets a Check page. Closes 0027's "reviewable at all" question.
5. **D** after 0027 lands: review mode and readiness per lesson.
6. **E's ordering format** when a unit needs it (L8 ATAM is the first candidate).

What this deliberately does not do: replace the scheduler, add a second level table, or make the ladder domain-aware in code. The ladder's only defect for this Book is two exercises it is allowed to pick; A1 stops it picking them.

## 6. Decisions for the owner

1. **A1 or A3?** Allow-list per domain (recommended) versus a separate ladder for `general` domains.
   -> A1
2. **Are unit questions checked once or drilled?** B says checked once, then SRS. The alternative, the current 0027 reading, drills them like words.
   -> As B says
3. **Explanations for the official mock exam:** author 38 explanations in our own words (yes, recommended: it is the single most valuable content item on every exam-prep platform surveyed), or ship answer keys only.
   -> yes, generated by you
4. **Practice depth:** global, per Book, or Book-declared default.
   -> Book-declared default
5. **Where D's lesson tag lives:** on the exam entry (`{ taskId, points, lessonId? }`) or on the question item. The entry is the cheaper and more honest place, since the same question could serve two exams.
   -> entry

## Sources

- Moodle question types: https://docs.moodle.org/502/en/Question_types · Moodle Lesson: https://docs.moodle.org/39/en/Lesson_activity and https://teaching-resources.delta.ncsu.edu/moodle-lesson/
- H5P content types: https://ecampusontario.pressbooks.pub/oerdevelopmentguide/chapter/h5p-content-types-examples/ and https://h5p.org/documentation/for-authors/tutorials
- Microsoft Learn module structure: https://learn.microsoft.com/en-us/answers/questions/5738212/in-the-training-section-what-is-the-difference-bet
- Brilliant vs Khan Academy: https://beginnersinai.org/brilliant-explained/ and https://studyboost.org/blog/brilliant-vs-khan-academy/
- Quizlet study modes: https://quizlet.com/ca/features/studymodes and https://learnclash.com/blog/does-quizlet-have-spaced-repetition
- Anki card design: https://controlaltbackspace.org/precise/
- Exam-prep platforms: https://tutorialsdojo.com/courses/aws-certified-cloud-practitioner-practice-exams/ and https://www.certsqill.com/blog/tutorials-dojo-vs-whizlabs/ · CPSA-F practice tests: https://www.udemy.com/course/isaqb-cpsa-f-tests-with-detailed-explanations/
- iSAQB question types and rules: https://www.isaqb.org/de/zertifizierungen/pruefungen/cpsa-foundation-level-pruefungen/ and the vault's mock-exam file
- Retrieval-practice formats: McDermott et al. 2014 https://pdf.retrievalpractice.org/guide/McDermott_etal_2014_JEPA.pdf · https://www.tandfonline.com/doi/full/10.1080/20445911.2022.2085281 · https://link.springer.com/article/10.1186/s12909-024-06538-0 · https://pubmed.ncbi.nlm.nih.gov/24059563/
- Distractor-rationale feedback: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7550480/
