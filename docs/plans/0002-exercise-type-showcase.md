# Plan 0002: Exercise-type showcase (demo topic with example inputs)

Status: signed off — 2 adversarial review rounds, then a grilling session (2026-07-07) that pinned the outcome-list grading contract, split normalization rule, scramble join-equality, wav+svg assets, and the engine API shapes · Owner: Moe · Date: 2026-07-06 · Prerequisite: plan 0001 step 7 committed (steps 8–9 trail in parallel; if step 9 hasn't landed, step 4 here owns the `globPatterns` extension)

## Purpose

Extend the schema/engine/web stack with the exercise types from the [exercise-types research](~/vault/projects/betterbeaver-research/exercise-types.md), demonstrated by a **demo topic with example inputs** (English/placeholder content, not Kyrgyz). Each type becomes playable in the browser before any real topic depends on it — de-risking the schema extensions (sentence items, cloze fan-out, asset refs, typed input) with throwaway content instead of authored content.

## Amendments to plan 0001

Plan 0001's M1 scope is untouched, but this plan explicitly amends three of its pinned rules (they were pinned for a two-type world):

1. **Roadmap**: image/audio task types no longer wait for M4's second topic; the demo topic is their first consumer.
2. **"Each itemId yields exactly one question in the session"** becomes **"each scheduling unit is graded exactly once per session"**: a cloze task over a 3-blank sentence yields three questions (one per blank, Anki-style — the other blanks are shown filled); a matching task grades all its units from one board question. "Item — the unit of SRS scheduling" likewise becomes "scheduling unit" (defined below); for `lexeme`/`concept` the two are identical, so nothing changes for existing content.
3. **"Review sessions always use the recall presentation and the recall self-grade mapping"** becomes per-unit-type: due `lexeme`/`concept` items and plain-`sentence` units review as recall/self-graded; a due cloze blank reviews as that one cloze question, auto-graded; a due `pair` reviews as a minimal-pair question, auto-graded.

## Context

- Baseline (plan 0001, steps 1–6 committed, step 7 in flight): `Item` is `lexeme | concept`; `Task.type` is `recognize | recall`. The research catalogue names the missing types and the data-model pattern to copy (Anki: author at sentence level, schedule per cloze blank; H5P: type schema vs. instance data — already how zod entities work here).
- The research table's per-type mappings are a synthesis draft, not independently fact-checked (its own caveat) — this plan is the schema RFC it asks for, and the adversarial review of this plan is the checking step for the mappings we adopt.
- All four architecture invariants (docs/architecture.md) hold: new types are union extensions in `schema`/`engine` plus new view components; the pinned `ContentSource`/`ProgressStore` interfaces do not change.

## Goals

One user can open the demo topic in the browser and play **every task type below end-to-end**, each backed by example content, with SRS scheduling working generically across all of them.

## Non-goals

- No speaking/pronunciation auto-scoring (ASR) — research verdict: out of scope; shadowing with self-grading is the substitute.
- No Kyrgyz content for the new types (arrives with unit 3+ or M2 `/ingest` once the types are proven).
- No TTS/asset production pipeline — demo assets are a handful of hand-placed files in the repo.
- No changes to SM-2, the grade-quality scale, or the pinned interfaces.
- No adaptive recognition→production promotion logic (the sequencing note in the research) — task ordering within a unit stays author-controlled, as today.

## Task-type catalogue (the contract)

Grading reuses the two existing mappings — nothing new enters `srs`. They apply in tasks **and** review:
- **auto** (system knows the answer): wrong → 2, correct → 4 (the existing recognize mapping).
- **self** (learner judges after reveal): Again → 2, Hard → 3, Good → 5 (the existing recall mapping).

| `Task.type` | Interaction | Grading | Item kind(s) | New needs |
|---|---|---|---|---|
| `recognize` | MCQ, 3 same-kind distractors | auto | lexeme, concept, sentence | — (shipped; sentence via new presentation helpers) |
| `recall` | free recall + reveal | self | lexeme, concept, sentence | — (shipped; ditto) |
| `cloze` | one question per blank: sentence shown with that blank empty, others filled; type the missing text | auto (normalized match) | `sentence` (≥1 blank) | `sentence` kind, blank markup, typed input, per-blank scheduling |
| `matching` | match N prompts to N answers from the task's items | auto (per item, see mechanics) | lexeme, concept, sentence (one kind per task, as today) | new interaction only |
| `scramble` | reorder shuffled tokens into the sentence | auto (join-equality: the learner's ordered token strings joined with single spaces must equal the target's — duplicate tokens interchangeable by construction; the view reports token strings, never chip identities) | `sentence` | `sentence` kind |
| `listen` | hear audio, MCQ over same-kind display texts | auto | lexeme/concept/sentence with `audioRef` | audio assets |
| `dictation` | hear audio, type what was said | auto (normalized match) | `sentence` with `audioRef` | audio + typed input |
| `shadowing` | hear audio, repeat aloud, reveal the audio's transcript (lexeme: `script` + `transliteration`; concept: `term`; sentence: stripped `text`), self-grade | self | lexeme/concept/sentence with `audioRef` | audio |
| `minimal-pair` | hear one clip, choose which of two near-homophones it was | auto (2-choice) | `pair` | `pair` kind, audio |
| `picture` | see image, MCQ over same-kind display texts | auto | lexeme/concept with `imageRef` | image assets |

`pair` items are usable **only** by `minimal-pair` tasks (validator class (o)); every other type takes the kinds listed. Translation L2→L1 / L1→L2 from the research table are **not** new types: they are the existing `recognize`/`recall` over lexeme payloads (the direction is a presentation detail already covered). Recording this here closes that research row.

**Typed-input normalization** (cloze and dictation; one shared engine function, applied to both the learner's answer and the target): Unicode NFC → lowercase → strip apostrophes (`'`, `’`) → replace every other Unicode category-P (punctuation) character with a space → trim and collapse internal whitespace runs to one space. (Split rule so `don't` → `dont` while `well-known` → `well known` — a blanket strip would glue hyphenated words and fail faithful dictation answers.) Proven here with Latin text; Cyrillic input method stays an open question below.

**Matching mechanics** (pinned): the board shows each item's prompt (its recognize-prompt text) and its answer (its display text), both sides shuffled by the injected RNG. The learner repeatedly selects a prompt+answer pair; a correct selection clears the pair, a wrong one clears nothing. Per item, the **first selection whose prompt side is that item** decides its grade (correct → 4, wrong → 2); later retries don't change it. The board persists until cleared. Task size is bounded by validator class (p): 2–8 items.

## Schema changes (`packages/schema`)

New item kinds (union extension, discriminated by `kind` as today):

- `kind: "sentence"` payload: `{ text: string, translation: string, audioRef?: stem }`. `text` may contain cloze markup `{{c1::word}}`, `{{c2::word}}` … (Anki syntax; numbers must be 1..N contiguous, each used exactly once; Anki's `::hint` suffix is unsupported and malformed under class (m)). `scramble`/`dictation`/`recognize`/`recall` use the markup-stripped text.
- `kind: "pair"` payload: `{ a: { script: string, audioRef: stem }, b: { script: string, audioRef: stem }, contrast: string }` — two near-homophones and what distinguishes them.

`lexeme` and `concept` payloads gain optional `audioRef` / `imageRef` stem fields.

**Assets**: `content/<topicId>/assets/audio/*` and `content/<topicId>/assets/img/*`. Pinned formats for the demo: `.wav` audio (espeak's native output — no conversion pipeline) and `.svg` images (hand-authorable as text, no binary blobs). The validator stem lists and PWA `globPatterns` are extension lists, so real content later adds `png`/`jpg`/`opus` etc. additively. Following the `noteStems` pattern, `validateContent` gains `audioStems: string[]` and `imageStems: string[]` inputs (two lists, so an `imageRef` can never validate against an audio file) and checks every ref resolves — no file I/O enters the package.

**Presentation helpers** extend per kind (schema owns these, per docs/architecture.md):

| helper | `sentence` | `pair` |
|---|---|---|
| `itemDisplayText` (MCQ choices, matching answers) | `translation` | throws — pair never feeds MCQ/matching/recall; class (o) makes the arm unreachable, but the exhaustive switch arm is permanent and pinned to throw |
| `recognizePrompt` (also matching prompt side) | stripped `text` | throws (ditto) |
| `recallPrompt` / `recallReveal` | show `translation` / reveal stripped `text` | throws (ditto) |

New validator classes (seeded fixture per class, continuing plan 0001's lettering): (m) cloze markup invalid — malformed, non-contiguous numbers, or a `cloze` task item with zero blanks; (n) dangling `audioRef`/`imageRef` (checked against the matching stem list, including `pair`'s nested `audioRef`s) or a `listen`/`dictation`/`shadowing`/`picture` task item lacking the ref its type needs; (o) task/kind mismatch — a type given an item kind outside its catalogue row, including anything but `minimal-pair` over `pair` items; (p) `matching` task with <2 or >8 items, or duplicate prompt-side texts among a matching task's items (two identical prompt cards would make the pairing undecidable); (q) `scramble` item whose stripped text has <3 whitespace tokens (nothing to reorder; whitespace tokenization is the research's caveat — fine for spaced scripts, revisit if a scriptio-continua topic lands); (r) MCQ sufficiency and uniqueness for the new types — a `listen`/`picture` task whose owning unit has <4 same-kind items (distractors are display texts, so candidates need not carry the asset themselves), or duplicate `translation` display texts per unit (extends class (h) to `sentence`).

## Engine changes (`packages/engine`)

- **Scheduling units** (pinned): every item contributes units as follows — a `sentence` item contributes `<itemId>::c<n>` per blank **iff some cloze task references it**, and `<itemId>` itself **iff some non-cloze task references it** (so a sentence in both a cloze and a dictation task has both, independent; grading one never touches the other, and no graded unit is ever invisible to the review queue). All other kinds contribute `<itemId>`. Derived ids can't collide with item ids — slugs forbid `:`. `ProgressStore` keys are opaque strings, so the interface is untouched; the engine derives the unit list from content and the review queue enumerates units, not items.
- **Session construction** per new type (injected RNG as today): cloze one-question-per-blank fan-out, matching board shuffling, scramble token-shuffling, MCQ distractor sampling for `listen`/`picture` (reusing the recognize sampler over display texts; class (r) guarantees it ≥4 candidates, same as (g) does for recognize), minimal-pair coin-flip of which clip plays.
- **Review sessions**: per amendment 3 — recall presentation for `lexeme`/`concept` and plain-`sentence` units; a due blank unit → its cloze question (auto); a due `pair` → a minimal-pair question (auto). Grade application (due/practice-only rule) is unchanged and applies per scheduling unit.
- **Pinned API shapes**: questions carry asset **stems**, never URLs (the web layer owns the stem→URL map via its asset glob, mirroring `noteStems`). Question grading uses the outcome-list contract: every question resolves to a list of `(schedulingUnitId, quality)` outcomes — single-unit questions return one entry, a matching board returns N when cleared; the app applies grades uniformly over that list. Review path: the engine gains `schedulingUnits(content): SchedulingUnit[]` (opaque unit id + owning item + blank number, if any); `reviewQueue` takes those units (not items); `buildReviewSession(dueUnits, content, rng)` — `content` to build cloze/minimal-pair questions from owning items, `rng` for the minimal-pair coin flip (the only nondeterminism in review).
- Typed-input normalization function lives here (pure), used by cloze and dictation checking.
- Unit completion/unlock logic: unchanged (task-attempt set is type-agnostic).

## Web changes (`apps/web`)

`SessionScreen` currently renders two question shapes; it grows one component per new interaction (typed input, matching board, token reorder, audio play button, image display, 2-choice audio). Views only render and forward answers; all checking/normalization is engine code. Asset files resolve to URLs via `import.meta.glob` over `content/*/assets/**`; **PWA precache note**: media files are emitted as separate bundle assets and vite-plugin-pwa's default `globPatterns` covers only js/css/html — plan 0001 step 9 (or step 4 here, if 9 already landed) must extend `globPatterns` to the audio/image extensions used, or the installed app violates the offline-first invariant.

## Demo content

`content/demo/` — topic `demo`, code `dx`, 2–3 units of English/placeholder example inputs sized so every task type has one task and every validator-relevant edge (multi-blank cloze, a sentence shared by cloze + dictation, matching batch, pair items) is exercised. Assets: a few short recorded/`espeak`-generated English audio clips and 2–3 small SVG images, committed to the repo. This content is **delegable** (unlike Kyrgyz content) — it's example inputs, not pedagogy; correctness = validator passes + each type playable.

Ships in the normal bundle alongside `kyrgyz` (it's a showcase, and a second topic in the list exercises multi-topic code paths for free).

## Implementation order (each step = one delegable spec; `pnpm check` green after every step)

Because `pnpm check` typechecks the whole workspace, a union extension in one package breaks exhaustiveness switches downstream (`buildTaskSession`'s `satisfies never`, `SessionScreen`'s `Question` narrowing). Steps 1 and 2 therefore each **include the minimal downstream type accommodation** (new switch arms that throw "not implemented", a widened `Question` narrowing) so every step compiles and stays green.

1. `packages/schema`: new kinds, two-list asset-stem validation, cloze markup parsing, task-type unions, presentation helpers per the table, validator classes (m)–(r) with seeded fixtures. Includes engine/web type accommodation.
2. `packages/engine`: scheduling-unit derivation, typed-input normalization, session construction for all new types, review-queue/review-session extension; clock- and RNG-injected tests including the shared cloze+dictation sentence case and independently scheduled blanks. Includes web type accommodation.
3. Demo topic content + assets + extend the disk-loading test to cover `content/demo/`.
4. `apps/web`: new `SessionScreen` interaction components; every task type playable against the demo topic; PWA `globPatterns` extension if step 0001-9 already landed.
5. End-to-end verification pass in the browser (all types, plus the review-independence walkthrough below via mocked clock in tests and a manual check).

## Done-criteria

- Every task type in the catalogue playable end-to-end in the browser from the demo topic.
- Cloze blanks demonstrably schedule independently (mocked-clock test, two rounds because every first SM-2 grade yields a 1-day interval: day 0 grade both blanks; day 1 grade blank 1 correct, blank 2 wrong; day 2 the queue holds only blank 2, blank 1 returns at ~day 7).
- A sentence shared by cloze and dictation tasks schedules `<itemId>` and its blank units independently (test per the engine section).
- `pnpm check` green after every step; validator catches one seeded fixture per class (m)–(r).
- Core packages remain topic-generic: nothing outside payloads/presentation helpers mentions languages or the demo topic.

## Open questions

- **Cyrillic typed input** (inherited from plan 0001): the showcase proves typed input with Latin text via the pinned normalization; whether Kyrgyz cloze/dictation needs an input-method note or on-screen keyboard is decided when the first Kyrgyz sentence unit is authored. Owner: Moe.
- **Kyrgyz audio production** (TTS vs. recordings, see materials-kyrgyz research) — needed before any Kyrgyz unit uses `listen`/`dictation`/`shadowing`/`minimal-pair`. Owner: Moe, trigger: first Kyrgyz audio unit.
- **Per-blank scheduling review**: pinned to Anki's per-blank model here; the Duolingo finding ("finer granularity isn't automatically better") says revisit at retro if reviews feel spammy.
