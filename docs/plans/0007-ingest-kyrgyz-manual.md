# Plan 0007: Ingest the Peace Corps Kyrgyz manual into real units

Status: **reviewed — ready to execute** (3 adversarial review rounds, all findings fixed; see below) · Owner: Moe · Date: 2026-07-16 · Prerequisite: plan 0006 complete (it is)

## Purpose

Turn the Peace Corps *Kyrgyz Language Manual* (`~/vault/sources/kyrgyz/Kyrgyz Language Manual/`, ~12.5k lines) into shipped BetterBeaver content: units with **texts** (dialogues + grammar), **vocabulary** (lexicon entries), and **exercises** (tasks). This closes the STATUS gap "authoring real Kyrgyz sentence/cloze content is open" and is the first concrete run of the `/ingest` milestone.

The manual has **15 topical lessons** in total (its own table of contents, lines 68–96: Greetings, Family, Food, Apartment, Transportation, Kiosk, Bazaar, Grocery, Department Store, Post Office, Appearance, Health, Weather, Daily Routine, At Work). This plan scopes to **7 of the 15** — Greetings, Family, Transportation, Bazaar, Post Office, Appearance, Weather — as the v1 curation target; the other 8 (Food, Apartment, Kiosk, Grocery, Department Store, Health, Daily Routine, At Work) are not scoped by this plan at all (no line ranges picked, no pipeline run against them) and are left for a future `/ingest` pass.

`/ingest` here is a **repeatable, human-in-the-loop authoring workflow**, not an automated extractor. The manual is messy OCR (`ё`↔`е` confusions, garbled words like `езҭнчу`, stray page numbers `3126 32`, broken `img-58.jpeg` refs) and the research pass ([[materials-kyrgyz]]) already established that Kyrgyz has no off-the-shelf content pipeline — content stays curated. So the deliverable is (1) a thin repeatable process and (2) the first real lessons produced by running it.

## Context

- Manual lessons (TEMA sections, by line): Greetings/Partings (968), Family/Уй-булө (3154), Transportation/Автобекет (4638), Bazaar/Базар (6030), Post Office/Почта (7897), Body Parts/Appearance (8478), Weather/Climate (9638). Front-matter §0.x is grammar + alphabet (alphabet already shipped as `ky-unit-script-survival`).
- Each lesson has the same skeleton: **YOU WILL LEARN** (→ unit `goal`), **GRAMMAR** (→ note), dialogues under *Listen and act out dialogues* / **LET'S TALK** (→ texts), **VOCABULARY** (Kyrgyz–English pairs → lexicon entries), **PHONETIC DRILL** (→ audio tasks, deferred), **PRACTICE** (fill-the-blank, matching, divide-into-groups → text tasks).
- **The manual's own topic/lesson granularity is uneven.** The manual numbers atomic lessons (`сабак`) continuously across the whole book (First lesson … Twentieth lesson); topics don't map 1:1 to one `сабак` each. **Greetings (Topic 1) alone spans 7 sub-lessons** (`сабак` 1–7, lines 968–3153), each with its own YOU WILL LEARN/GRAMMAR/dialogues/VOCABULARY block (сабак 1: simple greetings; 2: + taking leave, polite register; 3: being greeted, plural nouns; 4: introducing yourself/others, singular personal pronouns; 5: personal info, **plural** personal + possessive pronouns — the manual's own header says "(singular)" but the grammar table and every example (БИЗ/СИЛЕР/СИЗДЕР/АЛАР) are plural, trust the body not the header; 6: personal info incl. marital status, genitive case; 7: polite requests, gratitude, imperative mood). A ~335-line "SELF LEARNING (to lesson 7)" appendix follows сабак 7 (lines 2818–3153) before Family starts — mostly review exercises, but lines 2970–3048 are a clean, already-translated phrasebook ("Memorize these expressions") organized into Greetings/Getting acquainted (Таанышуу)/Farewells (Коштошуу)/Apologies (Кечирим сурануу)/Requests (Өтүнүү) — in scope for vocabulary mining (pipeline step 2) since it's higher-quality source material than some of the sub-lessons' own VOCABULARY boxes. Transportation similarly spans 2 sub-lessons (11–12); Family, Bazaar, Post Office, Appearance, and Weather are each a single `сабак`. This matters concretely: `ky-unit-greetings`'s existing 16 lexemes already draw from at least сабак 1 (salam, rakhmat, jakshy…), сабак 2 (salamatsyzby, assalom-aleikum — polite register), and сабак 6 (aksakal — honorific), not from one dialogue block. (The manual's own in-body TEMA sub-titles split this range further — сабак 1–3 and 6 repeat "GREETINGS. PARTINGS.", сабак 4 is separately headed "TAAHЫШУУ. GETTING ACQUAINTED." — but the front-matter table of contents groups pages 25–79 as one "Topic 1. Greetings," and this plan follows that TOC-level grouping rather than the in-body sub-headers.)
- `ky-unit-greetings` already exists with lexeme vocab + `recall`/`recognize` tasks, but **no texts and no sentence-based exercises**. It is the natural proof lesson: enriching it demonstrates "add texts + exercises" against content already in the tree. **v1 scope decision: enrich it to cover all 7 Greetings sub-lessons**, not just сабак 1 — this is the biggest single lift in the plan but leaves no Greetings backlog after Step 2, and matches where the unit's existing vocabulary already draws from.
- The content contract lives in `packages/schema/src/entities.ts` and is enforced at startup by `validateContent`. Item kinds: `lexeme`, `concept`, `sentence`, `pair`. There is **no passage/text item kind** — see the design decision below.
- Per plan 0006: `lexeme` entries live in `content/lexicon/ky/entries/`; non-entry items (`sentence`) stay in the topic dir `content/kyrgyz/items/`; notes in `content/kyrgyz/notes/`.

## Goals

A learner can open the Kyrgyz topic and work through at least the first two manual topics (Greetings — all 7 sub-lessons — and Family) as full units — read each lesson's dialogue and grammar as a **text**, study its **vocabulary** in the per-domain lexicon, and drill it with text **exercises** (recall, recognize, matching, cloze, scramble, build) — with all content passing `corepack pnpm check` and one browser-verified session.

## Non-goals

- **No automated extraction / parser.** No code that reads the manual markdown and emits JSON. The OCR is too noisy; curation is by hand, guided by the `/ingest` checklist. (This is the load-bearing scope decision.)
- **No schema changes.** Texts reuse notes + `sentence` items (see Design). If a first-class dialogue-player UI is ever wanted, that is a separate plan.
- **No audio or picture tasks in v1.** `listen`/`dictation`/`shadowing`/`minimal-pair` need audio; `picture` needs images (`TASK_REQUIRED_ASSET` in entities.ts). TTS is feasible ([[materials-kyrgyz]]) but needs spot-checking + license review — deferred to a follow-up. v1 ships text-only tasks, matching how `ky-unit-greetings` already ships.
- **No frequency-ordered sequencing.** Units follow the manual's own lesson order; a generated frequency list is out of scope ([[materials-kyrgyz]]).
- **No new dependencies.** Authoring is JSON + markdown by hand; validation is the existing gate.

## Design

### Decision 1 — "Texts" = notes + sentence items (no schema change)

A lesson's dialogue is stored two ways, both already supported:
- as a markdown **note** (`content/kyrgyz/notes/*.md`) that renders the whole dialogue as a readable text — note views already support tap-to-lookup (plan 0006), so every word is inspectable; and
- as individual **`sentence` items** (`content/kyrgyz/items/*.json`, `{ script text, translation }`), which feed the exercises.

Grammar prose becomes a note too. This reuses the entire notes + sentence pipeline — no passage kind, no reading UI, no engine change.

### Decision 2 — `/ingest` is a checklist skill, not code

Author a thin `/ingest` skill (a prompt/checklist at `.claude/skills/ingest/` — markdown only, no code) that drives the per-lesson pipeline below. It is reused across the 7 scoped lessons, the 8 unscoped ones once each gets its own line-range pass, and future sources. It runs under `/author` (content decisions are never delegated to `implementer`, per the global workflow rules).

### Per-lesson pipeline (the `/ingest` checklist)

1. **Scope** — pick one TEMA line range; map to one unit. Set unit `goal` from "YOU WILL LEARN". Add a `resources.json` entry (`ky-resource-manual-<lesson>`) as the `sourceRef`.
2. **Vocabulary → lexicon entries.** Each VOCABULARY pair → a `lexeme` entry (`script`, `transliteration`, `gloss`, optional `example` drawn from a dialogue line). **The VOCABULARY box is not always complete** — the Family lesson's box (line 3211) has only 8 words (5 occupations plus 3 unrelated terms), while the family-member terms the lesson is actually about ("YOU WILL LEARN: To identify family members") appear only inline in the dialogue and in an untranslated "Listen, practice and memorize" pair list (line 3239). Also mine the dialogue lines and phonetic-drill pair lists for lesson-core terms the VOCABULARY box omits, and independently source glosses when the manual supplies none. **Dedup against existing entries** — reuse ids, never duplicate (greetings vocab already exists). Group the lesson's entries into a `family` (`content/lexicon/ky/families/`).
3. **Texts → notes + sentence items.** Each dialogue → one note (readable text) + one `sentence` item per line (`sourceRef` the lesson resource). Grammar section → one note. Mark cloze-worthy sentences with `{{c1::…}}` (validated by `parseClozeMarkup`).
4. **Exercises → tasks.** Build text-only tasks respecting the validator floors in entities.ts:
   - `recall` + `recognize` over the lesson's lexeme set (recognize needs ≥ `RECOGNIZE_DISTRACTOR_COUNT`+1 = 4 same-kind items in the unit),
   - `matching` over lexemes — **2–8 items per task, no two items with identical prompt text** (validator class (p), `validate.ts:478`); split larger lexeme sets across multiple matching tasks (greetings already has 16 lexemes, so this will bite immediately),
   - `cloze` / `scramble` / `build` over sentence items (scramble/build need ≥3 tokens after stripping cloze markup).
5. **Wire** the `unit.json` (`itemIds` = lexeme + sentence ids, `taskIds`, `noteIds`, `unlocksAfterUnitId` chaining the prior unit); append to `topic.json` `unitIds`.
6. **Validate.** `corepack pnpm check` (the startup validator enforces every class-(x) rule); then browser-verify one session of the new unit.

## Steps (each independently shippable; app works after each)

1. **`/ingest` skill.** Write the checklist skill (Decision 2) referencing `entities.ts` as the contract and this pipeline. Deliverable: the skill file. No content yet.
2. **Enrich Greetings (proof lesson, all 7 sub-lessons).** `ky-unit-greetings` already has its resource entry (`ky-resource-manual-greetings`) and two grammar notes wired — that scaffolding is done; the new work is dialogues from **all 7 Greetings sub-lessons** (сабак 1–7, lines 968–3153) **plus the SELF LEARNING phrasebook** (lines 2970–3048 — Greetings/Getting acquainted/Farewells/Apologies/Requests) as notes + sentence items, plus `cloze`/`scramble`/`build`/`matching` tasks (splitting matching across lexemes per the 2–8 cap above — the set will grow past the current 16 as сабак 3–7 and the phrasebook get mined in per pipeline step 2). Reconcile any manual vocab not yet in the lexicon. Update the unit's `goal` to summarize all 7 sub-lessons' objectives (taking leave, plural greetings, introductions, personal info, marital status, polite requests/gratitude) — the current goal only describes сабак 1. This is the biggest single-step lift in the plan (7 grammar points, dialogues across ~2200 lines) — treat it as the pipeline's real stress test, not a quick enrichment. Browser-verify.
3. **Family unit (fresh full lesson).** Apply the pipeline end-to-end to the Family/Уй-булө lesson as a brand-new unit (`ky-unit-family`), unlocking after greetings. This is the first from-scratch "texts + vocabulary + exercises" unit and validates the pipeline on unseen material, including the vocabulary-mining step above.
4. **Backlog + STATUS.** Record the remaining 13 lessons as `/ingest` backlog in STATUS.md: 5 already scoped in Context (Transportation, Bazaar, Post Office, Appearance, Weather — each a repeat of steps 2–3), plus 8 not yet scoped at all (Food, Apartment, Kiosk, Grocery, Department Store, Health, Daily Routine, At Work — each needs its own line-range scoping pass before the pipeline can run). Update STATUS.md: mark plan 0007, and note audio/picture tasks and the 13 remaining lessons as the remaining gaps.

## Verification

`corepack pnpm check` green after each step; one browser-verified session per new/enriched unit (read the text, tap a word, complete each new task type). No new gaps introduced to the quality gate.

## Open questions for review — resolved

- **v1 lesson count**: is Greetings + Family (2 topics) the right v1 cut, or should v1 ship more before calling the plan landed? Note the corrected scope: 13 lessons remain after v1, not 5 — 5 already scoped (Transportation — itself 2 sub-lessons, Bazaar, Post Office, Appearance, Weather) and 8 topics fully unscoped (Food, Apartment, Kiosk, Grocery, Department Store, Health, Daily Routine, At Work). Per-lesson labor is neither uniform nor mechanical: Family required independently sourcing glosses the manual doesn't supply, and Greetings alone is 7 sub-lessons — "rest are mechanical repeats" is retracted; the backlog's real labor is unknown until each topic gets its own scoping pass. **Resolved for this plan**: v1 stays Greetings (all 7 sub-lessons) + Family; the labor-volume uncertainty is accepted and tracked via Step 4's backlog rather than blocking v1.
- **Greetings reconciliation**: enrich the existing unit in place vs. leave it and start fresh at Family — **resolved: enrich in place, covering all 7 sub-lessons** (see Context and Step 2).
