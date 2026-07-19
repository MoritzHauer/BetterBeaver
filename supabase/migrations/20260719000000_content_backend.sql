-- Plan 0012 step 1: content backend schema.
-- The authorization boundary is three-layered (plan 0012 §4):
--   1. anon (learners) read ONLY through the security-definer `catalog` view
--      — no table grants at all, so drafts/unlisted docs are structurally
--      invisible;
--   2. sensitive columns (published*, listed, versions rows) change only via
--      security-definer RPCs (`publish_document`, `set_listed`);
--   3. row-level security + column grants scope what authenticated authors
--      can touch directly (their drafts, their proposals).

-- ---------------------------------------------------------------- tables

create table public.documents (
  id                text primary key,  -- '<kind>:<content-id>', e.g. 'topic:kyrgyz' — topics and domains are separate content-id namespaces
  kind              text not null check (kind in ('topic', 'domain')),
  published         jsonb,
  published_version int  not null default 0,
  schema_version    int  not null,
  draft             jsonb,
  listed            boolean not null default false,
  created_by        uuid references auth.users on delete set null,
  updated_at        timestamptz not null default now()
);

create table public.versions (
  doc_id       text not null references public.documents on delete cascade,
  version      int  not null,
  doc          jsonb not null,
  published_by uuid references auth.users on delete set null,
  published_at timestamptz not null default now(),
  primary key (doc_id, version)
);

create table public.maintainers (
  doc_id  text not null references public.documents on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (doc_id, user_id)
);

create table public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table public.proposals (
  id            uuid primary key default gen_random_uuid(),
  doc_id        text not null references public.documents on delete cascade,
  base_version  int  not null,
  proposed_doc  jsonb not null,
  author        uuid references auth.users on delete set null,
  note          text,
  status        text not null default 'open'
                check (status in ('open', 'accepted', 'rejected')),
  decided_by    uuid references auth.users on delete set null,
  decision_note text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

-- ------------------------------------------------------------- helpers

-- security definer so the checks can read admins/maintainers regardless of
-- those tables' own RLS (the standard Supabase role-helper pattern).
create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create function public.is_maintainer(doc text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.maintainers
    where doc_id = doc and user_id = auth.uid()
  )
$$;

-- --------------------------------------------------------------- grants
-- Supabase pre-grants broadly to anon/authenticated; revoke and re-grant
-- exactly what plan 0012 §4 allows. anon gets nothing on the tables.

revoke all on public.documents, public.versions, public.maintainers,
  public.admins, public.proposals from anon, authenticated;

-- The service key (seed/export scripts, admin surgery) gets full access;
-- it bypasses RLS by role attribute but still needs table grants.
grant all on public.documents, public.versions, public.maintainers,
  public.admins, public.proposals to service_role;

grant select on public.documents to authenticated;
grant insert (id, kind, draft, schema_version, created_by)
  on public.documents to authenticated;
grant update (draft) on public.documents to authenticated;

grant select on public.versions to authenticated;

grant select, insert, delete on public.maintainers to authenticated;
grant select on public.admins to authenticated;

grant select, insert, delete on public.proposals to authenticated;
grant update (status, decided_by, decision_note, decided_at)
  on public.proposals to authenticated;

-- ------------------------------------------------------------------ RLS

alter table public.documents  enable row level security;
alter table public.versions   enable row level security;
alter table public.maintainers enable row level security;
alter table public.admins     enable row level security;
alter table public.proposals  enable row level security;

-- documents: maintainers (and admins) see and draft-edit their documents;
-- any authenticated user may create one (listed/published* are not in the
-- insert grant, so their safe defaults are forced).
create policy documents_select on public.documents
  for select to authenticated using (public.is_maintainer(id));
create policy documents_insert on public.documents
  for insert to authenticated
  with check (created_by = auth.uid());
create policy documents_update on public.documents
  for update to authenticated
  using (public.is_maintainer(id)) with check (public.is_maintainer(id));

create policy versions_select on public.versions
  for select to authenticated using (public.is_maintainer(doc_id));
-- versions inserts happen only inside publish_document (security definer).

-- maintainers: visible to the doc's maintainers and oneself; only admins
-- write (the creator trigger below is security definer and bypasses this).
create policy maintainers_select on public.maintainers
  for select to authenticated
  using (user_id = auth.uid() or public.is_maintainer(doc_id));
create policy maintainers_insert on public.maintainers
  for insert to authenticated with check (public.is_admin());
create policy maintainers_delete on public.maintainers
  for delete to authenticated using (public.is_admin());

create policy admins_select on public.admins
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- admins rows are managed via the dashboard/service role only.

-- proposals (plan 0012 §5): anyone authenticated proposes; the doc's
-- maintainers and the author read; the author may withdraw (delete) while
-- open; ONLY maintainers decide — the column grant limits the decision to
-- status/decided_* and the check pins the decider's identity.
create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (author = auth.uid() and status = 'open');
create policy proposals_select on public.proposals
  for select to authenticated
  using (author = auth.uid() or public.is_maintainer(doc_id));
create policy proposals_delete on public.proposals
  for delete to authenticated
  using (author = auth.uid() and status = 'open');
create policy proposals_decide on public.proposals
  for update to authenticated
  using (public.is_maintainer(doc_id))
  with check (
    public.is_maintainer(doc_id)
    and status in ('accepted', 'rejected')
    and decided_by = auth.uid()
  );

-- ------------------------------------------------------- learner read path

-- Security-definer view (owner bypasses RLS) exposing exactly the published
-- face of listed documents — the ONLY thing anon can read.
create view public.catalog with (security_invoker = off) as
  select id, kind, published, published_version, schema_version
  from public.documents
  where listed and published is not null;

grant select on public.catalog to anon, authenticated;

-- ----------------------------------------------------------------- RPCs

-- Atomic publish (plan 0012 §3): maintainer check, optimistic version
-- check, publish + history row + draft clear in one transaction. Rollback
-- is this same function called with a historical `versions.doc`.
create function public.publish_document(
  doc_id text,
  expected_version int,
  new_doc jsonb,
  new_schema_version int
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_version int;
begin
  if not public.is_maintainer(doc_id) then
    raise exception 'not a maintainer of %', doc_id;
  end if;
  select d.published_version into current_version
    from public.documents d where d.id = doc_id for update;
  if not found then
    raise exception 'unknown document %', doc_id;
  end if;
  if current_version <> expected_version then
    raise exception
      'someone else published % meanwhile - reload (expected version %, found %)',
      doc_id, expected_version, current_version;
  end if;
  update public.documents d
    set published = new_doc,
        published_version = current_version + 1,
        schema_version = new_schema_version,
        draft = null,
        updated_at = now()
    where d.id = doc_id;
  insert into public.versions (doc_id, version, doc, published_by)
    values (doc_id, current_version + 1, new_doc, auth.uid());
end
$$;

create function public.set_listed(doc_id text, value boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.documents d
    set listed = value, updated_at = now()
    where d.id = doc_id;
  if not found then
    raise exception 'unknown document %', doc_id;
  end if;
end
$$;

revoke execute on function public.publish_document, public.set_listed
  from public, anon;
grant execute on function public.publish_document, public.set_listed
  to authenticated;

-- ------------------------------------------------------------- triggers

-- Creation self-service (plan 0012 §4): the creator becomes maintainer of
-- their new document. Security definer because maintainers writes are
-- otherwise admin-only. Service-role seeding (created_by null) skips it.
create function public.add_creator_as_maintainer() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.maintainers (doc_id, user_id)
    values (new.id, new.created_by);
  return new;
end
$$;

create trigger documents_creator_maintainer
  after insert on public.documents
  for each row when (new.created_by is not null)
  execute function public.add_creator_as_maintainer();

create function public.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger documents_touch
  before update on public.documents
  for each row execute function public.touch_updated_at();
