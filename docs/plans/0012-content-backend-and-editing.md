# Plan 0012: Content backend and in-app editing (Supabase)

Status: **designed 2026-07-19**, not yet implemented · Direction pinned by a 10-question grilling session (2026-07-19); 2 adversarial review rounds · Owner: Moe · Date: 2026-07-19 · Implementation split: core built next (steps 1–2, the last Fable sessions), the rest as implementer-ready specs for post-handoff work (step 3)

## Purpose

Today content is hand-curated JSON in this repo, bundled at build time and shipped by pushing to `main`. Editing therefore requires repo access, a checkout, and a redeploy — only a developer can do it. This plan makes content live: **any user can edit content in the app; the maintainer of a topic publishes their own edits directly to all users; other users' edits become proposals a maintainer approves.** Content moves out of git into a hosted backend; the app keeps working fully offline.

This plan **amends two earlier decisions**, deliberately:

- The 2026-07-03 platform decision (plan 0001, vault note `projects/betterbeaver.md`) put accounts/sync at M5, opt-in, "no user data leaves the device unasked". Amendment: **accounts arrive now, but only for authors** (maintainers/proposers). Learners never need an account; the privacy invariant is untouched for them. Learner progress sync remains future work (designed here, built later — see Design §9).
- Plan 0001's M3 sketched "remote topic catalog (DB or static packs — decided at M3)". This plan is that decision: a database (Supabase Postgres), not static packs, because editing — not just distribution — is now the requirement.

## Context

- The app obtains all content through the 4-method `ContentSource` interface ([`packages/engine/src/interfaces.ts`](../../packages/engine/src/interfaces.ts) line 36): `listTopics` / `loadTopic` / `listDomains` / `loadDomain`. Today's only implementation is `BundledContentSource` (apps/web, `import.meta.glob` + validation at startup). The interface was pinned in plan 0001 precisely so this swap would be additive.
- Validation is split today: `validateContent` (packages/schema) checks **one topic + its domain**; the cross-bundle checks (duplicate domain codes, **global item-id uniqueness** — item ids are the global SRS keys) live in `createBundledContentSource` ([`apps/web/src/content/bundled.ts`](../../apps/web/src/content/bundled.ts) lines ~257–282). This plan extracts the cross-bundle checks into a shared `validateContentSet` (packages/schema) used by all three consumers: bundled startup, publish, and update-accept.
- `validateContent`'s input includes **asset stem inventories** (`audioStems`, `imageStems`, `lexiconAudioStems`, `lexiconImageStems`) built today from `import.meta.glob` over `content/*/assets/`; rule classes check asset refs against them. Any storage design must carry these.
- Content volume: ~1.4 MB total (~1.1 MB JSON/markdown, rest assets). Free-tier ceilings are orders of magnitude away.
- All learner state is device-local (`localStorage`); JSON export/import is the durability floor. Unchanged by this plan.
- Deployment: GitHub Actions → GitHub Pages, static. Unchanged by this plan.

## Goals

After this plan (all steps, incl. post-handoff specs implemented): a maintainer signs in with an email magic link, edits their topic's lessons/units/items/tasks/notes in form-based screens, saves drafts across sessions, and publishes a validated new version that every learner is *offered* (update is opt-in — notify only). A non-maintainer edits in the same screens and submits a proposal; the maintainer reviews a diff and accepts into their draft or rejects with a comment. Any signed-in user can create a new topic and maintain it; it appears in the public catalog after admin approval. Learners without accounts study exactly as today, offline included, even when the backend is paused or unreachable.

After **steps 1–2 only** (the Fable-built core): content is served from Supabase via `RemoteContentSource` with an IndexedDB cache and opt-in updates; maintainers of *existing* documents (assigned by the admin via the Supabase dashboard) can edit and publish through the in-app editor; the bundled content is demoted to a frozen first-run seed.

## Non-goals

- **No relational content schema.** Content is stored as whole JSON documents (Design §2); no per-entity SQL tables mirroring the zod model.
- **No hand-rolled auth, no passwords.** Supabase magic-link auth only.
- **No auto-merge of concurrent edits or proposals.** Version-conflict surfacing + human judgment (Design §5). No CRDTs, no operational transforms.
- **No server-side execution of the content validator.** Validation runs in the author's client at publish time; the learner client's parse-and-validate on accept is the last line of defense (Design §3 records why this is sound, including the domain blast radius).
- **No asset upload / remote assets in steps 1–2.** Assets stay bundled and frozen (Design §2); Supabase Storage is part of the post-handoff spec batch.
- **No progress-sync implementation.** Designed in §9, built post-handoff from its spec.
- **No learner accounts.** Accounts exist only to author (and later, opt into progress sync).
- **No native app changes, no deploy-pipeline changes.**

## Design

### 1. Platform: Supabase, EU region, free tier

Managed Postgres + auth + row-level security + storage. Chosen over Cloudflare (DIY auth — exactly what we refuse to hand-roll), Firebase (NoSQL fights the relational-ish content refs), and a VPS (permanent ops burden). Deciding argument: auth and per-row authorization are the two things never to hand-build, and both are configuration here; post-handoff, "write an RLS policy" is reliably within a smaller model's reach.

Known ceilings, accepted: free tier pauses the project after 7 days of inactivity (a request wakes it; the offline cache means a paused backend only delays *updates*, never breaks the app); 500 MB database (content is ~1.4 MB incl. assets that stay bundled anyway; version history is append-only but tiny — no pruning until it ever matters). Escape hatches: paid tier, or the schema ports to any Postgres.

### 2. Storage shape: JSON documents, 1:1 with `ContentSource`

One row per **topic document** (the whole topic tree: topic, lessons, units, topic-owned items, tasks, notes, resources) and one per **domain document** (domain, lexicon entries, families), in `jsonb`. This maps directly onto the four `ContentSource` methods and keeps the zod entities as the single shape truth. Tables (SQL migrations in `supabase/migrations/`):

```sql
create table documents (
  id             text primary key,          -- topic id or domain id (existing content ids)
  kind           text not null check (kind in ('topic', 'domain')),
  published      jsonb,                     -- what learners fetch; null until first publish
  published_version int not null default 0, -- optimistic-concurrency counter
  schema_version int not null,              -- CONTENT_SCHEMA_VERSION at publish time (§8)
  draft          jsonb,                     -- work-in-progress; null = no draft (publish clears it)
  listed         boolean not null default false, -- admin-approved into the public catalog (§4)
  created_by     uuid references auth.users on delete set null,
  updated_at     timestamptz not null default now()
);

create table versions (                      -- append-only publish history, for rollback
  doc_id       text references documents,
  version      int not null,
  doc          jsonb not null,
  published_by uuid references auth.users on delete set null,
  published_at timestamptz not null default now(),
  primary key (doc_id, version)
);

create table maintainers (                   -- per-document (topics AND domains), §3–4
  doc_id  text references documents,
  user_id uuid references auth.users on delete cascade,
  primary key (doc_id, user_id)
);

create table admins ( user_id uuid primary key references auth.users on delete cascade );

create table proposals (                     -- §5; flow built post-handoff, table ships now
  id           uuid primary key default gen_random_uuid(),
  doc_id       text not null references documents,
  base_version int not null,                 -- published_version the proposal was based on
  proposed_doc jsonb not null,               -- the FULL modified document, not a patch
  author       uuid references auth.users on delete set null,
  note         text,
  status       text not null default 'open' check (status in ('open','accepted','rejected')),
  decided_by   uuid references auth.users on delete set null,
  decision_note text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
```

`on delete set null` / `cascade` on every `auth.users` reference so account deletion (the GDPR promise, §10) works without orphan errors — content survives, attribution is anonymized.

**Document types.** The raw document shapes — `TopicDocument` (topic, lessons, units, topic-owned items, tasks, notes, resources) and `DomainDocument` (domain, entries, families) — are defined in packages/schema (they are essentially `validateContent`'s input minus the asset stems, split per document). They are the type the backend stores, the editor edits, and the pure edit ops (§7) operate on. They are **not** the engine's merged `Content` view (whose `items` mixes topic-owned items with referenced domain entries) — conflating the two would smuggle domain entries into topic documents.

**Assets stay bundled and frozen in steps 1–2.** Audio/image files remain in the repo, precached as today; `RemoteContentSource` resolves asset refs against the same bundled asset-URL maps `BundledContentSource` builds. Consequence, accepted: until the post-handoff asset pipeline (Supabase Storage + upload UI, step 3 spec), *editing cannot add new asset-backed content* — the publish-time validator receives the frozen bundled stem inventories, so a task referencing a non-existent asset fails validation with a clear message. Existing asset-backed content keeps working unchanged.

Catalog queries (`listTopics`/`listDomains`) select summary fields out of the `published` jsonb of `listed` documents through the `catalog` view (§4) — no separate summary columns to keep in sync.

Concurrency ceiling, accepted: edits within one document are last-write-wins guarded by `published_version` optimistic checks; fine while a document has ~one maintainer. If heavy co-maintenance ever arrives, that is the trigger to revisit granularity — not before.

### 3. Publish flow: draft → validate → publish RPC, with history

- Maintainers edit `draft` (autosaved). Learners only ever read `published` where `listed`.
- **Client-side validation before publish**: run `validateContent` + `validateContentSet` on the draft assembled with the current published set it belongs to. Direction matters and is symmetric:
  - Publishing a **topic** draft validates it against its published domain document (and the set checks against all other published docs).
  - Publishing a **domain** draft validates it against **all published topics of that domain** — a domain publish that deletes an entry some topic references must fail client-side.
- **Publish is one atomic RPC**, `publish_document(doc_id, expected_version, new_doc, schema_version)`: a `security definer` Postgres function that (in one transaction) checks the caller is a maintainer of `doc_id`, checks `published_version = expected_version` (raising a "someone else published meanwhile — reload" error on mismatch, never silently matching zero rows), sets `published`, increments `published_version`, stamps `schema_version`, inserts the `versions` row, and clears `draft` to null. No client ever updates `published*` columns directly (§4).
- **Trust model, recorded accurately.** Validation is client-side because the validator is TypeScript and we run no servers for it. A malicious or buggy author bypassing it can publish a zod-valid-but-set-invalid document. Blast radius: for a **topic**, that topic stops updating for learners (their accept path rejects the set and keeps cache — §6) until fixed; for a **domain**, updates freeze for *every topic of that domain* until an admin rolls back the domain doc. No learner is ever bricked in either case — cached content keeps working. Accepted: at this trust scale (maintainers are admin-approved humans), admin rollback is the remedy; server-side validation (an edge function running the TS validator) is the known upgrade path if abuse ever materializes.
- Rollback = re-publish any `versions` row (the same RPC with the historical doc). The table ships in step 1; a rollback UI is part of the post-handoff spec batch — until then, admin via dashboard/SQL.

### 4. Accounts, roles, and the real authorization boundary

- **Magic-link email auth** (Supabase). No passwords anywhere. OAuth providers addable later without schema change.
- Roles: `maintainers` rows scope write access per document — topics *and domains alike* (a domain document has maintainers exactly like a topic; initially Moe maintains `lexicon/ky`). `admins` (initially only Moe) moderate everything.
- **Topic creation**: any signed-in user may create a topic document and becomes its maintainer (auto-added by a `security definer` trigger — necessary because `maintainers` is otherwise admin-only writable); it stays `listed = false` (invisible to learners, fully editable/previewable by its maintainer) until an admin lists it. Same review muscle as proposals, and the spam gate for the public catalog. (In-app creation + listing UI is post-handoff; in steps 1–2 the admin assigns maintainers and lists documents via the Supabase dashboard.)
- **Authorization mechanics** — RLS alone cannot express column-level rules, so the boundary is three-layered, and this is normative for step 1:
  - **Anon/learner reads go through a `catalog` view** (`security definer`) exposing only `id, kind, published, published_version, schema_version` of `listed` documents. The `anon` role has **no grant on `documents` itself** — drafts and unlisted docs are structurally invisible to learners.
  - **Sensitive columns change only via RPCs**: `publish_document` (§3, maintainer-checked) and `set_listed(doc_id, boolean)` (admin-checked). Authenticated maintainers get row-level `select` on their documents and `update` limited (column grant) to `draft`/`updated_at`. `insert` on `documents` for any authenticated user with `listed` forced false by trigger.
  - **RLS rows**: `versions` — `insert` only via the publish RPC, `select` for that doc's maintainers + admins; `proposals` — `insert` by any authenticated user, `select` by the doc's maintainers, admins, and the author, `delete` by the author while `status = 'open'` (withdrawal), **decision updates (`status`/`decided_*`) by maintainers/admins only — never the author**; `admins`, `maintainers` — writable by admins only (plus the creation trigger).

### 5. Proposal flow (non-maintainer edits) — post-handoff, designed here

Non-maintainers use the **same editor screens**; the save action reads "Propose" and inserts a `proposals` row carrying the full modified document plus `base_version`. Maintainer UI: list open proposals, view a structural diff (added/removed/changed lessons/units/items/tasks/notes) computed against the `versions` row for `base_version`, then **accept into draft** (proposal doc becomes/merges-by-eye into the maintainer's draft, to tweak and publish normally) or **reject with a comment** visible to the proposer. If `base_version < published_version`, the UI flags the proposal as stale; the maintainer resolves by review — no auto-merge ever. Ceiling, accepted: two big concurrent proposals on one topic make the second stale; the fix at that point is co-maintainership (§4 already supports it), not merge machinery.

### 6. `RemoteContentSource`: cache-first, update strictly opt-in

New `ContentSource` implementation in apps/web (adapter layer, like `BundledContentSource`):

- **Cache**: IndexedDB, one record per document `{ id, kind, version, schemaVersion, doc }`. (`localStorage` rejected: ~5 MB ceiling shared with learner state.)
- **Boot**: serve entirely from cache, never block on network. Empty cache (first run) → seed from the bundled content (below), then fetch the catalog and offer the first sync.
- **Update check** (app start + manual "check for updates"): fetch the catalog projection — `id, published_version, schema_version` from the `catalog` view — compare with cache. Differences → an unobtrusive **"content update available"** notice. **Nothing downloads or changes until the user actively accepts** (pinned during grilling: notify only). On accept: download changed documents with `schema_version <= CONTENT_SCHEMA_VERSION`, zod-parse each, then validate the assembled new set (`validateContent` per topic + `validateContentSet` across it, with the bundled asset stems). **All-or-nothing**: if the assembled set fails — entirely possible when per-doc schema filtering skips a domain but takes its topic — the whole update is discarded, the old cache stays untouched, and the notice names the failing document (so a maintainer hears about it). On success: store, reload the app.
- **Asset resolution**: asset refs resolve against the bundled asset-URL maps (assets are frozen in-repo for now — §2).
- **Bundled seed**: the current `content/` tree becomes a **frozen snapshot** maintained by `scripts/export-content.ts` (step 1: pulls the published set from Supabase back into `content/`); Supabase is the single source of truth and hand-editing `content/` stops. The seed exists so a fresh install works even while the backend is paused/unreachable (a real free-tier scenario, §1). It is re-exported as part of every schema-version bump (§8) so it can never rot into unparseability.

Offline-first invariant after this plan: after first load the app is fully functional with zero network; a dead backend delays updates only.

### 7. Editor v1 scope: forms for the common 80%

Built in step 2 (Fable): form-based editing over the **document types** (§2) —

- **Topic documents** (for maintainers of that topic): note markdown; topic-owned item payloads (sentence text incl. cloze markup, pair fields); the simple task fields (prompt/answer/pairs for recall, recognize, cloze, matching, scramble, build); structural operations — add/delete/reorder lessons, units, items, tasks, notes.
- **Domain documents** (only for maintainers of that domain — initially Moe): lexicon entry forms (word/gloss/examples, concept term/definition), family membership. A topic maintainer who is *not* a domain maintainer sees lexeme/concept entries read-only with "suggest via proposal (coming later)" — editing them is a write to a document they don't own (the ownership split plan 0006 pinned).
- Draft autosave; publish button with per-rule human-readable validation errors (the validator already produces them); preview = the existing learner screens rendering the draft.

Deferred to the post-handoff spec batch: type-specific editors for the remaining task types (listen/dictation/shadowing/minimal-pair/picture — all blocked on the asset pipeline anyway), link editing, asset upload (Supabase Storage), in-app topic creation, listing/rollback/proposal-review UIs.

Layering: pure document-edit operations — functions `(TopicDocument | DomainDocument, op) → same type` — live in **packages/engine** per the layering rule; editor screens and the Supabase adapter are apps/web. One new runtime dependency: `@supabase/supabase-js`.

### 8. Schema-version skew: one integer, checked in two places

`packages/schema` exports `CONTENT_SCHEMA_VERSION: number`. **Any** entity-schema change bumps it — additive ones included, because a strict discriminated union in an old client rejects an unknown task type as hard as a breaking change. Enforcement:

- `RemoteContentSource` ignores documents with a newer `schema_version`, keeps serving the cached/older version, and shows "update the app to receive the newest content" (a PWA update is a reload — one tap).
- The editor refuses to publish over a document whose `schema_version` is newer than the app's (prevents an old editor silently stripping fields it doesn't know).

**Bump procedure** (a checklist in the schema package's README section, enforced socially + by check): (1) bump the integer with the schema change; (2) the admin republishes all listed documents so their stored docs and `schema_version` move forward (mechanics: `scripts/export-content.ts`'s inverse — republish via the publish RPC; without this, *new* installs would receive nothing newer than the seed, since fresh clients zod-reject old-shape docs); (3) re-export the bundled seed (§6) — the seed is parsed by current schemas at startup and by `pnpm check`'s content tests, so a stale seed fails the gate rather than bricking fresh installs.

No migration framework, no content transformers: PWA update latency is days, and "old app keeps old content until reload" is acceptable for that window.

### 9. Progress sync — designed now, built post-handoff

Pinned so the accounts model never reopens: same magic-link accounts (a learner opting into sync signs in exactly like an author); local-first — `localStorage` remains the working store, a `SyncedProgressStore` wraps the existing store and pushes/pulls in the background, sync failure invisible; per-user rows guarded by RLS (`user_id = auth.uid()`). Merge rules, per key: SRS state per scheduling unit → later last-review date wins ("most progressed"); attempted-task set → union; streak → max if last-active days agree, else recompute from the later; vocab lists / user entries → last-write-wins per list/entry (only lossy rule; accepted). Opt-in stays absolute: no account → nothing leaves the device; JSON export/import remains the accountless floor. Nothing deeper (vector clocks, per-field merges) is warranted for one learner across few devices.

### 10. Operations

- One production Supabase project, **created in Moe's browser account** (ownership/billing with the human), EU region, free tier.
- Local development: Supabase CLI (`supabase start`, Docker). **Schema lives in git** (`supabase/migrations/*.sql`, applied via CLI); **content does not** (the long-run requirement, satisfied — `content/` remains only as the frozen seed snapshot, §6).
- Secrets: the `anon` key ships in the client by design — the §4 three-layer boundary (catalog view + RPCs + RLS) is what actually protects data. The `service_role` key (bypasses RLS) is used only by the migration/seed scripts (`scripts/migrate-content.ts`, `scripts/export-content.ts` — run locally, key from env), never committed, never in CI. GitHub Actions unchanged.
- Config: Supabase URL + anon key as Vite env vars; absent vars → app runs bundled-only (dev convenience and a permanent escape hatch).
- GDPR: author accounts store an email address → one static privacy page (what's stored, deletion contact); account deletion anonymizes attribution via the `on delete` rules (§2) and removes auth + role rows.

## Steps

1. **Backend core + `RemoteContentSource`** *(Fable session 2)* — user creates the Supabase project (browser, EU); `supabase/` migrations for §2 tables, §4 catalog view + RPCs (`publish_document`, `set_listed`) + triggers + RLS; `CONTENT_SCHEMA_VERSION` in packages/schema; extract `validateContentSet` (cross-bundle checks out of `bundled.ts` into packages/schema, reused by bundled startup); `TopicDocument`/`DomainDocument` types; `scripts/migrate-content.ts` (seed `documents` from `content/`, mark listed) and `scripts/export-content.ts` (published set → `content/` seed refresh); `RemoteContentSource` with IndexedDB cache, opt-in update flow incl. all-or-nothing accept (§6), bundled-seed demotion; verification below.
2. **Auth + maintainer editing** *(Fable session 3)* — magic-link sign-in UI; editor screens per §7 over `draft` (topic + domain documents, ownership-scoped); pure edit ops in engine; client-side validation + publish RPC with optimistic version error (§3); admin assigns maintainers via dashboard; privacy page; verification below.
3. **Post-handoff spec batch** *(written in Fable session 4, implemented later)* — implementer-ready specs, one per feature, self-contained per the `/delegate` convention: proposal flow (§5), asset pipeline (Supabase Storage + upload + stems from storage), editor long tail + in-app topic creation + listing + rollback UIs (§7, §3, §4), progress sync (§9). Plus `/ingest` skill hardening (separate from this plan's scope, same session). Review carry-over for the listing spec: client-side set-validation cannot see *unlisted* published docs (the catalog view hides them), so an id collision with an unlisted topic surfaces only at listing time — the admin listing flow must run the full set-validation before flipping `listed`.

## Verification

- **Step 1**: fresh browser profile loads catalog + topics from Supabase; airplane-mode reload still fully works from cache; publish a version bump (via RPC as admin) → app shows the notice, does **not** change content until accepted, then updates after accept + reload; a deliberately set-invalid update (topic referencing a deleted domain entry) is rejected whole, cache intact, failing doc named; block the Supabase host → fresh install still boots from the bundled seed; audio/image tasks still play/display via bundled assets; `corepack pnpm check` green.
- **Step 2**: two-browser test — maintainer signs in, edits a unit, publishes; learner browser gets the notice, accepts, sees the edit. Draft survives sign-out/sign-in; after publish, the editor shows the no-draft state (draft cleared). Publish with a validation error shows the human-readable rule message and does not publish. Concurrent-publish conflict surfaces the reload error. Second non-maintainer account: cannot read drafts/unlisted docs (catalog view only), cannot write (RLS), *can* insert a proposal row. `corepack pnpm check` green.
- **End state**: the four invariants re-checked — headless core untouched except pure edit ops in engine; all content still behind `ContentSource`; offline-first verified above; learner privacy: network-tab inspection shows the only learner-originated request is the **unauthenticated catalog GET** (no identifiers, no progress payloads, nothing else phoned anywhere).

## Resolved questions (grilling log, 2026-07-19)

1. Platform → Supabase, EU, free tier (auth + RLS as configuration; Sonnet-maintainable).
2. Storage → JSON documents per topic/domain, not relational mirror (validator reused; assets stay bundled/frozen until the post-handoff asset pipeline).
3. Publish → draft + explicit validated publish via atomic RPC + append-only history (deliberate act with undo).
4. Roles → magic link; per-document `maintainers` (topics and domains) + single admin; anyone creates topics, admin lists them; anon reads only via the catalog view.
5. Proposals → full-document rows, diff review, accept-into-draft, no auto-merge; authors can withdraw, never decide.
6. Sync → cache-first IndexedDB; **update opt-in, notify only** (user-amended from "apply next launch"); all-or-nothing accept; bundled content frozen as seed, re-exported on schema bumps; Supabase single source of truth.
7. Editor v1 → forms for the common 80%, ownership-scoped (topic docs vs domain docs); long tail as specs.
8. Skew → one `CONTENT_SCHEMA_VERSION` integer; old apps keep cached content; old editors refused; bump procedure = bump + admin republish + seed re-export.
9. Progress sync → same accounts, local-first wrapper store, pinned merge rules; plan only.
10. Ops → schema in git, content out; anon key public with view/RPC/RLS as the boundary; service key local-only; privacy page; GDPR deletion anonymizes attribution.
