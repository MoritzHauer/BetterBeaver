-- Plan 0015 decision 7: anon-readable, counts-only vote aggregate powering
-- the Library card rating ("👍 12 · 👎 3").
--
-- This is the first anon SELECT surface adjacent to the feedback tables —
-- plan 0014 deliberately had none (votes readable only by maintainers via
-- RLS). Owner-confirmed trade-off, kept as narrow as the catalog view:
--   - counts only, grouped by doc_id: no individual rows, no device_id,
--     no created_at — nothing to correlate a voter across documents;
--   - joined to listed-and-published documents (the exact catalog
--     predicate), so votes on unlisted/unpublished documents never leak
--     the existence of those doc ids to anon;
--   - every vote on the document counts toward its Book, regardless of
--     content_kind — a vote on a lesson is still feedback about the Book
--     (plan 0015 §7).

create view public.vote_counts with (security_invoker = off) as
  select
    votes.doc_id,
    count(*) filter (where votes.value = 1)  as upvotes,
    count(*) filter (where votes.value = -1) as downvotes
  from public.feedback_votes votes
  join public.documents docs on docs.id = votes.doc_id
  where docs.listed and docs.published is not null
  group by votes.doc_id;

grant select on public.vote_counts to anon, authenticated;
