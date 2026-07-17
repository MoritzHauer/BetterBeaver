---
name: ingest
description: Curate one manual lesson (or sub-lesson group) into a BetterBeaver unit — notes, sentence items, lexicon entries, tasks. Repeatable per-lesson authoring pipeline from plan 0007.
disable-model-invocation: true
argument-hint: "The lesson/topic to ingest and its source line range, e.g. 'Family, lines 3154-3716'"
---

Curate the named lesson into shipped content. This is hand curation guided by a checklist, not an extractor — never write code that parses the manual. Content decisions (translations, dedup, task shape) are made here, not delegated to `implementer`.

The contract is `packages/schema/src/entities.ts` (item kinds, task validator floors — `RECOGNIZE_DISTRACTOR_COUNT`, the matching 2–8/no-duplicate-prompt cap, `TASK_REQUIRED_ASSET`, cloze markup via `parseClozeMarkup`) enforced at startup by `validateContent`. Read it before authoring if unsure of a rule.

## Pipeline

1. **Scope.** Pick the TEMA/сабак line range in the manual; map to one unit (existing or new). Set the unit's `goal` from "YOU WILL LEARN" (if enriching an existing unit that now covers more sub-lessons, update `goal` to summarize all of them, not just the first). Add a `resources.json` entry (`ky-resource-manual-<lesson>`) as the `sourceRef`, unless one already exists for this lesson.
2. **Vocabulary → lexicon entries.** Each VOCABULARY-box pair → a `lexeme` entry (`script`, `transliteration`, `gloss`, optional `example` from a dialogue line). The VOCABULARY box is not always complete or even present for the lesson's actual core terms — also check dialogue lines, phonetic-drill "listen and memorize" pair lists, and any phrasebook-style appendices for terms the box omits. Where the manual gives no gloss at all for a term you need, **do not guess a translation** — flag it to the plan owner instead of shipping a confident guess. **Dedup against existing entries first** — reuse ids, never duplicate. Group the lesson's new entries into a `family` (`content/lexicon/ky/families/`).
3. **Texts → notes + sentence items.** Each dialogue → one note (`content/kyrgyz/notes/*.md`, a readable text) + one `sentence` item per line (`content/kyrgyz/items/*.json`, `sourceRef` the lesson resource). Grammar section → one note. Mark cloze-worthy sentences with `{{c1::…}}`.
4. **Exercises → tasks.** Build text-only tasks against the validator floors:
   - `recall` + `recognize` over the lesson's lexeme set (`recognize` needs ≥ `RECOGNIZE_DISTRACTOR_COUNT` + 1 = 4 same-kind items in the unit);
   - `matching` over lexemes — 2–8 items per task, no two items with identical prompt text; split larger sets across multiple matching tasks;
   - `cloze` / `scramble` / `build` over sentence items (scramble/build need ≥3 tokens after stripping cloze markup).
5. **Wire.** Update `unit.json` (`itemIds` = lexeme + sentence ids, `taskIds`, `noteIds`, `unlocksAfterUnitId` chaining the prior unit); append the unit id to `topic.json`'s `unitIds` if it's new.
6. **Validate.** Run `corepack pnpm check`. Then browser-verify one full session of the unit: read the text, tap a word to look it up, complete each new task type. Don't mark a lesson done without an actual browser session — a passing `pnpm check` only proves the content is structurally valid, not that it renders or reads correctly.
