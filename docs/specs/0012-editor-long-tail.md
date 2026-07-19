# Spec: Editor long tail — remaining forms, preview, topic creation, listing, rollback

Implements plan 0012 §7's deferrals plus §3/§4's admin UIs. Self-contained per the `/delegate` convention; make no new design choices. Items are independent unless a dependency is stated — land and verify them one at a time.

## Context (read first)

- `apps/web/src/screens/EditScreen.tsx` (the editor as shipped), `AuthorScreen.tsx`, `apps/web/src/backend/supabase.ts`, `apps/web/src/backend/publishCheck.ts`.
- `packages/schema/src/entities.ts` — the entity contract every form must mirror.
- `packages/engine/src/documentEdit.ts` — pure ops; extend here, never mutate documents in the UI layer.
- Supabase boundary: `supabase/migrations/20260719000000_content_backend.sql`. No changes to the applied migration; new migrations only (none should be needed — say so in the PR if one becomes unavoidable).

## Items

### 1. Missing topic-document forms

- **Resources**: root `TopicEditor` view gains a Resources section — list by `id`, add/edit/delete with fields from `resourceSchema` in `entities.ts` (id, title, url/citation fields as defined there). Deleting a resource still referenced by `sourceRef`s fails at publish (existing validator rule) — no cascade.
- **Unlock chaining**: unit form gains `unlocksAfterUnitId`, lesson form gains `unlocksAfterLessonId` — plain text fields via the existing `FieldSpec` mechanism, empty = absent (the `setPath` empty-string-deletes rule already handles this).
- **Remaining item/task fields**: audit `entities.ts` against `ITEM_FIELDS` and the task form; add any field the schema knows and the editor cannot reach (e.g. task `instructions` exists — check per-type extras like cloze `blankPolicy`-style fields if present in the schema). The audit list goes in the PR description.
- **Lexeme link editing**: in the domain entry form, edit `payload.links` as rows of (entryId, type) with type from the link-type union in `entities.ts`; unknown entry ids surface at publish, not in the form.
- **Task-type editors for asset-backed types** (listen/dictation/shadowing/minimal-pair/picture): only after `0012-asset-pipeline.md` lands. Fields per type from `entities.ts` (`TASK_REQUIRED_ASSET` names which asset ref each type needs); asset refs are chosen from the document's asset list (a select fed by the asset manifest), not typed free-form.

### 2. Draft preview

"Preview" button in the editor header. Assemble the draft with the published rest of the catalog exactly as `validateForPublish` does; if validation fails, show the errors (preview of an invalid draft is undefined — the publish panel already renders these messages). If it passes, render the existing learner screens (`TopicScreen`/`UnitScreen` tree) against a `DocumentContentSource` built from that assembled set, inside a read-only "previewing draft — exit" wrapper. No progress writes from preview: pass a no-op `ProgressStore` (in-memory stub), and no task attempts are recorded.

### 3. Editor robustness (small, do together)

- **Delete confirms**: every destructive row action (`RowActions` onRemove, "Delete this …" buttons) gets a `window.confirm` naming the id.
- **Autosave retry**: on failed draft save, retry with backoff (5 s, 30 s, then every 60 s) while dirty; the status line shows "retrying…". A manual "Save now" appears in the error state.
- **Conflict surfacing**: if `saveDraft` starts failing because the session expired, say so ("signed out — sign in again in the Authoring screen") instead of the generic connection message (detect via `supabase.auth.getSession()` returning no session).

### 4. In-app topic creation

`AuthorScreen` gains "New topic": form for slug id + title. Inserts a `documents` row: `id = documentId("topic", slug)`, `kind = "topic"`, `schema_version = CONTENT_SCHEMA_VERSION`, `created_by = auth.uid()`, and `draft` = a minimal skeleton `TopicDocument` (topic entity with the given id/title, a fresh `code` equal to the slug, empty lessons/units/items/tasks/resources/notes). The backend trigger makes the creator maintainer; `listed` stays false (grant excludes it). Duplicate id → surface the PK violation as "that id is taken". After creation, open the editor. Domains stay admin-created (dashboard) — no UI.

### 5. Admin listing UI

Visible only when the account is in `admins` (probe: `select` own row from `admins`). On `AuthorScreen`, an Admin section listing **unlisted** documents with a published version (admins see all rows via RLS). Per document: **"Validate & list"** — assemble ALL published documents (listed and unlisted — admin `select` on `documents`, not the catalog view) plus this one, run `validateContent` + `validateContentSet` over the full would-be-public set, and only on success call the `set_listed` RPC. This closes the review carry-over pinned in plan 0012 step 3: an id collision with an unlisted document is caught exactly here, because the publish-time check cannot see unlisted rows. Also an **Unlist** button (same RPC, `false`) with confirm.

### 6. Rollback UI

In the editor of a published document, a **History** section: `versions` rows for the doc (version, published_at, published_by e-mail is NOT available — show the uuid-less "by a maintainer" or nothing; do not join `auth.users`). "Restore this version" loads that `versions.doc` as the working draft (confirm if a draft exists, same rule as proposal-accept), letting the maintainer review and publish through the normal validated path. No direct-publish shortcut — restore goes through draft + validate + publish like any edit.

### 7. UI-audit remainder (W2–W7)

Work through the Warnings section of `docs/ui-review-2026-07-19.md` (trail-dot tap targets, editor row-action sizing, card padding gaps, read-only fields visibly disabled, id overflow, placeholder contrast). The Critical and AA-failure findings (C1–C2, F1–F5, W1) were fixed 2026-07-19 — verify against the audit's numbers, don't re-fix.

## Out of scope

Undo/redo inside forms, mobile-optimized editor layout, concurrent co-editing beyond the existing optimistic version check, maintainer management UI (stays dashboard SQL), domain creation UI.

## Verification

Per item, in a real browser signed in as a maintainer (and as admin for item 5): create a topic end-to-end (create → author a minimal lesson/unit/item/task → preview → publish attempt fails while unlisted-domain refs are wrong → fix → publish → admin validates & lists → learner browser receives it after accept). History restore round-trips an old version through draft → publish. Autosave retry observed by toggling the network offline in devtools. `corepack pnpm check` green after every item.
