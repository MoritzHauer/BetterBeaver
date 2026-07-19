# Spec: Learner progress sync

Implements plan 0012 §9 exactly as pinned there — same magic-link accounts, local-first wrapper, per-key merge rules. Self-contained per the `/delegate` convention; make no new design choices. Opt-in stays absolute: a learner without an account (or with sync off) sends **nothing**, exactly as today.

## Context (read first)

- `docs/plans/0012-content-backend-and-editing.md` §9 (the normative design) and §4 (accounts).
- `apps/web/src/progress/` — the learner-state modules and their localStorage keys: `local-storage.ts` (`bb.item.<schedulingUnitId>` SRS state, `bb.attempted`, `bb.streak.<domainId>`), `pinned-tasks.ts` (`bb.pinned.<domainId>`), `vocab-lists.ts` (`bb.vocablists.<domainId>`), `user-entries.ts` (`bb.userwords.<domainId>`), `backup.ts` (the export format — the authoritative enumeration of what counts as learner state), `migrations.ts` (`runStorageMigrations`).
- `packages/engine/src/interfaces.ts` (`ProgressStore`), `apps/web/src/backend/supabase.ts` (auth client to reuse).

## Pinned design

### Backend

New migration `supabase/migrations/<date>_progress_sync.sql` (never edit applied migrations):

```sql
create table public.progress (
  user_id    uuid not null references auth.users on delete cascade,
  key        text not null,          -- the localStorage key, verbatim (bb.item.<id>, bb.streak.<domainId>, …)
  value      jsonb not null,         -- the key's parsed JSON value
  format     int  not null,          -- PROGRESS_SYNC_FORMAT at write time
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.progress enable row level security;
create policy progress_own on public.progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.progress from anon;
grant select, insert, update, delete on public.progress to authenticated;
grant all on public.progress to service_role;
```

GDPR: the `on delete cascade` keeps account deletion complete. Extend `PrivacyScreen` with one paragraph: what sync stores (study progress keyed to your account), that it's opt-in, same deletion contact.

`export const PROGRESS_SYNC_FORMAT = 1` lives in `apps/web/src/progress/sync.ts`. Bump it whenever a storage migration changes a synced key's meaning. Skew rule: a remote row with `format > PROGRESS_SYNC_FORMAT` is neither pulled nor overwritten (skip the key entirely; the other, newer device owns it until this app updates).

### Client: `SyncedProgressStore` wrapper, outbox, merge

New module `apps/web/src/progress/sync.ts`:

- **Wrapper, not rewrite**: localStorage remains the working store. Every existing store module keeps working unchanged; sync hooks in by wrapping writes — add a tiny notification point (a `onLearnerStateChanged(key)` callback registered by sync, called by the store modules after each localStorage write; thread it through the store constructors, do not monkey-patch).
- **Outbox**: `bb.sync.outbox` — a JSON object `{ [key]: lastModifiedMs }` updated on every learner-state write while sync is enabled. `bb.sync.meta` holds `{ lastSyncMs }`.
- **Flush**: debounced 5 s after the last write, plus on `visibilitychange`→hidden and `online` events. Push = one bulk PostgREST upsert of the outbox keys' current values (`Prefer: resolution=merge-duplicates`), then clear the pushed keys from the outbox (only those unchanged since read). Failures are invisible (silent retry on next trigger) — sync failure must never surface mid-study.
- **Pull + merge** on: sign-in with sync enabled, app start (background, after render), and before the first push of a session. Pull all rows, then per key compare remote value vs local, applying the §9 rules by key pattern:

| Key pattern                | Rule                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bb.item.<id>`             | per scheduling unit: later last-review date wins ("most progressed"); compare the SRS record's own review-date field |
| `bb.attempted`             | set union                                                                                                            |
| `bb.streak.<domainId>`     | same last-active day → `max(count)`; else take the record with the later last-active day                             |
| `bb.pinned.<domainId>`     | last-write-wins (outbox `lastModifiedMs` vs row `updated_at`)                                                        |
| `bb.vocablists.<domainId>` | last-write-wins per key (accepted lossy, §9)                                                                         |
| `bb.userwords.<domainId>`  | last-write-wins per key (accepted lossy, §9)                                                                         |

Merged results overwrite localStorage; keys whose merged value differs from remote are queued for push. Remote keys absent locally are adopted; local keys absent remotely are pushed. Clock skew is accepted (§9: nothing deeper warranted for one learner across few devices).

- **No deletes are synced**: JSON export/import stays the accountless durability floor and the reset mechanism; a "reset progress" feature is out of scope.

### Opt-in UI: minimal Settings screen

This spec also creates the missing Settings screen (STATUS gap "User settings"), scoped strictly to sync:

- New `SettingsScreen`, reachable from `TopicListScreen` (a gear entry next to the author entry; visible always — settings exist without a backend too, showing just the export/import backup actions moved nowhere: link to the existing backup UI if one exists, otherwise only the sync section, hidden when the backend is unconfigured).
- Sync section: explain in two sentences (opt-in, what leaves the device); sign in with the same magic-link flow (reuse `signInWithEmail`/`currentUser`); an explicit **"Enable sync on this device"** toggle stored at `bb.sync.enabled` — signing in alone does NOT start syncing (an author may sign in with zero intent to sync their learning progress). Status line: last synced time / "sync off". Disable stops all traffic immediately and clears the outbox (local state stays).

### Out of scope

Multi-account switching, selective sync, sync of settings themselves, deleting remote state from the app (deletion goes through the GDPR contact), conflict UI (merges are silent by design).

## Verification

- Two browsers, one account, sync enabled in both: study a unit in A (grades + attempts) → B pulls on next start and shows the same due counts and attempted marks; vocab list edited in B appears in A.
- Merge rules: grade the same item in both while offline, reconnect — the later review wins; streak on the same day from both devices keeps the max; attempted union holds.
- Opt-in: fresh learner, no account — network tab shows only the catalog GET (the plan's end-state privacy invariant, re-verified). Signed-in author with sync **off** — no `progress` requests.
- Kill the network mid-session with sync on: study flow completely unaffected; queued outbox flushes when back online.
- Newer-format row (hand-insert `format = 99` via SQL) is left untouched by an old client in both directions.
- `corepack pnpm check` green.
