# Architecture

Status: living document · Created 2026-07-06 · Last updated 2026-07-19 (reflects plans 0001–0011 as shipped, plan 0012 steps 1–2 as shipped, step 3 as [specs](specs/)) · Normative sources: the [plans](plans/); requirements and decision index: [design.md](design.md)

## Invariants (hold across all milestones)

1. **Headless core** — all domain logic in platform-agnostic packages; apps are thin views. No logic in an app that a second app would need.
2. **Content behind `ContentSource`** — apps obtain topics only through this interface; the schema is the contract regardless of transport.
3. **Offline-first** — fully functional without network; network only for topic download and opt-in sync (later milestones).
4. **Privacy by default** — learner data stays on the device unless the user opts into sync. No telemetry.

## Current architecture (after plans 0001–0009)

A pnpm TypeScript monorepo: three headless packages (pure, no I/O, no React), one Vite + React PWA, and hand-curated content as JSON/markdown in the repo — per-domain lexicons plus per-topic lesson trees.

```mermaid
graph TD
    lexicon["content/lexicon/&lt;domainId&gt;/<br/>domain.json · entries · families · assets"]
    topics["content/&lt;topicId&gt;/<br/>topic.json · lessons · units · items ·<br/>tasks · notes.md · resources · assets"]

    subgraph headless ["Headless packages — pure, no I/O, no React"]
        schema["packages/schema<br/>zod entities (Domain/Family · Topic→Lesson→Unit ·<br/>4 item kinds · 11 task types) · presentation helpers ·<br/>cloze parsing · validateContent"]
        srs["packages/srs<br/>SM-2 scheduling · grade mappings · isDue"]
        engine["packages/engine<br/>task + ad-hoc session construction · scheduling units<br/>(items · cloze blanks · note flashcards) · per-domain<br/>review queue (pinned first) + streak · grading ·<br/>lesson/unit completion + unlock · resolveToken lookup ·<br/>typed-input normalization · interfaces: ContentSource ·<br/>ProgressStore · VocabListStore · UserEntryStore"]
    end

    subgraph web ["apps/web — Vite + React PWA"]
        bundledSrc["Content boot (plan 0012 step 1):<br/>IndexedDB doc cache first, bundled seed fallback →<br/>engine's createDocumentContentSource ·<br/>opt-in update banner · asset URL maps stay bundled"]
        stores["localStorage stores: progress · vocab lists ·<br/>user entries · pinned tasks · streaks ·<br/>self-erasing migrations · JSON backup"]
        app["App.tsx — screen state machine"]
        screens["Screens: Start · TopicList · Topic · Lesson · Unit ·<br/>Session (task/review/ad-hoc) · Vocabulary · Error<br/>Components: TappableText · EntryPopup ·<br/>AddWordForm · NoteView · icons · TTS helper"]
    end

    engine --> schema
    engine --> srs
    lexicon -->|"bundled by Vite"| bundledSrc
    topics -->|"bundled by Vite"| bundledSrc
    bundledSrc -.->|"implements ContentSource"| engine
    stores -.->|"implement the store interfaces"| engine
    app --> engine
    app --> bundledSrc
    app --> stores
    app --> screens
```

Key mechanics:

- `packages/schema` owns the topic-generic domain model: **Domains** with a canonical lexicon (entries, families, one-side-authored symmetric links) and **Topic → Lesson → Unit** trees whose units own items/tasks/notes (plan 0008). Item payloads are discriminated by `kind` (`lexeme`, `concept`, `sentence` with cloze markup, `pair`); presentation helpers define what is shown vs. asked per kind; `validateContent` enforces the lettered rule classes accumulated across plans 0001/0002/0004/0006/0008. Nothing language-specific exists outside payloads.
- `packages/srs` is pure SM-2 exactly as pinned in plan 0001: state type, scheduling function, the answer→quality grade mappings (`recognizeQuality`/`recallQuality`), and `isDue`. Unchanged since milestone 1 — every later feature reuses it as-is.
- `packages/engine` holds all remaining app-independent behavior: session construction for the 11 task types plus ad-hoc vocabulary sessions with runtime mode floors (plan 0004), **scheduling units** (per item, per cloze blank, per note flashcard), the per-domain review queue (deduplicated across topics, pinned tasks first) and streak, grade application (due/practice-only rule), derived lesson/unit completion and unlock gating, `resolveToken` tap-lookup (exact-then-prefix), and typed-input normalization. It pins the four async interfaces the web app's adapters implement.
- `apps/web` contains only view code plus adapters. Content boots cache-first (plan 0012 step 1): cached backend documents from IndexedDB win, the bundled content — now assembled as seed documents — is the fallback; both paths validate through the engine's `createDocumentContentSource` (per-topic `validateContent` + cross-set `validateContentSet`), and the app renders a developer-facing error screen on seed failure while a broken cache self-heals to the seed. Content updates are strictly opt-in via a home-screen banner (all-or-nothing validated accept). Note markdown now lives inside topic documents; asset URLs stay bundled and frozen.
- **Authoring** (plan 0012 step 2): a home-screen entry (only when the backend is configured) leads to magic-link sign-in and a form-based editor over the author's documents — topic structure and domain lexicons, editing the raw `draft` with autosave; deletes go through engine edit ops (`documentEdit.ts`) that strip every id reference; publish runs the full client-side set validation, then the atomic `publish_document` RPC (optimistic version check). A document stamped with a newer `CONTENT_SCHEMA_VERSION` renders read-only. The `@supabase/supabase-js` client lives behind `apps/web/src/backend/`; learners' only network path remains the anonymous catalog GET. All learner state — per-scheduling-unit SM-2 records, attempted tasks, per-domain streaks, vocab lists, learner-created entries, pinned tasks — lives in `localStorage` behind the store interfaces, with presence-based self-erasing migrations and JSON export/import backup (plan 0006). Read-aloud uses recorded assets first, else on-device TTS restricted to local voices (offline-first).
- Layering rule (mechanical, from plan 0001): every exported function in `apps/web` either renders React or adapts a browser API; any pure function over core types belongs in `packages/engine`.

Deployment: every push to `main` builds and deploys the web app to GitHub Pages (`.github/workflows/deploy.yml`; `BASE_PATH=/BetterBeaver/` feeds Vite's `base`). The PWA precaches the app shell, content, fonts, and media for offline use.

A task session, end to end (review and ad-hoc sessions differ only in how questions are sourced — due scheduling units of a domain, or a learner-chosen item set):

```mermaid
sequenceDiagram
    participant U as Learner
    participant W as apps/web
    participant E as engine
    participant P as ProgressStore (localStorage)

    U->>W: open task / review
    W->>E: buildTaskSession / (review: domainSchedulingUnits + reviewQueue, then buildReviewSession)
    E->>P: getItemState per scheduling unit (review only, to find due units)
    E-->>W: questions (distractors sampled / due units only, pinned tasks first)
    U->>W: answer (auto-checked or self-graded)
    Note over W: answer → outcome list [(schedulingUnitId, quality)] via srs grade mapping
    W->>E: applyGrade(store, unitId, quality, now) per outcome
    E->>P: getItemState / setItemState (SM-2 advance if new or due)
    W->>P: markTaskAttempted (after last question, tasks only)
    Note over E,P: unit/lesson completion & unlock derived from attempted set — never stored
```

## Target architecture (roadmap end state)

What the milestones add. The pinned interfaces and the four invariants stay fixed; the core packages grow only by union extension (new item kinds, new task types).

```mermaid
graph TD
    subgraph authoring ["Authoring (shipped — plan 0007)"]
        sources["~/vault/sources/*<br/>md / pdf"]
        ingest["/ingest checklist skill<br/>source → lessons/units/entries/tasks,<br/>validated + human-curated"]
        sources --> ingest
    end

    subgraph distribution ["Distribution (designed: plan 0012)"]
        catalog["Supabase content backend<br/>jsonb documents (draft/published/history) ·<br/>maintainers · proposals · catalog view · publish RPC"]
    end
    ingest --> catalog

    subgraph headless ["Headless core — interfaces stable"]
        schema["schema"]
        srs["srs"]
        engine["engine<br/>ContentSource · ProgressStore"]
        engine --> schema
        engine --> srs
    end

    subgraph apps ["Apps"]
        pwa["apps/web PWA<br/>installed, offline via service worker"]
        native["Native app (Expo)<br/>contingency only"]
    end
    pwa --> engine
    native -.-> engine

    bundled["BundledContentSource"]
    remote["RemoteContentSource (M3)<br/>download + local cache"]
    bundled -.->|ContentSource| engine
    remote -.->|ContentSource| engine
    catalog --> remote

    localstore["localStorage store"]
    syncstore["Sync-backed store (M5)<br/>opt-in accounts, local-first"]
    localstore -.->|ProgressStore| engine
    syncstore -.->|ProgressStore| engine
    syncBackend["Sync service (M5)<br/>opt-in only"]
    syncstore <--> syncBackend
```

Milestone scope, order, and rationale live in [plan 0001's roadmap](plans/0001-content-schema-and-kyrgyz-slice.md#roadmap-later-milestones--order-decided-at-each-retro) (order decided at each retro) — not duplicated here. M2 landed as plan 0007: `/ingest` is a human-in-the-loop checklist skill, not an automated pipeline. **M3's open question ("DB or static packs") is now decided by [plan 0012](plans/0012-content-backend-and-editing.md)**: a Supabase backend storing whole JSON documents, with in-app editing (per-document maintainers, drafts, atomic publish, proposals) on top — a scope beyond the original M3 because editing, not just distribution, became the requirement; accounts arrive for authors only (an explicit amendment of the M5 "accounts are opt-in, later" decision — learners stay account-free). Plan 0012 §9 also pins the M5 progress-sync design (local-first `SyncedProgressStore`, merge rules) without scheduling it. Architecturally, each remaining milestone is still one of only three kinds of change: a new implementation of a pinned interface (`RemoteContentSource`, sync-backed `ProgressStore`), a union extension in the core (M4 item kinds and task types), or something entirely outside the app (the Supabase backend, the sync service).

The target diagram is a direction, not a commitment: each milestone's concrete design is decided when it starts, constrained only by the four invariants and the two pinned interfaces.
