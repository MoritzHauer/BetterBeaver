-- Spec 0012-B: the asset pipeline's storage bucket.
--
-- One public bucket, `assets`. Object key layout (spec 0012-B §2):
--   <kind>/<contentId>/audio/<objectName>
--   <kind>/<contentId>/img/<objectName>
-- where <kind> is 'topic' or 'domain' — the same two values `documents.kind`
-- uses, and <kind>/<contentId> is `documents.id` ('<kind>:<contentId>') with
-- '/' in place of ':'.
--
-- Authorization mirrors the documents table's own maintainer check:
--   - insert/update/delete: authenticated, scoped to `is_maintainer` on the
--     '<kind>:<contentId>' the object's first two path segments spell out;
--   - select: anon + authenticated, unconditional on this bucket. A public
--     bucket only grants anonymous access to the public-URL *download*
--     endpoint — list() is a query against storage.objects and goes
--     through this same SELECT RLS like any other table, so without this
--     policy every learner's listing comes back empty. This grants nothing
--     the public URLs don't already expose.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', true, 10485760, array['audio/*', 'image/*'])
on conflict (id) do nothing;

-- `create policy` has no `if not exists`, and storage.objects is a pre-existing
-- table these policies may already have been hand-applied to (unlike the tables
-- the other migrations create outright). Drop-then-create keeps this rerunnable.
drop policy if exists "assets maintainer insert" on storage.objects;
drop policy if exists "assets maintainer update" on storage.objects;
drop policy if exists "assets maintainer delete" on storage.objects;
drop policy if exists "assets public read" on storage.objects;

create policy "assets maintainer insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and public.is_maintainer(
      (storage.foldername(name))[1] || ':' || (storage.foldername(name))[2]
    )
  );

create policy "assets maintainer update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and public.is_maintainer(
      (storage.foldername(name))[1] || ':' || (storage.foldername(name))[2]
    )
  )
  with check (
    bucket_id = 'assets'
    and public.is_maintainer(
      (storage.foldername(name))[1] || ':' || (storage.foldername(name))[2]
    )
  );

create policy "assets maintainer delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'assets'
    and public.is_maintainer(
      (storage.foldername(name))[1] || ':' || (storage.foldername(name))[2]
    )
  );

create policy "assets public read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'assets');
