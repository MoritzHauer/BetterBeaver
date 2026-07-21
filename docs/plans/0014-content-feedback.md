# Plan 0014: Content feedback (votes, reports, book chat)

Decided via grilling in-session 2026-07-20; implemented directly (no doc-reviewer round — scope was small enough to grill straight to code).

## What this is

Learners get a thumbs up/down and a report action on every level of content (topic/lesson/unit/item/task/note), plus a public per-topic chat. Learners are account-free (design.md's standing invariant), so all of this is anonymous, keyed by a per-device id rather than a Supabase Auth user.

## Decisions

- **Scope**: feedback (vote + report) attaches at every content level — topic, lesson, unit, item, task, note.
- **Vote**: thumbs up/down, one per device per content item (toggle to change/clear). No aggregate is shown to learners; the device's own vote is cached client-side (localStorage) and rendered from there. Server copy exists only for the maintainer view.
- **Report categories**: `error`, `explicit`, `spam` (single tap, no required text), and `feedback` (opens a plain-text box). Copyright was considered and dropped — not a category. All four may carry an optional free-text message.
- **Class chat**: one public thread per topic, visible to every learner who opens it (not a private per-device line to maintainers) — deliberate choice, moderation gap accepted for now (see below).
- **Chat moderation**: each chat message gets the same report action (error/explicit/spam/feedback) as any other content, targeting `content_kind = 'chat_message'`. Maintainers can delete a message from their doc's feedback view. No proactive moderation beyond that.
- **Rate limiting / anti-spam**: none for v1 — a device can vote once per item (unique constraint) but nothing stops chat/report flooding. Accepted ceiling, `ponytail:` comment marks it in the migration; revisit if abuse actually shows up.
- **Identity**: a per-device id + display name (`AnonymBeaver######`, random 6 digits) generated on first use, stored in `localStorage`, sent as plain columns on every vote/report/chat row — never a Supabase Auth identity. Editable on the Settings screen.
- **Maintainer view**: lives inside the existing per-document `EditScreen` (which already resolves `docId` and maintainer-ship) rather than a new top-level screen — a "Feedback" section listing reports and the chat thread for that document, with delete on chat messages.
- **Owning document routing** (technical, forced by the schema): content isn't stored per-row, so RLS can only gate access at the document level. Every feedback row carries the *owning document's* id: topic/lesson/unit/note/task/sentence-and-pair-items → the topic doc (`topic:<id>`); lexeme/concept items → their domain doc (`domain:<id>`, since lexicon entries are domain-owned per plan 0006). The client resolves which owner applies at the call site.
- **Anon read/write boundary**: mirrors the existing zero-anon-table-grants shape (plan 0012 §4) rather than inventing a new one — anon gets column-scoped INSERT grants only, no SELECT on votes or reports; the public chat read goes through a security-definer view that omits `device_id` (no anon-visible correlation key); votes are cast through a security-definer RPC (`cast_vote`) instead of a raw grant, since anon has no identity for RLS to check against and an upsert-capable UPDATE grant would be broader than needed.

## Non-scope (this pass)

- No aggregate vote tally shown anywhere (learner or maintainer) — only the maintainer's own per-row view.
- No proactive chat moderation UI beyond delete-on-report.
- No rate limiting.

## Data model

New tables (migration `supabase/migrations/`): `feedback_votes`, `feedback_reports`, `chat_messages`. See migration comments for exact grants/RLS.
