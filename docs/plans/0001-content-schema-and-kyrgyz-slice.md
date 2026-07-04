# Plan 0001: Content schema and Kyrgyz vertical slice

Status: approved after 5 adversarial review rounds (round-5 verdict: APPROVE conditional on 3 fixes, all applied) · Owner: Moe · Date: 2026-07-03 · Amended 2026-07-04: validator classes (j)–(l) and two structure rules added from step-2 code-review findings (see storage layout)

## Purpose

Define BetterBeaver's topic-generic content model, platform architecture principles, and the scope of the first vertical slice (Kyrgyz), so implementation can be delegated in self-contained specs. This plan drives milestone 1; later milestones are sketched in the roadmap.

## Context

- BetterBeaver is a clean start. The predecessor, `~/git/LinguaNomad`, is reference-only: its content model hard-codes language concepts (`languageCode`, `lemma`, `transliteration`) into the core, which is exactly what blocked generalization to topics like mushroom ID or software architecture.
- Source material for the slice lives in the vault: `~/vault/sources/kyrgyz/` (three digitized textbooks in markdown, primary: the Peace Corps *Kyrgyz Language Manual*).
- Priorities: correctness and a clean project over speed; the codebase must be friendly to delegated work by weaker models (conventional stack, explicit schemas, small packages).

## Architecture principles (all milestones)

1. **Headless core.** All domain logic lives in platform-agnostic packages (`schema`, `srs`, `engine`); apps are thin views. This is what "UI abstracted" means concretely: a future native app consumes the same packages, and no logic may be written in an app that a second app would need.
2. **Content behind `ContentSource`.** Apps obtain topics only through the `ContentSource` interface. Milestone 1 implements `BundledContentSource` (content JSON shipped in the repo/app bundle); a later milestone adds a remote catalog (topics in a database, user downloads the ones they want). The schema is the contract either way — remote distribution changes transport, never shape.
3. **Offline-first.** The app is fully functional without a network connection. Network is used only to download new topics (later milestone) and for opt-in sync (later milestone).
4. **Privacy by default.** Learner data stays on the device. Accounts and sync will be supported but optional and opt-in; without opt-in, no user data leaves the device and no account exists. No telemetry.

## Goals (milestone 1)

One learner (Moe) can, on his phone or desktop: install the app as a PWA, pick the Kyrgyz topic, study two units end-to-end (learn items → practice via tasks → see progress), work fully offline after first load, and return the next day to a review queue scheduled by SRS.

## Non-goals (milestone 1 — see roadmap for where each lands later)

- No native app (the PWA covers mobile; native is a contingency milestone).
- No accounts, sync, or backend; no remote topic catalog (bundled content only).
- No audio, no image-based tasks, no Cyrillic text-input tasks (recognition and self-graded recall only).
- No content authoring UI — content is JSON in the repo, hand-authored for the slice.
- No `/ingest` automation, no second topic (that's what forces generalization later — but the schema must not *block* it now).

## Domain model (topic-generic core, typed payloads)

The core never knows about languages. Anything topic-specific lives in an item's `payload`, discriminated by `kind`. Field tables are the contract for the zod schemas; a field is required unless marked optional.

**Topic**

| field | type | notes |
|---|---|---|
| `id` | slug | e.g. `kyrgyz`; the Topic id itself is exempt from the prefix rule below |
| `code` | short slug | e.g. `ky`; every non-Topic entity id must start with `<code>-`, enforced by the validator (the fuller `<code>-<entitytype>-<slug>` shape in the examples is convention, not enforced) |
| `title` | string | |
| `description` | string | |
| `unitIds` | slug[] | ordered |

**Unit**

| field | type | notes |
|---|---|---|
| `id` | slug | |
| `topicId` | slug | |
| `title` | string | |
| `goal` | string | real-world goal, e.g. "greet someone and introduce yourself" |
| `itemIds` | slug[] | ordered |
| `taskIds` | slug[] | ordered |
| `noteIds` | slug[] | may be empty |
| `unlocksAfterUnitId` | slug, optional | absent = available from start |

**Item** — the atomic learnable, the unit of SRS scheduling. The core carries no `prompt`/`answer`; what is shown vs. asked is defined per kind by the presentation rules below.

| field | type | notes |
|---|---|---|
| `id` | slug | |
| `kind` | `"lexeme"` \| `"concept"` | discriminator; future kinds (`species`, `pattern`, …) are new union members, no core changes |
| `payload` | per kind, below | |
| `sourceRef` | slug | Resource id; every item is traceable |

- `kind: "lexeme"` payload: `{ script: string, transliteration: string, gloss: string, usageNote?: string }`
- `kind: "concept"` payload: `{ term: string, definition: string, example?: string }`

Presentation rules (used by tasks; content never duplicates payload fields):
- lexeme — *recognize*: show `script`, choices are glosses. *recall*: show `gloss`, learner produces the word mentally, then the reveal shows `script` and `transliteration` and the learner self-grades.
- concept — *recognize*: show `term`, choices are definitions. *recall*: show `term`, reveal shows `definition`, self-grade.

**Review sessions** (due items, cross-task): always use the *recall* presentation and the recall self-grade mapping, regardless of how the item was originally practiced. Recognize is a task-only interaction.

**Task** — a practice session over items of one unit.

| field | type | notes |
|---|---|---|
| `id` | slug | |
| `type` | `"recognize"` \| `"recall"` | |
| `itemIds` | slug[] | non-empty; each itemId yields exactly one question in the session |
| `instructions` | string, optional | |

Recognize mechanics: one question per item; 3 distractors sampled at random from other same-kind items of the same unit (validator enforces, per recognize task, ≥4 items **of that task's item kind** in the owning unit, and that `gloss`/`definition` display texts are unique per kind within a unit, so distractors can never collide with the correct answer). All `itemIds` of a task must be the same kind and belong to the task's owning unit.

**Ownership**: every task id appears in exactly one unit's `taskIds`, every item id in exactly one unit's `itemIds`, and every note id in exactly one unit's `noteIds`. The validator fails on orphans (task/item/note referenced by no unit) and on multiple ownership. "The task's unit" is therefore always well-defined.

**Note** — explanatory prose attached to a unit. Stored as `notes/<stem>.md`; note id = `<topic.code>-note-<stem>`; the first `#` heading is the display title.

**Resource** — a source citation: `id`, `title`, `path` (vault path or URL). Stored as a JSON array in `resources.json`.

**Learner state** (not content; lives client-side):
- Per item: SM-2 state `{ due: ISO 8601 UTC datetime, intervalDays: number, ease: number, reps: number }`. `due` = **start of the UTC day of grading + `intervalDays` days** (day-granular, so a 1-day interval is always due "tomorrow" regardless of study time). The review queue is `due <= now`. An item enters scheduling on its **first task result** (learn-mode viewing does not schedule). A result advances SM-2 state only if the item has no state yet or is due; answers on scheduled-but-not-due items are practice-only and change nothing — so an item appearing in several tasks of its unit (allowed) cannot jump intervals in one sitting. No lapse counter in milestone 1 — nothing consumes it.
- Per unit: completion is not stored — the store persists the **set of attempted task ids**, and the engine derives a unit as complete when **every task of the unit has been attempted at least once** (every question answered, correctness irrelevant). `unlocksAfterUnitId` gates on this derived status. The validator requires ≥1 task per unit, so completion is never vacuous.

**Grade mapping (task/review result → SM-2 quality 0–5)** — these constants define all scheduling behavior; workers must not alter them:
- recognize (tasks only): wrong → 2, correct → 4.
- recall self-grade (recall tasks and all review sessions): Again → 2, Hard → 3, Good → 5.

**SM-2 semantics, pinned** (self-contained; no external worked example needed). State starts at `reps = 0`, `ease = 2.5`.
- quality < 3: `reps = 1`, `intervalDays = 1`, `ease` unchanged.
- quality ≥ 3: `reps += 1`; `intervalDays` = 1 if `reps` is 1, 6 if `reps` is 2, else `round(previous intervalDays × ease)`; then `ease += 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)`, floored at 1.3.
- Expected sequences (step 3's test oracle): grades 4,4,4 from new → intervals 1, 6, 15 with ease staying 2.5; grades 2 then 4 from new → interval 1 (reps 1), then 6 (reps 2), ease unchanged by the 2 and unchanged by the 4.

**Storage layout.** Content is JSON/MD in the repo under `content/<topicId>/`: `topic.json`, `units/*.json`, `items/*.json`, `tasks/*.json`, `notes/*.md`, `resources.json`. A slug matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`; non-Topic ids must additionally start with `<topic.code>-` (e.g. `ky-item-salamatsyzby`, `ky-note-vowel-harmony`). The validator fails on exactly these classes: (a) dangling references (including `taskIds`, `noteIds`, `sourceRef`), (b) bad slug, (c) missing `<code>-` prefix, (d) orphaned or multiply-owned items/tasks/notes, (e) mixed-kind task items, (f) task items not owned by the task's unit, (g) a recognize task whose owning unit has <4 items of the task's kind, (h) duplicate `gloss`/`definition` per kind within a unit, (i) a unit with zero tasks, (j) duplicate entity ids — a unit/item/task/resource id or derived note id declared twice (includes duplicate `noteStems`), (k) duplicate entries within one id list (`topic.unitIds`, a unit's `itemIds`/`taskIds`/`noteIds`, a task's `itemIds`), (l) an `unlocksAfterUnitId` cycle (a unit whose unlock chain returns to itself). Two structure rules round this out (added with the 2026-07-04 amendment): a task's `itemIds` must be non-empty (enforced at the schema-shape level: an empty task has no well-defined kind and yields no questions), and every unit must appear in `topic.unitIds` (reported under class (a): a unit absent from the topic's ordered list is unreachable).

## Tech stack

- **pnpm monorepo, TypeScript strict everywhere.** Packages: `packages/schema` (zod schemas + validator), `packages/srs` (pure SM-2 functions and the per-item SM-2 state type; no I/O), `packages/engine` (pure session/progress logic: review-queue assembly, unit completion, unlock gating, grade application per the due/practice-only rule, **and task/review session construction** — question building per the presentation rules and recognize distractor sampling via an injected RNG `() => number` in `[0,1)`; plus the `ContentSource` and `ProgressStore` interfaces; no I/O, no React), `apps/web`.
- **Pinned interfaces** (in `packages/engine`; async from day 1 so the M3 remote source and a future SQLite/remote store are swaps, not rewrites):
  - `interface TopicSummary { id: string; title: string; description: string }`
  - `interface ContentSource { listTopics(): Promise<TopicSummary[]>; loadTopic(id: string): Promise<Content> }` — `loadTopic` rejects with `ContentValidationError extends Error { errors: string[] }` if content is invalid; `apps/web` catches this at startup and renders a plain error screen listing the errors (developer-facing; bundled content failing validation is a build bug).
  - `interface ProgressStore { getItemState(itemId: string): Promise<SrsState | null>; setItemState(itemId: string, state: SrsState): Promise<void>; getAttemptedTaskIds(): Promise<string[]>; markTaskAttempted(taskId: string): Promise<void> }` — no completion flag is stored: unit completion is **derived** by the engine (`every task id of the unit ∈ attempted set`), so there is exactly one source of truth and no cached flag to invalidate.
- **`packages/schema` is I/O-free**: it exports the zod schemas and `validateContent(input: { topic: unknown; units: unknown[]; items: unknown[]; tasks: unknown[]; resources: unknown[]; noteStems: string[] }): { content: Content } | { errors: string[] }` — note ids are derived from `noteStems`, so callers pass file stems, not markdown bodies. `Content` is `{ topic: Topic; units: Unit[]; items: Item[]; tasks: Task[]; resources: Resource[]; notes: { id: string; stem: string }[] }`; consumers join note markdown by `stem`. File reading happens in two places only: a Node test — **created in step 4, not step 2** — that loads `content/` from disk and asserts validity, and `apps/web`'s `BundledContentSource`, which imports content via Vite `import.meta.glob` and validates at startup.
- **Vite + React PWA** for `apps/web` (vite-plugin-pwa: installable manifest + service worker precaching the app shell and bundled content). Rationale: fastest iteration loop; the largest training corpus of any UI stack, so delegated Sonnet tasks land reliably; installable on the phone from day 1 without an app store. `apps/web` contains only view code and the two interface implementations: `BundledContentSource` and the `localStorage`-backed `ProgressStore`.
- **Persistence: `localStorage`** behind `ProgressStore` (interface in `packages/engine`; owns learner state: per-item SM-2 records keyed by item id, attempted task-id set). A future SQLite/remote store is a swap, not a rewrite.
- **Testing: vitest** for the three pure packages (`schema`, `srs`, `engine`); `apps/web` has no test setup in milestone 1. The root vitest config sets `passWithNoTests: true` so `pnpm check` is green from the step-1 skeletons onward. SRS tests assert the pinned expected sequences from the domain-model section; engine tests use injected clocks and injected RNG.
- **One quality gate**: `pnpm check` = prettier check + eslint + typecheck + vitest (content validation is inside the schema package's tests, so `pnpm check` covers it). No CI in milestone 1.

## Vertical slice content

Two Kyrgyz units, hand-authored from the vault sources (Manual sections 0.6.1–0.6.2 for the alphabet; the greetings competencies from the Peace Corps competencies book):

1. **Script and sound survival** — `concept` items (`term` = the letter, `definition` = its sound/rule); recognition tasks. Selection rule (Manual §0.6.2 lists 36 letters): the exclusion list is authoritative and overrides the include clauses — exclude Цц, Щщ, Ъъ, Ьь (marked loan-word-only in §0.6.2) plus Вв and Фф (editorial judgment: loan-word-dominant in practice, despite В's listed `[w]` sound); of the remainder, include the Kyrgyz-specific letters (ң, ө, ү), the vowels (they carry vowel harmony), and consonants whose sound differs from the Latin/Russian expectation. Definitions must be written distinctly per letter (validator rule h).
2. **Greetings and introductions** — ~15 `lexeme` items + 2 notes, recognition + recall tasks. Where the source glosses two words identically (e.g. two "How are you" forms), glosses are disambiguated ("How are you (polite)").

Content steps are **authored by the orchestrator via the `/author` workflow** (doc-reviewer attacks the content like any document) — they are not delegated to the implementer, because content selection is design work.

## Implementation order (steps 4 and 8 are orchestrator-authored content; every other step = one delegable spec)

1. Repo scaffold: pnpm workspace with the four package skeletons (`packages/schema`, `packages/srs`, `packages/engine`, `apps/web` as an empty Vite React app), tsconfig, eslint/prettier, vitest wired for the three pure packages with `passWithNoTests: true`, `pnpm check` script. Done: `pnpm check` passes.
2. `packages/schema`: zod entities per the field tables, `validateContent` with the signature above + fixture tests only (the disk-loading test over real `content/` arrives in step 4 — `content/` doesn't exist yet and `pnpm check` must stay green after every step). Done: validator catches one seeded fixture per violation class (a)–(l) from the storage-layout list.
3. `packages/srs`: SM-2 state type + scheduling function implementing the pinned semantics and grade-mapping constants. Done: tests assert both pinned expected sequences.
4. Slice content for unit 1 (orchestrator-authored, see above) + create the disk-loading validation test in `packages/schema` (this test part is delegable). Done: that test green in `pnpm check`.
5. `packages/engine`: the pinned interfaces, queue/completion/gating/grading functions, and session construction (question building per presentation rules, distractor sampling with injected RNG), with clock- and RNG-injected tests. Done: engine tests green, including the two-unit unlock-gating fixture and the clock-injected test showing an item reviewed today reappearing per schedule.
6. `apps/web` learn flow: topic → unit → item browsing, `BundledContentSource` (validates at startup, error screen on failure), `localStorage` ProgressStore. Done: unit 1 browsable in the browser from `pnpm dev`.
7. Practice + review UIs over the engine's session construction: run tasks (recognize/recall), review sessions (recall presentation over due items). Done: task and review flows usable in the browser against unit 1.
8. Slice content for unit 2 (orchestrator-authored). Done: milestone-1 goal demonstrable end-to-end in the browser (except the PWA/offline criteria — step 9).
9. PWA hardening: manifest, icons, service-worker precache of app shell + content (vite-plugin-pwa), install flow, and a `navigator.storage.persist()` request on first launch. Phone verification serving: `vite preview --host` behind local TLS via `mkcert` (iOS additionally requires installing and trusting the mkcert root CA profile on the phone; Android alternative: `adb reverse` to use `localhost`). Done: app installs to the home screen (Chrome install prompt on Android / Safari Add-to-Home-Screen on iOS), then after one online load the airplane-mode walkthrough (study + review) passes on the phone.

## Done-criteria (milestone 1)

- `pnpm check` passes from a fresh clone (`corepack pnpm install` documented in README).
- Manual walkthrough: study unit 1, attempt all its tasks, see unit 2 unlock, and the next day the review queue is non-empty (guaranteed for the M1 user's timezone, UTC+1/+2: the first task result always schedules with a 1-day interval and `due` lands at the next UTC midnight, i.e. 01:00/02:00 local; switch to local-day granularity when M5 makes timezone diversity real; also covered by mocked-clock tests).
- Offline: after first load, the full walkthrough works with no network (verified on a phone with the PWA installed, served per step 9).
- No entity in `packages/schema`, `packages/srs`, or `packages/engine` references anything language-specific outside a payload type. Mechanical layering rule for `apps/web`: every exported function either renders React or adapts a browser API (`localStorage`, `import.meta.glob`, service worker); any pure function over `schema`/`srs`/`engine` types belongs in `packages/engine`.

## Roadmap (later milestones — order decided at each retro)

- **M2 — `/ingest` skill**: source md/pdf in `~/vault/sources/` → proposed units/items/tasks in this schema, validated and human-reviewed before commit. Gated on the schema having survived real content (M1).
- **M3 — Topic distribution**: remote catalog (topics in a database / static pack hosting — decision then), download + local cache behind a `RemoteContentSource`, user picks which topics to load. Offline behavior unchanged.
- **M4 — Second topic** (mushroom ID or software architecture): new item kinds (e.g. `species` with images), image-based tasks land here with their first consumer.
- **M5 — Optional accounts + sync**: opt-in only; without opt-in no data leaves the device. Design must not require migration of local-only users.
- **Contingency — native app (Expo)**: only if the PWA proves insufficient (e.g. audio latency, notifications); consumes `schema`/`srs`/`engine` unchanged.
- Audio and Cyrillic text input attach to whichever milestone first needs them (retro decision).

## Open questions

- **Cyrillic input**: milestone 1 avoids typed answers; decide before M2 whether recall tasks need real text input and an input-method note. Owner: Moe, trigger: milestone 1 retro.
- **Second topic choice** (mushroom ID vs. software architecture) — decides which item kinds land next. Owner: Moe, trigger: milestone 1 complete.
- **Topic pack hosting** (real database/backend vs. static JSON packs on a CDN). Owner: Moe, trigger: M3 start.
- **Learner-data durability/export**: phone-local storage is the only copy of progress until M5 (step 9's `storage.persist()` reduces but doesn't eliminate eviction risk); decide whether M1.x adds a manual export/import. Owner: Moe, trigger: milestone 1 retro.
