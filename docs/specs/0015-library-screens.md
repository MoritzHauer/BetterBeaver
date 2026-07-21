# Spec 0015-5: Library + My Books screens

Normative source: [plan 0015](../plans/0015-library-marketplace.md) decisions 1, 2, 3, 6, 7a, 8, 15. Requires specs 0015-1 (rename), 0015-2 (icon), 0015-4 (per-Book source API) landed. Follow the app's existing screen/CSS idioms (plain CSS in `styles.css`, existing card/button classes where they fit; no new dependencies).

## Library browse fetch — `apps/web/src/content/library.ts` (new)

`fetchLibrary(): Promise<LibraryBook[]>` — two parallel requests via the existing anon-key fetch pattern in `source.ts` (export/reuse its helper rather than duplicating):

1. `catalog?select=id,title:published->topic->>title,description:published->topic->>description,icon:published->topic->>icon,domainId:published->topic->>domainId&kind=eq.topic`
2. `vote_counts?select=doc_id,upvotes,downvotes` (view from migration `20260721000000_vote_counts.sql`)

Merge on id (`vote_counts.doc_id` is kind-prefixed `topic:<id>`; catalog `id` likewise — strip via existing `contentIdOf`). `LibraryBook = { id, title, description, icon?, domainId, upvotes, downvotes }`. Missing vote row → 0/0.

## Library screen — `apps/web/src/screens/LibraryScreen.tsx` (new)

- New `Screen` union member `{ screen: "library" }` in `App.tsx`; entered from My Books; back returns to My Books (reuse the existing back/header pattern, incl. the mobile back-button map).
- Flat card list of every fetched Book: icon (plain text emoji; no icon → no glyph slot, same as a My Books card without one), title, description, rating per 7a — `👍 12 · 👎 3`, **omitted entirely when both counts are 0**.
- Per card: an **Add** button → `addBook(id, domainId)` with a busy state while running; already added/archived → a disabled "Added" label instead. `addBook` throws → show the error inline on that card, Book stays un-added.
- Loading state while fetching; fetch failure → inline error with a Retry button (decision 15). No search/filter (decision 8).

## My Books rework — `apps/web/src/screens/MyBooksScreen.tsx`

Today it lists the whole catalog grouped by domain. It becomes:

- **Front list: added Books only** (from the built source's `listBooks()`), flat (no domain grouping), keeping the existing card look + progress bars. Icon comes from the book's `icon` field — delete the `TOPIC_GLYPHS` map and its `ponytail:` comment (this is that fix).
- Each card gets a "⋯" overflow menu with **Archive** and **Remove**. Remove asks for confirmation (native `confirm()` is fine — existing app idiom applies if one exists) with copy stating the download is deleted but learning progress is kept and restored on re-add. Wire to `archiveBook`/`removeBook`.
- **Broken Books** (`ContentInit.broken`): render a card in the front list with the Book id/title, a short "This Book can't be loaded" state, and Remove (plus Re-add hint when the cause is missing documents). No study navigation.
- **Archive section**: collapsed (`<details>`) section at the bottom listing archived Books with **Restore** and **Remove** actions.
- **Library entry point**: a prominent "Library" button/card opening the Library screen — **hidden entirely when Supabase is unconfigured** (same gating as the existing author entry, decision 15).
- Empty state (everything removed): the Library button plus a short invitation line.

## Wiring

- `App.tsx`: pass `broken` and the four new `ContentInit` actions down; add the `library` screen route + back mapping. Keep the existing update-banner behavior untouched.
- Copy: learner-facing English, "Book(s)" vocabulary throughout.

## Done criteria

1. `corepack pnpm check` green.
2. Browser-verified via the `apps/web:verify` skill flow (the orchestrator will run verification; your job is that `pnpm check` passes and the flows work in a dev-server smoke pass): first-run → My Books shows only "Meet BetterBeaver"; Library lists catalog Books with ratings; Add Kyrgyz → appears in My Books, studiable; Archive → moves to Archive section, gone from front list and (after reload) its vocabulary/review absent; Restore → back; Remove → confirmation, gone, re-add from Library restores progress.
3. No regressions to author/edit/settings flows (rename-touched screens still route).

## Out of scope / no decisions open

Seed shrink (0015-6). Rating math beyond raw counts, search, category filters — all deferred by plan. If a UI micro-choice is genuinely unspecified (spacing, exact wording of a label), match the closest existing screen; anything behavioral is specified above.
