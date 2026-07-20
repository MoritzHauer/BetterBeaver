# Supabase backend (plan 0012)

The schema lives here as SQL migrations — git is the truth for the schema; the backend is the truth for content.

## Applying migrations

Either paste each file from `migrations/` (in filename order) into the project's **SQL editor** (dashboard → SQL), or use the Supabase CLI:

```sh
supabase link --project-ref <ref>   # once, needs an access token
supabase db push                    # applies pending migrations
```

Pick one method per project and stick with it. If a migration was ever applied by
pasting it into the dashboard SQL editor, the CLI doesn't know — its migration
history table (`supabase_migrations.schema_migrations`) only gets a row when the
CLI itself runs the migration. Switching to `supabase db push` afterwards will try
to replay already-applied files from statement 0 and fail with `relation ...
already exists`. Before the first `db push` against a project with dashboard-applied
history, mark those migrations as already applied (no SQL is re-run, only the
CLI's bookkeeping is updated):

```sh
supabase migration repair --status applied <version> [<version> ...]
```

(`<version>` is the migration filename's leading timestamp, e.g. `20260719000000`.)

## One-time setup after the project exists

1. Apply the migrations (above).
2. **Auth**: dashboard → Authentication → Sign In / Up: enable **Email** with magic links (OTP/link, no passwords). Add the deployed app origin (`https://<user>.github.io`) to the allowed redirect URLs.
3. **Seed content** (from the repo root):
   ```sh
   SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service key> \
   node scripts/migrate-content.ts
   ```
4. **Make yourself admin**: sign in to the app once (creates your `auth.users` row), then in the SQL editor:
   ```sql
   insert into public.admins select id from auth.users where email = 'you@example.com';
   ```
   Maintainers are assigned the same way for now (in-app listing/maintainer UI is post-handoff):
   ```sql
   insert into public.maintainers (doc_id, user_id)
     select 'topic:kyrgyz', id from auth.users where email = 'author@example.com';
   ```

## App configuration

`apps/web/.env.local` (git-ignored; also set as repo Actions variables for the deployed build):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Unset → the app runs bundled-only (dev convenience and the permanent escape hatch). The anon key is public by design; the catalog view + RPCs + RLS in the migrations are the actual boundary (plan 0012 §4).

The `service_role` key bypasses everything — it is used only by `scripts/migrate-content.ts`, run locally, never committed, never in CI.

## Publishing local content/ edits (ingest, schema bumps)

Content authored locally in the `content/` tree (an `/ingest` run, or the admin republish step of a `CONTENT_SCHEMA_VERSION` bump) ships with:

```sh
corepack pnpm check   # validates the content/ tree — must be green first
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts
```

Only changed documents get a version bump (with a `versions` history row — never use `migrate-content.ts --force` for this, it resets history); new documents are inserted unlisted until the admin lists them (`update public.documents set listed = true where id = '<doc id>';` in the SQL editor — the `set_listed` RPC needs a signed-in admin, which the SQL editor is not). In-app drafts are left alone: a maintainer publishing over a script-bumped version hits the RPC's "reload" conflict, by design.

## Refreshing the bundled seed

Part of every `CONTENT_SCHEMA_VERSION` bump (plan 0012 §8), or whenever the frozen seed should catch up:

```sh
SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/export-content.ts
corepack pnpm exec prettier --write content && corepack pnpm check
```
