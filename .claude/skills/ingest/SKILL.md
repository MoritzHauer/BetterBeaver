---
name: ingest
description: Curate one manual lesson (or sub-lesson group) into a BetterBeaver unit — notes, sentence items, lexicon entries, tasks. Repeatable per-lesson authoring pipeline from plan 0007.
disable-model-invocation: true
argument-hint: "The lesson/topic to ingest and its source line range, e.g. 'Family, lines 3154-3716'"
---

Curate the named lesson into shipped content. This is hand curation guided by a checklist, not an extractor — never write code that parses the manual. Content decisions (translations, dedup, task shape) are made here, not delegated to `implementer`.

**Read `docs/content-practices.md` first.** This file is the mechanics; that one is the reasoning behind the sizing, the task shapes, the question rules and the ship order, learned from the content already shipped.

The manual is `~/vault/sources/kyrgyz/Kyrgyz Language Manual/` (~12.5k lines of messy OCR: `ё`↔`е` confusions, garbled words, stray page numbers — trust the lesson body over its headers). Line ranges for the scoped backlog lessons (Transportation, Bazaar, Post Office, Appearance, Weather) are in `docs/plans/archive/0007-ingest-kyrgyz-manual.md` Context; the 8 unscoped lessons each need their own line-range pass first (same plan, step 4). The backlog itself is tracked in `docs/STATUS.md`.

The contract is `packages/schema/src/entities.ts` (item kinds, task validator floors — `RECOGNIZE_DISTRACTOR_COUNT`, the matching 2–5/no-duplicate-prompt cap (validator class (p)), `TASK_REQUIRED_ASSET`, cloze markup via `parseClozeMarkup`) enforced at startup by `validateContent`. Read it before authoring if unsure of a rule.

Since plan 0012 the backend is the content truth and `content/` is the frozen seed; for ingest, `content/` doubles as the local working copy. Author in `content/`, then ship to the backend (step 7) — content merely committed to git never reaches learners.

## Pipeline

0. **Sync.** Refresh `content/` from the backend first, so authoring doesn't rebase on a stale seed (in-app edits may have landed since the last export): `SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/export-content.ts`, then `corepack pnpm exec prettier --write content`. If `git diff content/` is non-empty, commit that refresh separately before authoring.
1. **Scope.** Pick the TEMA/сабак line range in the manual; map to one unit (existing or new). **Unit sizing:** a unit is one 5–15 minute session — aim for ~7–13 lexemes, at most 10 tasks, at most 3 notes (~15–28 pooled questions; `countUnitQuestions` is the engine's count). A manual lesson that yields more than that becomes several units chained via `unlocksAfterUnitId`, split along the lesson's own sub-themes. Set the unit's `goal` from "YOU WILL LEARN" (if enriching an existing unit that now covers more sub-lessons, update `goal` to summarize all of them, not just the first). Add a `resources.json` entry (`ky-resource-manual-<lesson>`) as the `sourceRef`, unless one already exists for this lesson. If this unit clearly leans on a specific earlier unit's vocabulary or grammar (e.g. giving directions needs numbers), consider setting `recallUnitIds` to that unit's id — a skippable "Remember: …" recall card on this unit's Overview (plan 0016). Opportunistic, not mandatory: most units won't need it.
2. **Vocabulary → lexicon entries.** Each VOCABULARY-box pair → a `lexeme` entry (`script`, `transliteration`, `gloss`, optional `example` from a dialogue line). The VOCABULARY box is not always complete or even present for the lesson's actual core terms — also check dialogue lines, phonetic-drill "listen and memorize" pair lists, and any phrasebook-style appendices for terms the box omits. Where the manual gives no gloss at all for a term you need, **do not guess a translation** — flag it to the plan owner instead of shipping a confident guess. **Dedup against existing entries first** — reuse ids, never duplicate. Group the lesson's new entries into a `family` (`content/lexicon/ky/families/`).

   **Note convention:** in `content/kyrgyz/notes/*.md`, wrap a Kyrgyz word or fixed phrase in single asterisks (`*сен*`) only when it has a matching lexicon entry — that's the signal a reader can look it up. Grammatical suffixes (`-ба/-бе/-бо/-бө`), one-off inflected forms illustrating a rule (`досум`, `балдар`), proper nouns, and full example/dialogue sentences aren't lexicon material — leave them unmarked (or **bold**, matching the existing suffix convention), don't italicize them. When adding a note, check every asterisk-wrapped span against the domain's entries before committing; add a missing entry if the word is genuinely reusable vocabulary, otherwise drop the asterisks.

3. **Texts → notes + sentence items.** Each dialogue → one note (`content/kyrgyz/notes/*.md`, a readable text) + one `sentence` item per line (`content/kyrgyz/items/*.json`, `sourceRef` the lesson resource). Grammar section → one note. Mark cloze-worthy sentences with `{{c1::…}}`.
4. **Exercises → tasks.** Build text-only tasks against the validator floors:
   - `recall` + `recognize` over the lesson's lexeme set (`recognize` needs ≥ `RECOGNIZE_DISTRACTOR_COUNT` + 1 = 4 same-kind items in the unit);
   - `matching` over lexemes — 2–5 items per task, no two items with identical prompt text; split larger sets across multiple matching tasks;
   - `cloze` / `scramble` / `build` over sentence items (scramble/build need ≥3 tokens after stripping cloze markup).
   - **Variant restraint** (plan 0011 review): add a task-type variant only when it drills a distinct skill (recognition vs. production vs. word order); don't stack recall+recognize+cloze+matching over the same item set by default — variants inflate the unit's question count without adding content.
5. **Wire.** Update the unit's JSON (`itemIds` = lexeme + sentence ids, `taskIds`, `noteIds`, `unlocksAfterUnitId` chaining the prior unit). If the unit is new, append its id to its **lesson's** `unitIds` (`content/kyrgyz/lessons/*.json`); if the lesson is new too, append the lesson id to `topic.json`'s `lessonIds` (topics own lessons, lessons own units — plan 0008).
6. **Validate.** Run `corepack pnpm check`. Then browser-verify one full session of the unit: read the text, tap a word to look it up, complete each new task type. Don't mark a lesson done without an actual browser session — a passing `pnpm check` only proves the content is structurally valid, not that it renders or reads correctly.
7. **Ship.** With check green: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts` (the service key lives only with the user — ask them to run it if the env vars aren't set). It bumps only changed documents and appends version history; see `supabase/README.md`. Then commit `content/` (the shipped state doubles as the refreshed seed) and update the backlog list in `docs/STATUS.md`.

## Scratch-tree Books (general domain)

For a Library Book that must **never** live in the repo's `content/` (frozen onboarding seed, plan 0015 decision 10), such as the software-architecture Book of [plan 0028](../../../docs/plans/0028-software-architecture-books.md). That plan is normative: §3 is the own-words rule, §4 gives the line ranges and LZ ids, §2 the id patterns. This section **replaces steps 0, 5, 6 and 7**. Steps 1–4 keep their sizing, with `concept` in place of `lexeme` and no `sentence` items.

- **Working tree:** `scratch.local/<book-id>/` (git-ignored via `*.local`), persisted between runs. Never commit it; the backend's `versions` table is its history. `export BB_CONTENT_DIR=scratch.local/<book-id>` for every command below.
- **Step 0 (sync):** only needed if the tree is lost, or once the Book is listed (in-app edits may land). `pull-book.ts` into an **empty** directory. An unlisted Book needs `SUPABASE_SERVICE_ROLE_KEY` to pull.
- **Step 2 (concepts):** each term a unit teaches becomes a `concept` entry in `lexicon/<domain>/entries/`: `term`, a **one-sentence** `definition` (≤ ~25 words; `recognize`/`matching` show it whole as an answer option), and an optional invented `example`. Dedup against the domain's existing entries. One `family` per lesson. Write with the source **closed** (§3).
- **Step 3 (texts):** one note per source section, in our own words. Invented examples only, never the book's.
- **Step 4 (tasks):** `recall`, `recognize` (≥ 4 concepts in the unit) and `matching` (2–5 per task) over the unit's concepts. No `cloze`/`scramble`/`build`: `sentence` needs a `translation` a German-only Book has no use for.
- **Domain and Book settings** ([plan 0027](../../../docs/plans/0027-authored-questions-and-exam-mode.md) §§10–11), set once per Book rather than per unit. A knowledge domain declares `exercises` on `domain.json` to keep unsuitable exercises out of practice. `sa` uses `["matching", "recognize", "recall"]`, which drops typing the term (`write`) and the definition→term MCQ. A Book may declare `practiceDepth` (`"careful"`/`"normal"`/`"fast"`) on `topic.json`; `softwarearchitektur` uses `"fast"`. Every non-question item must still keep at least one allowed exercise **other than `matching`**. Author a `recall` task over every concept, or the unit can never complete.
- **Goals** cite LZ ids, never LZ titles. Mark a unit whose LZs are all pure-R3 (plan §4a) with "(R3, nicht prüfungsrelevant)".
- **Step 5 (wire):** units into `lessons/<id>.json` `unitIds`, lessons into `topic.json` `lessonIds`, all inside the working tree.
- **Step 6 (validate), in order:**
  1. `corepack pnpm exec vitest run packages/schema/src/content.test.ts` with `BB_CONTENT_DIR` set;
  2. `python3 scripts/overlap-check.py --book "<vault book .md>" --lehrplan scratch.local/sources/lehrplan-cpsa-f-de.txt "$BB_CONTENT_DIR"`, which must exit 0;
  3. `node scripts/pack-bbbook.ts scratch.local/review.bbbook`, then import it in Settings in a **fresh** browser profile (`apps/web:verify` recipe) and play one session per new unit. An unlisted Book cannot be opened any other way.
- **Step 7 (ship):** `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts` with `BB_CONTENT_DIR` set. **No commit.** Then add one line per shipped unit to the plan's implementation log.

## Questions and exams (plan 0027)

**Gate:** author no `question` item and no exam, in any tree, `.bbbook` or republish, until plan 0027 steps 3–8 have landed **and** its step-10 schema-bump republish has run. Before then the app drills question items or throws on them (0027 step 3's deployment constraint). `docs/STATUS.md`'s 0027 row says where that stands.

**A `question` item** is book-owned (`items/`, book-code prefix, a resolving `sourceRef`). Its payload is `stem`, `options: [{ text, correct, why? }]` (≥ 2), and optionally `labels`, `explanation`, `generated` and `explanationGenerated`. The contract is `packages/schema/src/entities.ts` and validator classes (ac)–(af).

- **Type follows the payload.** `labels` absent → `choice` (select the correct options); `labels: [a, b]` present → `assign` (sort every row into one of two labels). The task type must match (class (ad)).
- **Affirmative label first** (`["Richtig", "Falsch"]`, `["Geeignet", "Nicht geeignet"]`), so `correct: true` reads as "holds". For symmetric pairs (Blackbox/Whitebox) the order is yours. Transcribed questions keep **the source's** order (0028 B2).
- **The pick count is derived, never authored.** A `choice` question asks for as many options as are `correct: true`, and it needs at least one of each. Put "Wählen Sie die drei …" in the task's `instructions` if you want it said.
- **Explain every question.** One `explanation`, the reasoning behind the answer as a whole, and a `why` on each option whose distractor targets a specific misconception. Own words; §3's overlap check covers both.
- **Mark model-written content.** Use `generated: true` on a question a model wrote, which covers its explanation too. Use `explanationGenerated: true` on a question taken from a source whose explanation a model wrote (the official exam's case).
- **Unit questions** go in the unit's `itemIds` and in a `choice`/`assign` task in its `taskIds`. Learners answer them once on the unit's Check page, then meet them in Daily Review. They are never drilled. Usually 3–5 per unit.
- **Exam-only questions** go in **no** unit. Their task is referenced only by an exam (class (af)), which keeps them unseen until the learner has taken the exam.

**Working shape, from the `sa` pass (2026-09-12):** three questions per unit — two `choice` plus one `assign` — in exactly two tasks, `sa-task-<n>-<m>-choice` and `-assign`, appended to the unit's `taskIds` in that order (the Check asks them in `taskIds` order). Item ids `<code>-item-q-<n>-<m>-<k>`. Write the `choice` pair as one multi-answer question (2–3 correct) plus one single-answer question, and give the `assign` question 3–4 rows. Add the new item ids to `unit.itemIds` too, or class (d) orphans them.

**An exam** is `exams/<id>.json` in the book tree, listed in `topic.json`'s `examIds`. Its fields:

- `id`, with the book-code prefix;
- `topicId`, `title`, and `description`, which the intro renders in full and which therefore carries any licence attribution;
- `questions: [{ taskId, points, lessonId? }]`, where each `taskId` names a one-item `choice`/`assign` task, and `lessonId` names the lesson the question tests, for readiness per lesson;
- `ruleset: { passPercent, timeLimitMinutes, partialCredit, negativeMarking }`. iSAQB's is `60 / 75 / true / true`. `scripts/content-fs.ts` loads `<book>/exams/*.json` when that directory exists (0027 step 3).
