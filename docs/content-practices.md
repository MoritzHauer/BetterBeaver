# Content practices

What to keep in mind when authoring units, tasks and questions. The mechanics live in the `/ingest` skill; this file is the **why**, so a decision made once does not have to be re-argued per lesson. Rules here were learned from shipped content: the Kyrgyz Book (plans 0007, 0008), the software-architecture Book and the learning-format review of [2026-09-11](learning-format-review-2026-09-11.md).

Normative elsewhere, not repeated here: the validator classes (`packages/schema/src/validate.ts`) and the task-type contracts (`entities.ts`).

## 0. Book plans and licensed sources

**Each Book has a content plan, kept out of the repo.** It lives at `books.local/<book-slug>/plan.md` in the owner's checkout, git-ignored by `*.local` like `content.local/`. Before a Book's first unit its plan must say three things: what of each source may and may not be reproduced (with each source's licence), how the source splits into lessons and units (with section or line ranges and the curriculum objective ids each unit serves), and the Book's id patterns. The rules below hold for every Book; the plan adds only what is particular to its sources.

- **Own words by default.** When a source grants no redistribution, structure is free but expression is not. Every learner-visible string is ours: notes, `definition` and `example`, unit and lesson `title`/`goal`, task `instructions`, Book and exam `description`s, questions and explanations. Read the section, then write with it closed; nothing is copied or closely paraphrased, and that includes a source's review lists and a curriculum's objective titles.
- **Selection and arrangement count too.** Re-wording a list the source made up itself (its own nine rules as a nine-item list) can still copy it. Teach that idea in a structure of our own. Lists that are the field's common property (SOLID, the ISO 25010 characteristics) are exempt, and established public material (named patterns, ATAM, arc42, C4, 4+1) may be named and explained freely.
- **Examples and figures are invented**, never the source's running example or its figures.
- **Cite objective ids, never their titles.** A curriculum's ids and which topics it covers are facts; its wording is not ours. A goal reads "Kopplung und Kohäsion bewerten (LZ 03-04, 03-06)". The overlap check can't catch a copied five-word title, so this rule does.
- **The overlap check is mechanical and blocking.** `scripts/overlap-check.py` flags any run of 8 or more consecutive words shared with a source, after case-folding and stripping punctuation, over every learner-visible field. 8, not fewer, because technical terms recur legitimately. It normalises the sources so it doesn't fail open (footnote digits glued to words removed, a glossary's explanation column taken on its own), and its self-test must flag a verbatim source sentence and pass a fresh one. A curriculum may be checked against the owner's local text extraction, which is never committed. §7 says where it runs.
- **Verbatim only where a licence allows it, and then exactly.** A transcribed text keeps the source's wording **and its option order**, even against our affirmative-first rule (§5): reordering would change a text we claim to reproduce. Transcribe by parser where one exists, checked against the source's own answer key, and from the printed original when an extraction is lossy.
- **Honour every licence condition where learners see it.** Attribution a licence requires goes into learner-visible text, the Book `description` and the exam's `description`; resource titles and `sourceRef`s show only on editor screens, so they don't count. A free-of-charge condition holds for as long as the content stays public; if the Library ever charges, that content stays free or leaves.
- **Nothing implies endorsement.** A Book named after a registered mark or a certifying body opens its `description` with a non-affiliation sentence and, when a model helped write it, an AI-assistance sentence. Neither may be dropped, and the Book card's two-line clamp means the sentence saying what the Book is goes first.
- **Model-written content is badged and checked like ours.** `generated: true` (§5) on every model-written question, and the overlap check plus a read for selection-and-arrangement copying before it ships, since a model writing from a source tends to reproduce its selections.
- **Material without a public licence never leaves the owner's device.** It goes into a private Book (own domain, UUID ids, plan 0017), packed with `pack-bbbook.ts` and imported in Settings, and is never committed or uploaded.
- **Exams sit in the Book they test**, after its lessons, not in a Book of their own: a second Book would duplicate the domain and give the same concepts two independent review states. For the same reason, a question that already ships in one Book is dropped from another rather than drilled twice.
- **Don't invent a calibration.** Questions from a source that gives no ruleset or time limit become a practice unit, not an exam.

## 1. The unit is a sitting, not a chapter

- One unit is **5–15 minutes**: roughly 7–13 words or concepts, at most 3 notes.
- A source chapter that yields more becomes several units, split along its own sub-themes, not at an arbitrary count.
- A unit may be **notes only** (an info unit): no tasks and no items, at least one note. Validator class (i) allows exactly that case; items without tasks are still an error.
- The unit's `goal` says what the learner can do afterwards, in their language. For a curriculum Book it also cites the objective ids it serves, never their titles (§0). A unit whose objectives are all outside the exam says so in its goal, e.g. "(R3, nicht prüfungsrelevant)" for CPSA-F, so a learner short on time can skip it; the Book plan's objective table decides, not the source's own side-note labels.

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

**First, the card review** (`/card-review <tree> <unit-id>…`, §8). It comes before the gates because its rewrites would invalidate every check after it. **Run it twice per unit**, the second time over the reworked unit. One run is one sample: in the L0/L1 rework, the second pass still sent back over half of the first pass's rewrites, which the gates had all passed ([retro](card-rework-retro-2026-10-17.md)). `/ingest` step 6 says how to settle the two passes. Then the gates, in this order, because each step is cheaper than the next:

1. `BB_CONTENT_DIR=<tree> corepack pnpm exec vitest run packages/schema/src/content.test.ts` — the validator.
2. `python3 scripts/overlap-check.py --book <source.md> --lehrplan <curriculum.txt> <tree>` — the own-words rule over **every** learner-visible string, questions and explanations included. Exit 0 or it does not ship.
   - **A transcribed exam is the one exception, and it narrows the candidates rather than the rule.** Its question text is reproduced verbatim under a licence, so it is not ours to reword and a run it shares with the textbook is not a finding. Point the blocking check at the authoring file instead (`content.local/authoring/<exam>.json`), which holds exactly our words — explanation, `why`, title, description — and must exit 0. Then run it over the tree too and confirm by hand that every remaining hit sits inside a verbatim field; a hit anywhere else is a real one.
   - Proper names a licence **requires**, such as the copyright holder's legal name, will trip an 8-word run. Reword around it — changing the word order is enough — rather than lowering `--n`, and never at the cost of the attribution itself.
3. `python3 scripts/card-check.py <tree>` — a second model answers every card from its front alone (definition → term among the unit's siblings, question from the unit's notes, cloze from the gapped sentence), and plain checks catch a front that gives its answer away, or correct options that all stand out by length. A flagged card is rewritten, not argued with: AMBIGUOUS is usually right (Сен күтүп ___ really takes отурасың, жатасың or турасың). There are two exceptions, and each is declined with its reason in the summary:
   - **A re-roll:** the card's text is unchanged since a run it passed. card-check asks one prompt per unit, so editing any card in the unit re-asks all of its cards.
   - **A bare label** that a blind reader can only guess, such as "A-/P-/K-Frage". Any wording that made it guessable would leak the answer (`/card-review` A7).

   Watch the flag rate per batch; a rule that keeps causing flags belongs in this file. After shipping, the same loop runs on learners: `node scripts/pull-feedback.ts <tree>` lists every card that got a 👎 or an open report, next to its text.

4. `node scripts/pack-bbbook.ts` + import in a **fresh** browser profile: play one session per new unit and one Check. A green validator proves the content is well-formed, never that it reads well.
5. Only then republish. Nothing goes into the repo afterwards: the backend's `versions` table and the working tree's git history are the record.

## 8. Fewer, better cards

Every card that ships costs every learner reviews for as long as they keep the Book, so it has to earn them.

`/card-review` holds the full checklist. It runs in a fresh agent that has not seen the drafting, because a second look by the author shares the first look's blind spots ([research](card-authoring-research-2026-10-16.md)). Draft against it:

- **One thing per card.** A definition is also the back of a self-graded `recall` card, and with three facts on it the learner can't grade honestly. Keep the fact that tells the term apart. The rest goes into the note or the `example`.
- **Sets become questions.** A list-shaped definition (four benefits, five kinds of stakeholder) is rewritten to the idea that unites the items. The list goes into a `choice` question, which judges each item on its own. A closed, named set that is itself the fact may stay.
- **Terms, not headings.** "Architektur und Betrieb" tells a learner on `recall` nothing about what to retrieve. A split of responsibilities is an `assign` question, and an idea gets its real name.
- **Taught and on-goal.** Every card retrieves something its unit's note teaches, as part of what the goal promises. Trivia such as founding years and counts goes into the note.
- **Tell neighbours apart across the Book.** card-check sees one unit at a time, but interference builds up across units (`Kapselung` against `Information Hiding`). Give each card the clause that sets it apart, and contrast the pair in the note.
- **A question asks what the cards can't.** Re-asking a definition the concept trio already drills wastes the question. Ask for an application, a distinction or a misconception, and avoid test-wise cues: the correct option the longest, "immer" only in distractors.
- **A cut is a success.** On a first draft, a third or more of the cards not kept is normal. Don't pad to reach §1's range, and don't backfill after cuts. The §4 floors are the only counts that bind, and a bad card never stays to hold one.
- **Facts stay with people.** The reviewer never rewrites a fact; a doubtful claim goes to the owner. Models both miss inverted facts and flag correct ones.
