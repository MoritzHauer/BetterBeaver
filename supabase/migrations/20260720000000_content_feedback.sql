-- Plan 0014: content feedback (votes, reports, public per-topic chat).
--
-- Learners never have a Supabase Auth account (plan 0012 §4), so this is
-- the first surface where the `anon` role writes at all — everywhere else
-- anon reads only through the `catalog` view (see the file header above).
-- Kept narrow on purpose, mirroring that same shape:
--   - anon gets column-scoped INSERT grants only, no raw SELECT/UPDATE;
--   - votes are cast through a security-definer RPC (anon has no identity
--     for RLS to check, so an upsert-capable UPDATE grant would be wider
--     than needed — the RPC does the upsert instead);
--   - the public chat read goes through a security-definer view that
--     omits `device_id`, so anon never gets a cross-row correlation key;
--   - maintainers (existing `is_maintainer`) get full SELECT/DELETE scoped
--     to their own documents on all three tables.
--
-- Every row carries the *owning document's* id (`doc_id`), not the
-- content's own id — content lives inside whole-JSON documents (plan
-- 0012 §2), so a lesson/task/item has no row of its own for RLS to gate
-- on; only the topic or domain document does. The client resolves which
-- document owns a given piece of content (topic doc for topic/lesson/
-- unit/note/task/sentence+pair items; domain doc for lexeme/concept
-- items, which are domain-owned per plan 0006) and sends that id.

-- ---------------------------------------------------------------- tables

create table public.feedback_votes (
  doc_id       text not null references public.documents on delete cascade,
  content_kind text not null
    check (content_kind in ('topic', 'lesson', 'unit', 'item', 'task', 'note')),
  content_id   text not null,
  device_id    text not null,
  value        smallint not null check (value in (1, -1)),
  created_at   timestamptz not null default now(),
  primary key (doc_id, content_kind, content_id, device_id)
);

create table public.feedback_reports (
  id           uuid primary key default gen_random_uuid(),
  doc_id       text not null references public.documents on delete cascade,
  content_kind text not null check (
    content_kind in ('topic', 'lesson', 'unit', 'item', 'task', 'note', 'chat_message')
  ),
  content_id   text not null,
  device_id    text not null,
  display_name text not null,
  category     text not null check (category in ('error', 'explicit', 'spam', 'feedback')),
  message      text,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  doc_id       text not null references public.documents on delete cascade,
  device_id    text not null,
  display_name text not null,
  message      text not null,
  created_at   timestamptz not null default now()
);

-- --------------------------------------------------------------- grants

revoke all on public.feedback_votes, public.feedback_reports, public.chat_messages
  from anon, authenticated;
grant all on public.feedback_votes, public.feedback_reports, public.chat_messages
  to service_role;

-- anon: insert-only, column-scoped (no `resolved`, no server-owned columns).
grant insert (doc_id, content_kind, content_id, device_id, display_name, category, message)
  on public.feedback_reports to anon, authenticated;
grant insert (doc_id, device_id, display_name, message)
  on public.chat_messages to anon, authenticated;

-- maintainers: read their own documents' feedback; delete a chat message
-- (the only moderation action — report-then-delete, plan 0014).
grant select on public.feedback_votes, public.feedback_reports to authenticated;
grant update (resolved) on public.feedback_reports to authenticated;
grant select, delete on public.chat_messages to authenticated;

-- ------------------------------------------------------------------ RLS

alter table public.feedback_votes   enable row level security;
alter table public.feedback_reports enable row level security;
alter table public.chat_messages    enable row level security;

-- votes: no direct anon/authenticated policy at all — every write goes
-- through cast_vote() below (security definer, bypasses RLS). Maintainers
-- read their docs' votes for the feedback view.
create policy feedback_votes_select on public.feedback_votes
  for select to authenticated using (public.is_maintainer(doc_id));

create policy feedback_reports_insert on public.feedback_reports
  for insert to anon, authenticated with check (true);
create policy feedback_reports_select on public.feedback_reports
  for select to authenticated using (public.is_maintainer(doc_id));
create policy feedback_reports_update on public.feedback_reports
  for update to authenticated
  using (public.is_maintainer(doc_id)) with check (public.is_maintainer(doc_id));

create policy chat_messages_insert on public.chat_messages
  for insert to anon, authenticated with check (true);
create policy chat_messages_select on public.chat_messages
  for select to authenticated using (public.is_maintainer(doc_id));
create policy chat_messages_delete on public.chat_messages
  for delete to authenticated using (public.is_maintainer(doc_id));

-- ------------------------------------------------------------------ RPC

-- Cast/change/clear a vote (p_value null clears it). Security definer so
-- anon can upsert its own vote row without a raw UPDATE grant it can't be
-- scoped against (no auth.uid() to check for the anon role).
create function public.cast_vote(
  p_doc_id text,
  p_content_kind text,
  p_content_id text,
  p_device_id text,
  p_value smallint
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_value is null then
    delete from public.feedback_votes
      where doc_id = p_doc_id and content_kind = p_content_kind
        and content_id = p_content_id and device_id = p_device_id;
    return;
  end if;
  insert into public.feedback_votes (doc_id, content_kind, content_id, device_id, value)
    values (p_doc_id, p_content_kind, p_content_id, p_device_id, p_value)
  on conflict (doc_id, content_kind, content_id, device_id)
    do update set value = excluded.value, created_at = now();
end
$$;

revoke execute on function public.cast_vote from public;
grant execute on function public.cast_vote to anon, authenticated;

-- ------------------------------------------------------- learner read path

-- Public chat thread (plan 0014: visible to every learner, not just the
-- poster) — security-definer view strips device_id so anon never gets a
-- per-device correlation key across messages.
create view public.chat_messages_public with (security_invoker = off) as
  select id, doc_id, display_name, message, created_at
  from public.chat_messages;

grant select on public.chat_messages_public to anon, authenticated;
