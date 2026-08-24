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

## Testing the authoring flow as a signed-in account

Sign-in is magic-link only, so testing it normally needs an inbox. `admin/generate_link` hands back the same link instead of mailing it, which makes the real flow scriptable — no dev-only sign-in path in the app, and nothing to reverse-engineer about session storage:

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/test-session.ts
```

It creates `claude-test@example.com` on first run and prints a one-shot sign-in link (open it and you land in the app signed in as that account) plus the raw access token (for curling the RPCs as an authenticated author). `http://localhost:5173` is already in the project's allowed redirect URLs; any other origin has to be added under Auth → URL Configuration first, or the link silently bounces to the site URL.

For clicking through the UI, `playwright` is a root dev dependency (`corepack pnpm exec playwright install chromium` once per machine). Throwaway browser scripts go in `scratch.local/` — git-, prettier- and eslint-ignored, so they never reach the gate:

```ts
import { chromium } from "playwright";
import { mintTestSession } from "../scripts/test-session.ts";

const { actionLink } = await mintTestSession();
const page = await (await chromium.launch()).newPage();
await page.goto(actionLink); // lands on the app, already signed in
```

**This is production.** The test account owns nothing — give it maintainer rights by having it create its own Book in the app, never by granting it rows on a real document. Cleanup command (and the caveat that its documents outlive it) is in the script's header comment.

## Authoring without a service key (proposal-only account)

The editing loop for someone who is **not** a maintainer — a second author, another machine, or an agent session. They can read the published catalog and file proposals; they cannot publish, list, or see anything unlisted. The service key never leaves the owner's machine.

### One-time setup (owner)

1. **Create the account.** It is created on first mint, so this is just the mint command — run it once from the repo root:

   ```sh
   SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service key> \
   node scripts/author-token.ts
   ```

   Override the address with `BB_AUTHOR_EMAIL=...`; the default is `claude-author@betterbeaver.de`. The address never receives mail (sign-in happens through `admin/generate_link`), so it does not have to be a real inbox — but keep it distinct from your own account and from `claude-test@example.com`, so the review queue shows who proposed what.

2. **Grant it nothing.** No `public.admins` row, no `public.maintainers` row. That is the whole security model — the account's abilities are exactly what the `authenticated` policies give a stranger: `select` on `catalog`, and `insert`/`select`/`delete` of its own `proposals`. Verify with:

   ```sql
   select u.email, a.user_id is not null as is_admin, m.doc_id as maintains
   from auth.users u
   left join public.admins a on a.user_id = u.id
   left join public.maintainers m on m.user_id = u.id
   where u.email = 'claude-author@betterbeaver.de';
   ```

   One row, `is_admin` false, `maintains` null. If `maintains` is non-null, that account can publish — revoke it with `delete from public.maintainers where user_id = '<id>';`.

3. **Hand over three values.** `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public by design — it ships in the app) and the printed `BB_AUTHOR_TOKEN`. The token is a JWT that **expires after an hour**; re-run the mint command for a fresh one. Nothing long-lived is ever shared, which is the point: a leaked token is dead by the next meal, and a leaked _account_ can only file proposals you decline.

To retire the account entirely:

```sh
curl -X DELETE "$SUPABASE_URL/auth/v1/admin/users/<user id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Its open proposals lose their author (`on delete set null`) and stay in the queue; decide or delete them first if you would rather they vanish.

### The loop (author)

```sh
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_ANON_KEY=<anon key>
export BB_AUTHOR_TOKEN=<from the owner>          # expires after an hour

BB_CONTENT_DIR=/tmp/bb-edit node scripts/pull-book.ts kyrgyz
# edit the JSON under /tmp/bb-edit, then — always — validate:
BB_CONTENT_DIR=/tmp/bb-edit corepack pnpm exec vitest run \
  packages/schema/src/content.test.ts
BB_CONTENT_DIR=/tmp/bb-edit node scripts/propose-book.ts "what changed and why"
```

Keep the token out of shell history and out of command lines that get logged: put the three exports in a git-ignored `.env.local` and load it with `set -a; . .env.local; set +a`.

The proposal lands in the maintainer's queue (Edit → the document → open proposals) with a structural diff. Accepting it puts the change in the maintainer's **draft** — a second look before anything reaches learners. The author can withdraw their own proposal while it is open.

Two things this loop cannot catch, both inherited from `pull-book.ts`: a partial tree cannot run `validateContentSet`, so an item id that collides with a Book _outside_ the pulled tree still slips through to review; and assets are symlinked from the repo, so a Book whose assets are not in `content/` validates against empty stem lists.

### Identity precedence

`scripts/author-auth.ts` resolves one of three identities, in this order: `BB_AUTHOR_TOKEN` (+ anon key) → `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_ANON_KEY` alone. Author mode wins over the service key deliberately — minting a token is a deliberate act, and a shell carrying both should act as the weaker identity. Anon mode can pull a listed Book and nothing else.

If the account is later added to `public.maintainers` for one document, the same token also publishes that document (via the `publish_document` RPC's maintainer check) — a separate decision, not something this setup implies.

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
