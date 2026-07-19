# Supabase backend (plan 0012)

The schema lives here as SQL migrations — git is the truth for the schema; the backend is the truth for content.

## Applying migrations

Either paste each file from `migrations/` (in filename order) into the project's **SQL editor** (dashboard → SQL), or use the Supabase CLI:

```sh
supabase link --project-ref <ref>   # once, needs an access token
supabase db push                    # applies pending migrations
```

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
     select 'kyrgyz', id from auth.users where email = 'author@example.com';
   ```

## App configuration

`apps/web/.env.local` (git-ignored; also set as repo Actions variables for the deployed build):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Unset → the app runs bundled-only (dev convenience and the permanent escape hatch). The anon key is public by design; the catalog view + RPCs + RLS in the migrations are the actual boundary (plan 0012 §4).

The `service_role` key bypasses everything — it is used only by `scripts/migrate-content.ts`, run locally, never committed, never in CI.

## Refreshing the bundled seed

Part of every `CONTENT_SCHEMA_VERSION` bump (plan 0012 §8), or whenever the frozen seed should catch up:

```sh
SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/export-content.ts
corepack pnpm exec prettier --write content && corepack pnpm check
```
