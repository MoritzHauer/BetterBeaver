# Spec: Proposal flow (non-maintainer edits)

Implements plan 0012 §5. Self-contained per the `/delegate` convention: every design decision is pinned here; read the pointed-at files before coding, but make no new design choices.

## Goal

A signed-in user who does **not** maintain a document can edit it in the same editor screens and submit the result as a **proposal**. The document's maintainer reviews a structural diff, then **accepts into draft** (to tweak and publish normally) or **rejects with a comment** the proposer can read. No auto-merge, ever.

## Context (read first)

- `docs/plans/0012-content-backend-and-editing.md` §4–§5 (roles, proposal design).
- Backend: the `proposals` table, its RLS, and the grants **already ship** in `supabase/migrations/20260719000000_content_backend.sql` — no schema change is needed or allowed. Verify against it: any authenticated user inserts (`author = auth.uid()`, `status = 'open'`); author + doc maintainers select; author deletes while open; only maintainers update, and only `status/decided_by/decision_note/decided_at`.
- Client: `apps/web/src/screens/AuthorScreen.tsx` (entry point), `apps/web/src/screens/EditScreen.tsx` (the editor to reuse), `apps/web/src/backend/supabase.ts` (transport helpers), `apps/web/src/backend/publishCheck.ts` (validation assembly), `packages/schema/src/documents.ts` (`documentId`/`contentIdOf`, document types).

## Pinned design

### Proposer path

1. **Entry point**: `AuthorScreen`, below "your documents", a second list **"All published content — suggest edits"**: every row of the `catalog` view (`id,kind,published_version,schema_version`), minus documents the user already maintains. Selecting one opens `EditScreen` in **propose mode**.
2. **Loading**: a proposer cannot read `documents` (RLS). Propose mode loads the base document from the **`catalog` view** (`id,kind,published,published_version,schema_version`). Record `published_version` as the proposal's `base_version`.
3. **Editing**: the same `EditScreen` forms and engine edit ops, with these differences, switched by a `mode: "maintain" | "propose"` prop:
   - No backend autosave (there is no draft column for proposers). Instead autosave the working document to `localStorage` key `bb.proposal.<docId>` (JSON: `{ baseVersion, doc }`), same 1.2 s debounce + unmount flush. On entry, if that key exists and its `baseVersion` matches the current catalog version, offer "resume your suggestion / start over"; if the version differs, state that and offer only "start over" (discard the stale local copy).
   - The publish panel becomes a **Propose panel**: a required-empty-allowed note textarea and a "Submit proposal" button. No discard-draft button (clearing `bb.proposal.<docId>` via "start over" covers it).
   - Schema-skew guard, same rule as maintain mode: `schema_version > CONTENT_SCHEMA_VERSION` → read-only.
4. **Submit**: run the same validation as publish (`validateForPublish(docId, kind, working)`). Errors do **not** block — show them and change the button to "Submit with N validation issues" requiring a second click (a proposal is reviewed by a human; an imperfect one still carries value). Insert into `proposals`: `doc_id`, `base_version`, `proposed_doc` (the full working document), `note`. On success clear `bb.proposal.<docId>` and show confirmation.
5. **My proposals**: on `AuthorScreen`, list the user's own proposals (`select` scoped by RLS): doc id, status, note, `decision_note` when decided. An `open` proposal has a **Withdraw** button (RLS-backed `delete`).

### Maintainer path

6. **Surfacing**: `EditScreen` (maintain mode) shows a badge/section "N open proposals" for its document (`select ... where doc_id = ... and status = 'open'`). Each opens a review view.
7. **Diff**: computed client-side against the **base document**: the `versions` row for (`doc_id`, `base_version`) — maintainers have `select` on `versions`. If that row is missing (never published? `base_version = 0`), diff against an empty document. The diff is structural and dumb, per collection (`lessons`, `units`, `items`, `tasks`, `notes` by stem, plus `entries`, `families` for domain docs, plus the singleton `topic`/`domain` entity):
   - **added** — id in proposal, not in base; **removed** — the reverse; **changed** — both present but canonically unequal (canonical = recursive key-sorted `JSON.stringify`; put the helper in `packages/engine` next to the edit ops, with a unit test).
   - Render changed entities as flat field paths with before → after strings (reuse the `getPath` idea from `EditScreen`); no word-level text diffing.
8. **Stale flag**: if `base_version < published_version`, banner: "based on version N; current is M — review against current content before accepting."
9. **Decide**:
   - **Accept into draft**: writes `documents.draft = proposed_doc` (existing `saveDraft`), then updates the proposal `status = 'accepted'`, `decided_by = auth.uid()`, `decided_at = now`, optional `decision_note`. Order pinned: draft first, then status; if the status update fails the proposal stays open — harmless, retry. If a draft already exists, the accept button requires a confirm ("replaces your current draft"). After accept, the maintainer lands in the editor on the new draft and publishes through the normal validated path.
   - **Reject**: status update only, `decision_note` required (non-empty) — the proposer deserves a reason.
   - Both updates go through a new `decideProposal` helper in `backend/supabase.ts`; server-side RLS is the real enforcement.

### Out of scope

Notifications/email, proposal comments/threads, partial (per-entity) accept, proposals on unlisted documents (the catalog view can't serve them to proposers), and any migration change.

## Verification (all in a real browser, two accounts)

- Non-maintainer: suggest-edits list shows listed docs; edit + reload resumes from `bb.proposal.<docId>`; submit with a deliberate validation error requires the second click; proposal appears under "My proposals"; withdraw works; after withdrawal the maintainer no longer sees it.
- Maintainer: sees the open proposal, diff shows exactly the added/removed/changed entities of a scripted edit (add one item, delete one task, change one title); accept lands it as the draft and the decided proposal leaves the open list; publish then delivers it to a learner browser via the update banner. Reject requires a note; the proposer sees it.
- RLS negative checks from the browser console: proposer cannot update proposal status (0 rows), cannot read others' proposals.
- Stale case: publish the doc between proposal creation and review → stale banner shows.
- `corepack pnpm check` green; no engine/schema layering violations (diff helper is pure, in engine).
