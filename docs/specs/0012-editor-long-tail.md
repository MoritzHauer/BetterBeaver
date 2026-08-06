# Spec: Editor long tail — remaining forms, preview, topic creation, listing, rollback

Implements plan 0012 §7's deferrals plus §3/§4's admin UIs. Self-contained per the `/delegate` convention; make no new design choices. Items are independent unless a dependency is stated — land and verify them one at a time.

> **Partly superseded 2026-07-31 by [plan 0021](../plans/0021-in-place-editing.md).** That plan replaces the form-based editor this spec extends, so **§1 and §2 must not be built** — each is struck below with the 0021 section that replaces it. §3 is half absorbed. **Live work here: §4, §5, §6, and §3's autosave retry.** Do not implement a struck item; if a struck item looks necessary, the 0021 section it points at is the design of record.

## Context (read first)

- `apps/web/src/screens/EditScreen.tsx` (the editor as shipped), `AuthorScreen.tsx`, `apps/web/src/backend/supabase.ts`, `apps/web/src/backend/publishCheck.ts`.
- `packages/schema/src/entities.ts` — the entity contract every form must mirror.
- `packages/engine/src/documentEdit.ts` — pure ops; extend here, never mutate documents in the UI layer.
- Supabase boundary: `supabase/migrations/20260719000000_content_backend.sql`. No changes to the applied migration; new migrations only (none should be needed — say so in the PR if one becomes unavoidable).

## Items

### ~~1. Missing topic-document forms~~ — SUPERSEDED

**Do not build.** Every item below lands in plan 0021 on a learner-facing surface instead of a form: Resources and `sourceRef` → [0021 §9](../plans/0021-in-place-editing.md) (Sources page, plus a seeded default resource so a new item is valid on creation); unlock chaining → 0021 §8 (it already has a learner surface — the lock icons); lexeme links → 0021 §6 (the lexicon picker); remaining item/task fields → 0021 §9; asset-backed task types → 0021 §9's constructible-only exercise list, which derives them from `TASK_REQUIRED_ASSET` rather than hand-writing a form per type. Kept below as the record of what was scoped.

- **Resources**: root `TopicEditor` view gains a Resources section — list by `id`, add/edit/delete with fields from `resourceSchema` in `entities.ts` (id, title, url/citation fields as defined there). Deleting a resource still referenced by `sourceRef`s fails at publish (existing validator rule) — no cascade.
- **Unlock chaining**: unit form gains `unlocksAfterUnitId`, lesson form gains `unlocksAfterLessonId` — plain text fields via the existing `FieldSpec` mechanism, empty = absent (the `setPath` empty-string-deletes rule already handles this).
- **Remaining item/task fields**: audit `entities.ts` against `ITEM_FIELDS` and the task form; add any field the schema knows and the editor cannot reach (e.g. task `instructions` exists — check per-type extras like cloze `blankPolicy`-style fields if present in the schema). The audit list goes in the PR description.
- **Lexeme link editing**: in the domain entry form, edit `payload.links` as rows of (entryId, type) with type from the link-type union in `entities.ts`; unknown entry ids surface at publish, not in the form.
- **Task-type editors for asset-backed types** (listen/dictation/shadowing/minimal-pair/picture): only after `0012-asset-pipeline.md` lands. Fields per type from `entities.ts` (`TASK_REQUIRED_ASSET` names which asset ref each type needs); asset refs are chosen from the document's asset list (a select fed by the asset manifest), not typed free-form.

### ~~2. Draft preview~~ — SUPERSEDED

**Do not build.** Replaced by [0021 §10](../plans/0021-in-place-editing.md), which keeps this section's core mechanism (assemble → validate → `DocumentContentSource` → no-op `ProgressStore`) but makes Preview a mode on the learner screens rather than a wrapper reached from a form, adds Diff and a What-changed index alongside it, passes a full attempted-task set so nothing is gated, and threads `listDocumentAssets`'s live stems in — without which an asset uploaded for an unpublished draft reads as dangling. Kept below as the record.

"Preview" button in the editor header. Assemble the draft with the published rest of the catalog exactly as `validateForPublish` does; if validation fails, show the errors (preview of an invalid draft is undefined — the publish panel already renders these messages). If it passes, render the existing learner screens (`TopicScreen`/`UnitScreen` tree) against a `DocumentContentSource` built from that assembled set, inside a read-only "previewing draft — exit" wrapper. No progress writes from preview: pass a no-op `ProgressStore` (in-memory stub), and no task attempts are recorded.

### 3. Editor robustness (small, do together) — PARTLY SUPERSEDED

- ~~**Delete confirms**~~ — **done by deletion 2026-08-04.** The `RowActions` / "Delete this …" buttons this describes went with the form editor (0021 slice 11). The in-place surfaces that replaced them ship their own confirms, named by title rather than by id — lesson, unit and source deletes each go through `ConfirmSheet`.
- **Autosave retry** — **LIVE.** On failed draft save, retry with backoff (5 s, 30 s, then every 60 s) while dirty; the status line shows "retrying…". A manual "Save now" appears in the error state. Still wanted; the autosave now lives in `EditSession` (0021 §8) — `MaintainEditScreen` was deleted in slice 11 — so build it there.
- **Conflict surfacing** — **LIVE.** If `saveDraft` starts failing because the session expired, say so ("signed out — sign in again in the Authoring screen") instead of the generic connection message (detect via `supabase.auth.getSession()` returning no session). Same note: the autosave lives in `EditSession`.

### 4. In-app topic creation — LIVE, but amended by 0021 §7

Three changes before building this: **(a)** it must create the Book **and its own lexicon** as a pair, not just the Book — as written, a creator ends up pointing at a domain they cannot create, which is why the last sentence below is now wrong. Verified during 0021's design that this needs no migration: `documents_insert` is `with check (created_by = auth.uid())` with no `kind` restriction, `kind` is in the insert grant, and `documents_creator_maintainer` fires on any insert with `created_by not null`. **(b)** derive the lexicon's `code` from the generated document id, **not** from the user's slug — `validateContentSet` enforces unique domain codes but never checks Book codes, so a slug-derived code can collide where a duplicate Book code would not. **(c)** seed one resource (the Book itself) and default new items' `sourceRef` to it, so the Book's first item is valid on creation.

**Superseded in part 2026-08-04**: (a), (b) and (c) all shipped in 0021 slice 10 — `AuthorScreen`'s **New Book** creates the pair with ids-derived codes and one seeded resource. What is still open here is the id/slug form this paragraph describes, which was never built and no longer should be (ids have been generated since spec 0018). `AuthorScreen` gains "New topic": form for slug id + title. Inserts a `documents` row: `id = documentId("topic", slug)`, `kind = "topic"`, `schema_version = CONTENT_SCHEMA_VERSION`, `created_by = auth.uid()`, and `draft` = a minimal skeleton `TopicDocument` (topic entity with the given id/title, a fresh `code` equal to the slug, empty lessons/units/items/tasks/resources/notes). The backend trigger makes the creator maintainer; `listed` stays false (grant excludes it). Duplicate id → surface the PK violation as "that id is taken". After creation, open the editor. Domains stay admin-created (dashboard) — no UI.

### 5. Admin listing UI

Visible only when the account is in `admins` (probe: `select` own row from `admins`). On `AuthorScreen`, an Admin section listing **unlisted** documents with a published version (admins see all rows via RLS). Per document: **"Validate & list"** — assemble ALL published documents (listed and unlisted — admin `select` on `documents`, not the catalog view) plus this one, run `validateContent` + `validateContentSet` over the full would-be-public set, and only on success call the `set_listed` RPC. This closes the review carry-over pinned in plan 0012 step 3: an id collision with an unlisted document is caught exactly here, because the publish-time check cannot see unlisted rows. Also an **Unlist** button (same RPC, `false`) with confirm.

### 6. Rollback UI

In the editor of a published document, a **History** section: `versions` rows for the doc (version, published_at, published_by e-mail is NOT available — show the uuid-less "by a maintainer" or nothing; do not join `auth.users`). "Restore this version" loads that `versions.doc` as the working draft (confirm if a draft exists, same rule as proposal-accept), letting the maintainer review and publish through the normal validated path. No direct-publish shortcut — restore goes through draft + validate + publish like any edit.

### 7. UI-audit remainder (W2–W7) — DONE 2026-07-19

All findings of `docs/ui-review-2026-07-19.md` are fixed (C1–C2, F1–F5, W1 in the hardening pass; W2–W7 in a follow-up the same day: trail-dot tap halos, 44px row actions, `p.card`/`form.card` padding, `.editor.read-only` dimming, editor `overflow-wrap`, `::placeholder` color). Verify against the audit's numbers, don't re-fix.

## Out of scope

Undo/redo inside forms, mobile-optimized editor layout, concurrent co-editing beyond the existing optimistic version check, maintainer management UI (stays dashboard SQL), domain creation UI.

## Verification

Per item, in a real browser signed in as a maintainer (and as admin for item 5): create a topic end-to-end (create → author a minimal lesson/unit/item/task → preview → publish attempt fails while unlisted-domain refs are wrong → fix → publish → admin validates & lists → learner browser receives it after accept). History restore round-trips an old version through draft → publish. Autosave is local-first since 2026-07-20 (localStorage + explicit root-view Sync) — verify offline edits survive a reload and sync once back online. `corepack pnpm check` green after every item.
