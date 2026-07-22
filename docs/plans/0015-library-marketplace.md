# Plan 0015: Library (Books marketplace)

Status: designed 2026-07-21 (14-decision grilling + doc-reviewer round + owner follow-ups on cache lifecycle, schema bump, rating display); implemented 2026-07-22 via specs 0015-1…6, browser-verified. Two owner rulings landed during implementation: My Books cards carry per-card Vocabulary/Review buttons (replacing the old domain-header shortcuts the flat list dissolved), and the onboarding Book gets icon 🦫 in its published document (pending the live-backend pass below).

## What this is

Learners today get every catalog topic pushed at them: `TopicListScreen` shows the whole catalog, and sync is whole-catalog (a catalog removal force-deletes local content). This plan splits that into a **Library** — a marketplace screen for browsing everything published — and **My Books** — the home screen showing only what the learner explicitly added. "Book" becomes the learner-facing (and code-level) name for today's `Topic`. Long-term direction, stated by the owner: *"In the future there should not be any topic in the repo. They should be available over the library."*

## Amendments to earlier plans

- **Amends plan 0012 §6**: content-set validation granularity moves from the whole cache to the Book (decision 11a below); catalog removal no longer force-removes local content (decision 11).
- **Amends plan 0012 §8**: additive *optional* entity fields that non-strict parsing safely ignores no longer bump `CONTENT_SCHEMA_VERSION` (decision 6a). The bump rule still applies to any change old code could misread.
- **Amends plan 0014's non-scope** ("no aggregate vote tally shown anywhere"): an anonymous counts-only aggregate now backs the Library rating (decision 7).

## Decisions

### Core model

1. **Library ≠ My Books.** The Library browses the full catalog; My Books (the home screen, today's `TopicListScreen` reworked) lists only added Books. Adding is an explicit learner action.
2. **Browse is live metadata, Add is the download.** The Library fetches lightweight card metadata live from the *existing* `catalog` view — no migration needed for these fields — via a lighter PostgREST select: `?select=id,published->topic->>title,published->topic->>description,published->topic->>icon,published->topic->>domainId&kind=eq.topic` (`title`/`description` live under `published->topic`, not at the top level; the filter excludes domain rows; `domainId` tells Add which domain document to fetch alongside). The rating comes from a second request against the new vote-counts view (decision 7) — browse is two requests. The full course content (topic document + its domain document) downloads into the IndexedDB cache only on Add.
3. **Two ways out of My Books: Archive and Remove.**
   - **Archive** keeps the Book's documents on the device (IndexedDB) but moves it out of the front My Books list into a collapsed Archive section at the bottom of the screen, with Restore and Remove actions. Restoring is offline-capable and instant.
   - **Remove** (from the list or from the Archive) evicts the Book's documents from IndexedDB; re-adding requires the network (except the onboarding Book, whose bundled seed serves as an offline Add source). A domain document is evicted when the last added-or-archived Book referencing it is removed — topic and domain always move as a pair.
   - Either way, learner progress survives: SRS records (`bb.item.<itemId>`), attempted tasks (`bb.attempted`), and streaks (`bb.streak.<domainId>`) live in `localStorage`, are keyed by content ids, and are never garbage-collected by content changes. Re-adding a Book restores its progress intact.
4. **Book = today's `Topic`; `Domain` stays as-is.** `Domain` remains invisible plumbing (lexicon owner) — not shown or grouped in the Library, which is a flat list. A future category filter facet is *not* `domainId` (a "languages" filter spans many domains; don't conflate). This was explicitly settled during grilling — do not re-open Domain removal.
5. **Vocabulary/Review stay domain-scoped.** If two Books ever share a domain, their vocabulary dedupes into one pool (existing plan 0006 semantics — dormant, since nothing shares a domain today; zero code impact now).

### Content & rollout

6. **Book icon field.** New optional `icon` field on the book (topic) document — a value from a built-in enum of emoji/glyphs, picked in the editor, rendered on Library and My Books cards. Replaces `TopicListScreen`'s hardcoded `TOPIC_GLYPHS` map (which carries a `ponytail:` comment naming exactly this fix). Explicitly **not** a `coverImageUrl` — no asset-pipeline dependency (that's still backlog item 3).
   - **6a. No `CONTENT_SCHEMA_VERSION` bump** (owner call, amending the 0012 §8 bump-on-any-change rule): `topicSchema` is a non-strict zod object, so old apps strip the unknown `icon` key harmlessly. No republish-everything, no old-app "outdated" friction. Additive optional fields ignored by non-strict parsing are hereby exempt from the bump rule.
7. **Rating = new anon-readable aggregate view.** A new migration adds a counts-only view over `feedback_votes` (up/down totals grouped by `doc_id` — every vote on the document counts toward its Book, not just `content_kind = 'topic'` rows: a vote on a lesson is still feedback about the Book, and it's the simpler view), granted to `anon, authenticated`. The view **joins `documents` on listed-and-published** (mirroring the catalog view's predicate) so unlisted/unpublished doc ids never leak — counts-only means no `device_id` and no invisible-document existence either. This deliberately adds the first anon SELECT surface adjacent to the feedback tables — plan 0014 had none by design; the owner confirmed the cost is worth a rating on Library cards.
   - **7a. Display**: raw counts — "👍 12 · 👎 3" — hidden entirely at zero votes. No percentages, no thresholds.
8. **Search/filter: deferred.** Flat list now; the icon+rating card is the whole browse UX for v1.
9. **"Meet BetterBeaver" is pre-added.** On first run — defined as *the My Books membership key being absent from `localStorage`*, so existing installs hit the same path once (decision 12) — the bundled seed's onboarding documents are written into the IndexedDB cache **if absent** (never overwriting already-cached, possibly newer, versions — relevant for existing installs) and the Book is added to My Books. Seed-written cache records carry version 0, so the first update check offers the current published version — consistent with strictly opt-in updates. It is an ordinary, removable Book underneath. After this first-run write, the cache is the single content source; the bundled seed's remaining roles are first-run populate, recovery fallback, and offline Add source for the onboarding Book.
10. **The bundled seed shrinks to the onboarding Book.** `content/` keeps only `demo/` (the onboarding Book) and `lexicon/demo/`; Kyrgyz (`content/kyrgyz/`, `content/lexicon/ky/`) leaves the repo entirely and becomes Library-fetched-on-add (its canonical source is already the Supabase backend since plan 0012 — the bundled tree is a frozen seed mirror refreshed by `scripts/export-content.ts`, which must be re-scoped to export only the onboarding Book). No `apps/web/vite.config.ts` change: the precache globs are extension-wide, so the precache shrinks automatically with the emitted files. Knowingly removed with the `ky` tree: the plan-0006 legacy `localStorage` migration fan-out for Kyrgyz keys (`bundled.ts` feeds it) — no pre-0006 install that hasn't already migrated is believed to exist.
11. **Catalog removal no longer deletes local content.** If an added or archived Book is unpublished or removed from the catalog, the learner keeps their local copy — it just stops receiving updates. This reverses `planUpdate`'s `removedIds` → force-remove semantics from plan 0012 §6.
    - **11a. Validation granularity becomes the Book** (topic + its domain document), replacing 0012 §6's whole-set all-or-nothing. A Book that fails validation at boot — e.g. a frozen Book whose shared domain later updated incompatibly — is excluded from the built source but **retained in cache**, surfaced on its My Books card as broken rather than silently deleted; boot never wipes the whole cache. Accepting an update validates per Book the same way. The seed's onboarding Book failing validation still throws to the developer error screen, exactly as before. `validateContentSet`'s cross-document checks run over the currently-valid Books; an Add or update-accept that would *introduce* a cross-document collision (duplicate item id or domain code between individually valid Books) is rejected with an error, existing content untouched — and if a collision nonetheless surfaces at boot, the earliest-added Book wins and the later-added one is excluded (marked broken). "Broken" also covers a My Books entry whose cached documents are missing (e.g. lost IndexedDB): same card state, offering re-add.
12. **No migration for existing installs.** Everyone — including the owner's own in-progress Kyrgyz install — starts with empty My Books (plus the pre-added onboarding Book, via decision 9's absent-key trigger) and manually re-adds Kyrgyz from the Library. On that same first boot under this plan, cached documents that end up neither added nor archived (i.e. the old whole-catalog cache) are purged; SRS progress survives (decision 3), so re-adding Kyrgyz restores it. Explicit owner choice over auto-migrating by existing progress.

### Naming

13. **Full rename `Topic*` → `Book*`** across learner-facing copy *and* TypeScript identifiers in `packages/schema`, `packages/engine`, `apps/web` (`TopicDocument` → `BookDocument`, `TopicSummary` → `BookSummary`, …). **The wire format does not change**: stored JSON field names (`doc.topic`), catalog `kind: "topic"`, `topic:<id>` document-id prefixes, IndexedDB store names, and export-file literals stay as-is — the rename spec must explicitly forbid touching those string literals. No `CONTENT_SCHEMA_VERSION` bump, no backend data migration, old caches stay valid. `Domain`/`DomainDocument` keep their names.
14. **Settings export/import copy splits.** `SettingsScreen`'s maintainer section (one umbrella "Books" heading today, whose export in fact includes domain documents) distinguishes "Books" from "Domains" explicitly, now that "Book" has a precise learner-facing meaning.

### Failure and edge behavior

15. **Unconfigured builds hide the Library.** When Supabase env vars are absent (dev/fork builds), the Library entry point simply doesn't render — same pattern as the existing author-entry gating. Browse failure while configured (offline, backend down) shows an inline error with retry; a failed Add reports the error and leaves the Book un-added. Never a learner-facing crash.

## Non-scope (this pass)

- No search, filter, or category facets in the Library (deferred — decision 8).
- No Domain rearchitecture of any kind (settled — decision 4).
- No cover images / asset-backed Book art (decision 6).
- No auto-migration of existing installs (decision 12).
- No per-Book update policy UI — the existing opt-in update banner semantics (plan 0012 §6) continue, scoped to added and archived Books.

## Implementation outline

Independent chunks, each to be delegated as a self-contained spec (`docs/specs/`):

1. **Rename** (mechanical, big diff): `Topic*` → `Book*` identifiers + UI copy, wire-format string literals untouched (decision 13), behavior unchanged — `TopicListScreen` is renamed here but reworked in chunk 5. Includes decision 14's Settings copy split. Lands first so later chunks are written in the new vocabulary.
2. **Schema: `icon` field** — optional enum field on the book document (no schema-version bump, decision 6a — includes updating the categorical bump-rule comment in `packages/schema/src/documents.ts` to record the 6a exemption), validator rule, editor picker.
3. **Migration: vote-counts view** — anon-readable counts-only view per decision 7 (listed-and-published join), applied to the live project like plan 0014's migration.
4. **Engine/content-source rework** — My Books membership + archive lists (`localStorage`), first-run seed-to-cache pre-add (decision 9), one-time purge of unadded cached docs (decision 12), per-Book fetch-on-add with paired domain handling (decisions 2, 3), per-Book validation with broken-Book surfacing (decision 11a), `planUpdate` scoped to added+archived Books with keep-on-catalog-removal (decision 11), Remove eviction semantics (decision 3).
5. **Screens** — Library screen (flat card list: icon, title, description, rating per 7a; Add/Added state; unconfigured/offline behavior per decision 15), My Books home rework (added Books, Archive section, remove/archive affordances, broken-Book state per 11a — covering both validation failure and missing cached documents — Library entry point).
6. **Seed shrink** — re-scope `scripts/export-content.ts` to the onboarding Book, drop `content/kyrgyz/` + `content/lexicon/ky/` and the legacy `ky` migration fan-out (decision 10), tighten `bundled.ts` expectations.

Chunks 2/3 are independent of everything; 4 blocks 5; 6 lands last (needs 4/5 working so Kyrgyz remains reachable via the Library).

## Touchpoints

- `apps/web/src/screens/TopicListScreen.tsx` — becomes the My Books screen; `TOPIC_GLYPHS` deleted (decision 6).
- `apps/web/src/content/source.ts` — `initContentSource`/`checkForUpdate`/`acceptUpdate` whole-catalog sync → per-Book scoping (decisions 2, 3, 9, 11, 12).
- `apps/web/src/content/cache.ts` — per-Book eviction (decision 3).
- `packages/engine/src/documentSource.ts` — `planUpdate`, `CatalogRow`, per-Book validation granularity (decisions 2, 11, 11a).
- `apps/web/src/content/bundled.ts` — seed shrink + `ky` migration fan-out removal (decision 10).
- `supabase/migrations/` — new vote-counts view migration (decision 7).
- `apps/web/src/screens/SettingsScreen.tsx` ~line 258–290 — copy split (decision 14).
- `scripts/export-content.ts` — onboarding-only export scope (decision 10).
