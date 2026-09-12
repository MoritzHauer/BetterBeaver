# Content practices

What to keep in mind when authoring units, tasks and questions. The mechanics live in the `/ingest` skill; this file is the **why**, so a decision made once does not have to be re-argued per lesson. Rules here were learned from shipped content: the Kyrgyz Book (plans 0007, 0008), the software-architecture Book ([0028](plans/0028-software-architecture-books.md)) and the learning-format review of [2026-09-11](learning-format-review-2026-09-11.md).

Normative elsewhere, not repeated here: the validator classes (`packages/schema/src/validate.ts`), the task-type contracts (`entities.ts`), and the own-words/licence rules of the Book you are authoring.

## 1. The unit is a sitting, not a chapter

- One unit is **5–15 minutes**: roughly 7–13 words or concepts, at most 3 notes.
- A source chapter that yields more becomes several units, split along its own sub-themes, not at an arbitrary count.
- The unit's `goal` says what the learner can do afterwards, in their language. For a curriculum Book it also cites the objective ids it serves, never their titles (0028 §3).

## 2. Definitions are answer options, so keep them short

A `concept`'s `definition` is shown **whole** as an MCQ option and on a matching board. Over ~25 words it stops being readable on a phone.

- One sentence, aimed at ≤ 25 words. Depth belongs in the note.
- Write it so it is true on its own, without the term in it. "Wie stark Bausteine voneinander abhängen" works as an option; "Das ist, wenn …" does not.
- The `example` is where a concrete case goes, and it is invented, never lifted from the source.

## 3. Which exercises a domain should allow

A knowledge domain is not a language: some exercises teach nothing there and are actively annoying.

- Declare `domain.exercises` for any `general` domain. For software architecture: `["matching", "recognize", "recall"]`.
- **`write` is wrong** wherever the term is the author's label rather than a fact — "Standpunkt (Viewpoint)" is not something to type from a definition, and a miss costs two levels.
- **The produce direction** (definition → term) is equally wrong there: the exam never asks it.
- Every non-question item must keep **at least one allowed exercise other than `matching`**, or its unit can never complete. In practice: author a `recall` task over every concept. `documentProblems` reports an item that fails this.
- A language domain usually wants the full set; do not declare the field there.

## 4. Task shapes that earn their place

- **`matching`: 3–5 pairs.** Two pairs is not a question — clearing one hands the learner the other. Merge a leftover pair into a neighbouring board rather than shipping a 2-pair one.
- **`recognize` needs ≥ 4 same-kind items** in the unit, which is also the point at which distractors stop being obvious.
- **`recall` over every concept**: it is the flashcard the ladder lands on for the rest of the word's life, and (see §3) the exercise that keeps a unit completable.
- **Variant restraint** still holds for _sentences_: do not stack cloze + scramble + build over the same sentence set by default. It does **not** apply to the concept trio above — board → MCQ → flashcard is the ladder itself (`EXERCISE_LEVEL`), not three ways of asking the same thing.
- Give every task `instructions` in the Book's language. They are the only place "choose three" can be said.

## 5. Questions (`choice` / `assign`)

Authored questions are where a Book stops testing labels and starts testing understanding. Three to five per unit is the working size; they are answered once on the unit's **Check** page and then spaced by Daily Review, never drilled ([0027 §12](plans/0027-authored-questions-and-exam-mode.md)).

- **Write them from the note, not from the source.** If a question cannot be answered by someone who read the unit, it belongs to a later unit or to no unit.
- **Every distractor encodes a misconception someone actually has.** "Eine Schulung ist Voraussetzung" is worth asking because people assume it. A distractor nobody would pick teaches nothing and inflates the option list.
- **Say why it is wrong.** A `why` on a misleading option is what makes the question teach on the way past; research on distractor-rationale feedback is the reason the field exists.
- **One `explanation` per question**, the reasoning as a whole, not a restatement of the correct option.
- **The pick count is derived** from the options marked correct. Two or three correct options make a genuine P-question; one correct option is the A-question shape.
- **`assign` needs two labels and the affirmative one goes first** ("Richtig"/"Falsch", "Geeignet"/"Nicht geeignet"), so `correct: true` reads as "the statement holds". Where the pair is symmetric ("Blackbox"/"Whitebox"), the order is yours — but then every row must be decidable from the unit alone.
- **Aim for 3–5 rows** in an `assign` question. Each row is judged on its own, so a long list is a long quiz, not a harder one.
- **Mark provenance**: `generated: true` when a model wrote the question, `explanationGenerated: true` when only the explanation is ours on a transcribed question.

## 6. Sessions the learner actually gets

Worth knowing while authoring, because it decides how much is enough:

- A unit's **Practice** drill runs over its words, each owed the Book's practice depth in correct answers (`book.practiceDepth`; `"fast"` = one). Questions are not in it.
- The **Check** asks each question once, in `taskIds` order, with feedback.
- **Daily Review** then spaces both, and asks a concept as its recall flashcard.
- So the length a learner feels is `words × depth + questions`, not the number of tasks you authored.

## 7. Before it ships

In this order, because each step is cheaper than the next:

1. `BB_CONTENT_DIR=<tree> corepack pnpm exec vitest run packages/schema/src/content.test.ts` — the validator.
2. `python3 scripts/overlap-check.py --book <source.md> --lehrplan <curriculum.txt> <tree>` — the own-words rule over **every** learner-visible string, questions and explanations included. Exit 0 or it does not ship.
3. `node scripts/pack-bbbook.ts` + import in a **fresh** browser profile: play one session per new unit and one Check. A green validator proves the content is well-formed, never that it reads well.
4. Only then republish, and record what shipped in the plan's implementation log.
