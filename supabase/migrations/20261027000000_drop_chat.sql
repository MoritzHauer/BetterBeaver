-- Remove the public per-topic chat (plan 0014). The app switched it off in
-- July 2026 and its code is now gone, but the database side stayed live:
-- anon could still insert into chat_messages, and the security-definer view
-- chat_messages_public exposed every message with no listed-document filter.
--
-- Votes and reports stay as they are, except that 'chat_message' is no
-- longer a reportable content_kind. Reports of that kind point at messages
-- this migration deletes, so they go first and the narrower check applies
-- cleanly.

drop view public.chat_messages_public;

drop policy chat_messages_insert on public.chat_messages;
drop policy chat_messages_select on public.chat_messages;
drop policy chat_messages_delete on public.chat_messages;

drop table public.chat_messages;

delete from public.feedback_reports where content_kind = 'chat_message';

-- The original check was inline and unnamed, so it got Postgres's default
-- name for a single-column check on this table.
alter table public.feedback_reports
  drop constraint feedback_reports_content_kind_check;
alter table public.feedback_reports
  add constraint feedback_reports_content_kind_check
  check (content_kind in ('topic', 'lesson', 'unit', 'item', 'task', 'note'));
