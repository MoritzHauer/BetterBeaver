---
name: ingest
description: Curate one manual lesson (or sub-lesson group) into a BetterBeaver unit — notes, sentence items, lexicon entries, tasks. Repeatable per-lesson authoring pipeline from plan 0007.
disable-model-invocation: true
argument-hint: "The lesson/topic to ingest and its source line range, e.g. 'Family, lines 3154-3716'"
---

Curate the named lesson into shipped content. This is hand curation guided by a checklist, not an extractor — never write code that parses the manual. Content decisions (translations, dedup, task shape) are made here, not delegated to `implementer`.

The manual is `~/vault/sources/kyrgyz/Kyrgyz Language Manual/` (~12.5k lines of messy OCR: `ё`↔`е` confusions, garbled words, stray page numbers — trust the lesson body over its headers). Line ranges for the scoped backlog lessons (Transportation, Bazaar, Post Office, Appearance, Weather) are in `docs/plans/0007-ingest-kyrgyz-manual.md` Context; the 8 unscoped lessons each need their own line-range pass first (same plan, step 4). The backlog itself is tracked in `docs/STATUS.md`.

The contract is `packages/schema/src/entities.ts` (item kinds, task validator floors — `RECOGNIZE_DISTRACTOR_COUNT`, the matching 2–8/no-duplicate-prompt cap, `TASK_REQUIRED_ASSET`, cloze markup via `parseClozeMarkup`) enforced at startup by `validateContent`. Read it before authoring if unsure of a rule.

Since plan 0012 the backend is the content truth and `content/` is the frozen seed; for ingest, `content/` doubles as the local working copy. Author in `content/`, then ship to the backend (step 7) — content merely committed to git never reaches learners.

## Pipeline

0. **Sync.** Refresh `content/` from the backend first, so authoring doesn't rebase on a stale seed (in-app edits may have landed since the last export): `SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/export-content.ts`, then `corepack pnpm exec prettier --write content`. If `git diff content/` is non-empty, commit that refresh separately before authoring.
1. **Scope.** Pick the TEMA/сабак line range in the manual; map to one unit (existing or new). Set the unit's `goal` from "YOU WILL LEARN" (if enriching an existing unit that now covers more sub-lessons, update `goal` to summarize all of them, not just the first). Add a `resources.json` entry (`ky-resource-manual-<lesson>`) as the `sourceRef`, unless one already exists for this lesson.
2. **Vocabulary → lexicon entries.** Each VOCABULARY-box pair → a `lexeme` entry (`script`, `transliteration`, `gloss`, optional `example` from a dialogue line). The VOCABULARY box is not always complete or even present for the lesson's actual core terms — also check dialogue lines, phonetic-drill "listen and memorize" pair lists, and any phrasebook-style appendices for terms the box omits. Where the manual gives no gloss at all for a term you need, **do not guess a translation** — flag it to the plan owner instead of shipping a confident guess. **Dedup against existing entries first** — reuse ids, never duplicate. Group the lesson's new entries into a `family` (`content/lexicon/ky/families/`).
3. **Texts → notes + sentence items.** Each dialogue → one note (`content/kyrgyz/notes/*.md`, a readable text) + one `sentence` item per line (`content/kyrgyz/items/*.json`, `sourceRef` the lesson resource). Grammar section → one note. Mark cloze-worthy sentences with `{{c1::…}}`.
4. **Exercises → tasks.** Build text-only tasks against the validator floors:
   - `recall` + `recognize` over the lesson's lexeme set (`recognize` needs ≥ `RECOGNIZE_DISTRACTOR_COUNT` + 1 = 4 same-kind items in the unit);
   - `matching` over lexemes — 2–8 items per task, no two items with identical prompt text; split larger sets across multiple matching tasks;
   - `cloze` / `scramble` / `build` over sentence items (scramble/build need ≥3 tokens after stripping cloze markup).
   - **Variant restraint** (plan 0011 review): add a task-type variant only when it drills a distinct skill (recognition vs. production vs. word order); don't stack recall+recognize+cloze+matching over the same item set by default — variants inflate the unit's question count without adding content.
5. **Wire.** Update the unit's JSON (`itemIds` = lexeme + sentence ids, `taskIds`, `noteIds`, `unlocksAfterUnitId` chaining the prior unit). If the unit is new, append its id to its **lesson's** `unitIds` (`content/kyrgyz/lessons/*.json`); if the lesson is new too, append the lesson id to `topic.json`'s `lessonIds` (topics own lessons, lessons own units — plan 0008).
6. **Validate.** Run `corepack pnpm check`. Then browser-verify one full session of the unit: read the text, tap a word to look it up, complete each new task type. Don't mark a lesson done without an actual browser session — a passing `pnpm check` only proves the content is structurally valid, not that it renders or reads correctly.
7. **Ship.** With check green: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts` (the service key lives only with the user — ask them to run it if the env vars aren't set). It bumps only changed documents and appends version history; see `supabase/README.md`. Then commit `content/` (the shipped state doubles as the refreshed seed) and update the backlog list in `docs/STATUS.md`.
