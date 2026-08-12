# Architecture review — 2026-08-12

A structural review of the whole repo: package boundaries, the app shell, screen
complexity, the data layer, and tooling/docs. Findings are ranked within each
section. Claims marked **[verified]** were re-checked directly against the code
for this document; the rest come from a full read of the cited files.

Scale at time of review: 41,130 lines of TS/TSX across 173 files. `apps/web` is
28,100 of that (116 files); the three headless packages are 11,780 combined
(engine 8,712, schema 2,862, srs 206). 59 test files, 543 tests, 23.6s.

---

## Verdict

The architecture is sound and the discipline is real. The layering is a genuine
hexagonal split with no back-edges, the quality gate is better than most repos
this size, and several things that look like problems from a distance turn out
to be deliberate and correct. **This is not a codebase that needs restructuring.**

What it has is a concentration problem. Four files hold 7,127 lines — 25% of the
app — and the next tier of shared primitives never got promoted out of them, so
screens keep absorbing what should be components. Plus two real defects in the
data layer that are worth fixing on their own schedule, independent of any
refactor.

Ranked by what I'd actually do first, the whole review reduces to five things:

1. Fix the first-run purge (data loss, one line)
2. Un-pad STATUS.md (recovers ~810KB of agent/human reading budget, one line)
3. Run CI on pull requests (currently post-merge only)
4. Move the five session wrappers out of `App.tsx` (~450 lines, zero risk)
5. Promote the next tier of primitives out of screens (`EntityCard`, `PayloadField`, `ScreenHeader`)

---

## What's genuinely good

Worth stating explicitly, because three of these look like defects until you read
them and they should not get "fixed":

- **The layering is clean.** `schema → engine → web`, with `srs` a zero-dependency
  leaf. Verified by grep across all 18 non-test engine files: no DOM, React,
  Supabase, `localStorage`, `fetch`, or `import.meta` references anywhere in
  engine — every apparent hit was prose in a comment. `interfaces.ts:40-105`
  defines `ContentSource`/`ProgressStore`/`VocabListStore`/`UserEntryStore` as
  ports and web supplies the adapters. Madge confirms no cycles across 164 files.
- **`validate.ts` is not hand-rolled shape validation.** Schema already depends on
  zod and uses it correctly — `entities.ts` is all-zod and phase 1 of
  `validateContent` (`validate.ts:866-931`) goes through `safeParse`. What the
  long function does is _cross-entity referential integrity_: dangling ids,
  ownership counts, unlock-chain cycles (`validate.ts:684-725`), double-authored
  symmetric links. No schema library expresses that. Don't swap it for zod.
- **`srs` at 206 LOC earns its package.** 103 lines of pinned, dependency-free SM-2
  with its own tests, consumed independently by both engine and web. Zero deps
  means it can't be dragged into the content model. Small ≠ unjustified.
- **`SessionScreen.tsx` is well-factored despite being 1,267 lines.** Every grading
  rule goes through engine (`checkTypedAnswer:371`, `checkScrambleAnswer:465`,
  `checkMatchingPair:563`) and srs (`recognizeQuality:1124`). The shell does state
  plumbing only. Leave it alone.
- **The 13-branch exercise switch is correct as a switch.** `SessionScreen.tsx:673-845`
  has a `question satisfies never` exhaustiveness check at `:842`. A registry/map
  would trade compile-time exhaustiveness for indirection and gain nothing.
- **`lint:types-fire` solves a real fail-open.** typescript-eslint's type-aware
  rules report _nothing_ when the project service is misconfigured — indistinguishable
  from clean code. Planting a floating promise and asserting the rule names it is
  the right shape of check, not a workaround.
- **Styling is in good shape.** 66 CSS custom properties with a full light/dark
  pair (`styles.css:40-132`) and zero hardcoded hex outside `:root`. Only 8 inline
  styles app-wide, 6 of them `display:none` on file inputs.
- **RLS is enabled on all eight app tables**, grants are revoked-then-narrowed, the
  three anon-facing views are correctly security-definer and column-narrowed, and
  `publish_document` has real optimistic concurrency. No missing-policy holes.

---

## 1. Correctness and security

### 1.1 First-run purge can delete the entire content cache — **[verified]**

`apps/web/src/content/source.ts:470-482`

`isFirstRun()` already guards the case where `getItem` _throws_ — `myBooks.ts:57-60`
returns `false` with a comment naming this exact purge scenario. The unguarded
path is **quota-exceeded on write**:

1. `getItem` succeeds, returns `null` (key never written) → `isFirstRun()` is `true`
2. `initMembership(["demo"], [])` calls `writeIds`, which hits quota and swallows
   the failure into `noteStorageUnwritable()` (`myBooks.ts:36-49`)
3. `readMyBooks()` therefore returns `[]`
4. `purgeUnmembered(cached, [], [])` (`source.ts:308-337`) computes an empty
   keep-set and deletes **every cached document**, including downloaded asset blobs

The profile is an existing install upgrading into plan 0015 with localStorage
already full of `bb.item.*` SRS keys. The codebase already knows this pattern —
`reloadAfterMembershipChange` guards on `isStorageUnwritable()` at `source.ts:96`.
The boot purge just doesn't.

**Fix:** check `isStorageUnwritable()` after `initMembership` and skip the purge
(ideally skip the whole first-run branch). One line. Private Books are unaffected —
separate object store by design (`idb.ts:5-8`).

### 1.2 `saveDraft` is unguarded last-write-wins

`apps/web/src/backend/supabase.ts:165-180` does `update({draft}).eq("id", id)` with
no version or etag, while `publish_document` in the same schema has proper
optimistic concurrency. Compounded by `EditSession.tsx:263-275` — "a local draft
always wins over the server copy" — so an untouched stale `bb.author.draft.<docId>`
on device B silently shadows device A's synced work, then overwrites it on the
next Sync. No detection, no recovery.

The proposal path already solved this: `StoredProposal` carries `baseVersion` and
offers resume-vs-stale (`edit/types.ts:20-23`, `EditSession.tsx:290-296`).

**Fix:** store `{baseVersion, doc}` for maintainer drafts too and reuse the existing
choice UI; add an `expected_updated_at` guard to `saveDraft`.

### 1.3 `cast_vote` allows unlimited anonymous ballot stuffing — **[verified, severity corrected]**

`supabase/migrations/20260720000000_content_feedback.sql:112-136` is SECURITY
DEFINER, granted to `anon`, and takes `p_device_id` as a client-supplied parameter.

To be precise about severity: device ids are `crypto.randomUUID()` (`identity.ts:17`),
so deleting or flipping _another_ device's vote requires guessing a v4 UUID and is
not feasible. What is feasible is minting unlimited ids and casting unlimited votes,
with no rate limiting. Those counts are public via `vote_counts` and drive the
Library rating (`library.ts:49`).

**This is a spam concern, not a vote-tampering vulnerability.** Fix if the rating
matters: bind identity server-side, or accept and document it.

### 1.4 `CachedDocument.schemaVersion` is written but never read at boot

`source.ts:472-506` builds from cached docs without consulting `rec.schemaVersion`.
The only gates are `planUpdate` for _incoming_ rows, imports, and editor read-only.
After an app rollback — a real PWA/GitHub Pages scenario — a doc cached from a newer
schema goes straight into `validateContent` and surfaces as a per-Book _validation
error_ rather than "this Book needs a newer app."

**Fix:** compare against `CONTENT_SCHEMA_VERSION` in `buildMembers`, emit a distinct
`broken` reason.

### 1.5 No versioning story for localStorage state

`backup.ts:1-13` states it outright ("No versioning, no partial import, no schema
validation") and `readJson` (`local-storage.ts:16-23`) blind-casts to `SrsState`.
`progress/migrations.ts` is two ad-hoc presence-based migrations keyed off legacy
key names with no stored version number, so migrations can't be ordered or made
conditional. A future `SrsState` shape change has no upgrade path and no detection —
an old-shape value reads as valid and reaches `isDue`/`schedule`.

**Fix:** write a `bb.schema` integer alongside first use; turn `runStorageMigrations`
into a versioned ladder. Cheap now, expensive after the first shape change ships.

---

## 2. Complexity

### 2.1 `App.tsx` (2,414 lines) — ~450 lines can leave today at zero risk

The five session wrappers — `TaskSession:275`, `UnitSession:359`, `RecallSession:464`,
`ReviewSession:510`, `AdhocSession:665` — read only module-scope values and have zero
coupling to `App`. Their presence in this file is pure accident.

Beyond that, three findings worth acting on:

- **An effect keyed on the whole `screen` object** (`App.tsx:1496`). Every `setScreen`
  mints a new object, so `setScreen({...screen, editing: true})` re-runs `loadBook` +
  `loadDomain` + N book loads + `symmetricLinks` just to flip a boolean.
  `App.nav-perf.test.tsx:16-31` already documents the cascade. Depend on extracted
  primitives (`bookId`, `domainId`, `domainEpoch`) instead.
- **`backActionRef.current` assigned during render at 15 sites.** A ref mutation in the
  render body is the anti-pattern concurrent rendering breaks; it survives today only
  because the effect at `1298-1305` re-arms after commit. Have each branch return
  `{node, onBack}`, or move it into a `useBackTrap()` hook.
- **Heavy handler duplication:** six copies of the same back handler, three identical
  `onEdit` closures, the `onEdit(index)` closure triplicated across session wrappers
  (~25 lines each), and `recordGrade(...)` written out five times.

**On the missing router — the current design is defensible.** There's no
`react-router` and the `Screen` union gives typed params (`atPage`, `atEnd`,
`recallUnitId`, `itemIds`) that a URL would stringify. But `history.pushState({backTrap:true}, "")`
pushes _no URL_, so there's no deep linking and no reload persistence — reload always
lands on My Books, and the `OPEN_EDITING_KEY`/`SKIP_COVER_KEY` sessionStorage hacks
exist to survive reloads a URL would handle for free. For a PWA with 17 screens, keep
the union; the missing piece is a **route table**, not a router.

Suggested decomposition, in risk order — phase 1 alone is worth doing today:

- **Phase 1 (~520 lines, no `App` state touched):** `src/sessions/*.tsx` for the five
  wrappers, plus `stores.ts`, `rng.ts`, `editTarget.ts`
- **Phase 2 (~380 lines):** `navigation/screen.ts`, `navigation/useBackTrap.ts`,
  `content/useLibraryData.ts`, `content/useScreenContent.ts`, `edit/useEditRouting.ts`
- **Phase 3 (~620 lines):** `routes/BookFamilyRoutes.tsx`, `routes/DomainRoutes.tsx`,
  `routes/HomeRoute.tsx`

That lands `App.tsx` near 250 lines. The existing `App.*.test.tsx` suite is the safety
net for phases 2–3.

### 2.2 The real structural problem: primitives never got promoted

`components/` holds 2,775 lines of actual shared primitives against 11,000 in
`screens/` plus 2,414 in `App.tsx` — roughly **1:4.8**. It is _not_ a dumping ground;
`Sheet`, `UndoToast`, `ProgressBar`, `TappableText`, `NoteView`, `icons` are all
well-scoped and tested. The problem is that the _next_ tier never moved out, so
screens stay fat and other screens reach into them:

- **`UnitScreen` has become a de-facto shared module.** `SessionEditSheet.tsx:3` imports
  `ExerciseCard, GrowingTextarea, RowExtras`; `SessionScreen.tsx:32` imports
  `SWIPE_THRESHOLD`; `LessonScreen.tsx:19` and `BookScreen.tsx:28` import
  `GrowingTextarea`. Opening the Book screen drags the whole 1,949-line unit trail
  into the chunk, and any `UnitScreen` refactor risks four other screens.
- **An inverted dependency:** `components/NoteEditor.tsx:27` imports `RowActions` from
  `../screens/edit/fields`. `fields.tsx` is the most-reused primitive set in the app
  and it lives under `screens/`. Move it to `components/` — it has no screen-specific state.

The three extractions that remove the most lines:

1. **`<EntityCard>`** — `BookScreen.tsx:440-540` and `LessonScreen.tsx:236-338` are
   near-verbatim triplicated (edit/diff/learner branches), plus a duplicated
   "random practice" card. ~200 lines → one ~90-line component and two call sites.
2. **`<PayloadField>`** + moving `RowActions`/`EntityPicker`/`GrowingTextarea` into
   `components/` — the field+`ProblemMarker`+`withPayload` idiom is written inline
   8 times in `UnitScreen` at 30+ columns of indent. `ExampleCard:402` already proves
   the abstraction with a local `field()` helper. Removes ~250 lines and severs the
   `components → screens` back-edge.
3. **`noteBlockOps.ts` in `packages/engine`** — `NoteEditor.tsx:350-648` is ~300 lines
   of pure `NoteBlock[] → NoteBlock[]` mutation (`moveBlock`, `addRow`, `addColumn`,
   `wrapSelection`, …) sitting inside a component, untestable except through the DOM.
   Engine already owns the neighbouring `parseNoteBlocks`/`serializeNoteBlocks`.

Also worth doing: a `<ScreenHeader onBack label>` and `<Glyph name>` — the back-header
block is duplicated across 8 screens and the
`` `${import.meta.env.BASE_URL}art/icons/X.png` `` string appears **52 times across 19 files**.

### 2.3 Package-level structure

- **`checkReferences` is a 652-line single function** (`validate.ts:208-859`) — 65% of
  its file, ~20 sequentially-dependent phases delimited only by `// --- class (x) ---`
  comments. The 999-line _file_ is fine; the function isn't. Extract each labelled
  block into `checkUniqueness`/`checkTaskRules`/`checkAssetRefs`/`checkLexicon`, each
  returning `string[]`, with the by-id maps built once and passed in. `validate.test.ts`
  already pins the error strings, so this is mechanical.
- **Engine is two clusters, not a grab-bag.** Learner runtime (`session`, `adhoc`,
  `progress`, `store`, `units`, `streak`, `lookup`, `normalize`, `domain`, `interfaces`)
  and authoring (`documentSource`, `documentEdit`, `documentDiff`, `documentProblems`,
  `draftContent`, `diffContent`). They touch at exactly one seam. Consumer split
  confirms it: 10 web files import only authoring exports, 4 mix. At minimum
  `src/runtime/` and `src/authoring/` subfolders; ideally a separate package so the
  learner bundle stops pulling diff/editor code.
- **`rawDomainId` is duplicated five times** (`source.ts:192`, `remote-assets.ts:9`,
  `private-assets.ts:16`, `edit/types.ts:31`, inline at `documentSource.ts:191-194`),
  each with a comment explaining it was to avoid a madge cycle. A leaf module in
  `schema` — which everything already imports — fixes all five without a cycle.
  Same for the `obj`/`arr` guards duplicated in `draftContent.ts:26-33` and
  `diffContent.ts:44-49`, which are additionally leaking through engine's `export *`
  barrel under maximally generic names.
- **`CatalogSummary` (`supabase.ts:209-214`) is field-for-field identical to
  `CatalogRow`** (`documentSource.ts:20-25`), and web already imports `CatalogRow`
  elsewhere. Delete one.
- **`source.ts` (1,144 lines) is four modules in one closure:** REST transport
  (`152-189`), boot assembly (`258-436`), the update pipeline (`520-838`, ~320 lines),
  and Book lifecycle (`840-1142`). Only boot assembly and the update pipeline actually
  need the closure — `addBook` and `importPrivateBook` already re-read fresh state.
  Extracting transport and the update pipeline alone removes ~500 lines. Note
  `library.ts:2` already reaches into `source.ts` for `fetchRest`, which is backwards.

---

## 3. Tooling, tests, docs

### 3.1 STATUS.md is 954KB, of which ~85% is Prettier padding — **[verified]**

`docs/plans` is in `.prettierignore`; `docs/STATUS.md` is not. Its plans table has one
cell holding a ~39,000-character status paragraph, so Prettier pads all 24 rows to that
width. Measured: 954,240 bytes → 141,169 with space runs squeezed.

The README's prescribed reading order (design → architecture → STATUS) is therefore
**~1.08 MB**, against the "~40k tokens of required reading" budget CLAUDE.md itself
pins. Every agent session following that order burns six figures of tokens on whitespace.

**Fix:** `<!-- prettier-ignore -->` above the table. One line, recovers ~810KB.

Then: cap the table at plan/status/date and move the retro narrative to
`docs/CHANGELOG.md` (STATUS has drifted into a changelog that overlaps `ToDo.md`);
add `docs/plans/archive/` for the 11 plans implemented a month ago; delete the
completed half of `ToDo.md`. Keep `design.md` + `architecture.md` — those two (125KB,
~31k tokens) are the genuinely useful newcomer path.

### 3.2 CI never runs on pull requests — **[verified]**

`.github/workflows/deploy.yml` triggers only `on: push: branches: [main]`. The gate
runs _after_ merge, so a bad PR is caught only once it can already block a deploy.
Add `pull_request` to the `check` job's triggers.

While there: no caching anywhere — `pnpm install --frozen-lockfile` runs twice with no
setup-node pnpm cache and no store cache.

### 3.3 Test coverage is headless-heavy

543 tests in 23.6s. Engine gets ~1 test per 16 LOC; `apps/web` ~1 per 87.

| Project  | Files | Tests | Non-test LOC |
| -------- | ----- | ----- | ------------ |
| engine   | 18    | 222   | 3,555        |
| schema   | 3     | 61    | 1,609        |
| srs      | 1     | 10    | 105          |
| apps/web | 37    | 250   | 21,808       |

`App.tsx` and `UnitScreen.tsx` are both meaningfully covered (686 and 1,174 test lines).
**`content/source.ts` is the gap**: 1,144 LOC with 212 test lines covering only two pure
helpers. `initContentSource` — the cache-vs-seed boot path, i.e. exactly where finding
1.1 lives — has no direct tests. Fake-IDB tests for cache-hit / cache-corrupt / no-cache
would pay for themselves immediately.

There is no e2e; `playwright` is a root devDependency used only for ad-hoc scripts in
git-ignored `scratch.local/`. No coverage tool is configured.

### 3.4 Smaller tooling notes

- **`lint:cycles` has no fail-open guard.** madge has an unmet peer (`typescript@^5.4.4`
  vs the repo's `6.0.3`); cycle detection was confirmed still working, but this is the
  one gate without a `lint-types-fire` equivalent. Plant a synthetic cycle and assert
  madge names it.
- **A live-network test sits inside the gate.** `publishedCatalog.test.ts` fetches the
  real Supabase catalog when CI vars are set. Deliberate and well-argued, but it makes
  `check` — and therefore the deploy — fail on backend downtime. Consider a separate job.
- **No project references / composite builds.** Packages are consumed as source
  (`"main": "src/index.ts"`), which is the right call at this size, but `pnpm -r typecheck`
  runs four `tsc` processes that re-parse dependency sources (schema 3×). At 12.4s it
  isn't worth fixing yet.
- Dependency versions all check out as real and current; `typescript-eslint@8.62.1`
  declares `typescript: >=4.8.4 <6.1.0`, so the TS 6 jump is supported.
- `pnpm dedupe --check` fails today (duplicate `postcss` under `precinct`) and nothing
  in `check` or CI notices.

---

## Suggested sequence

**Now — cheap, high value, independent of any refactor:**

1. Guard the first-run purge (1.1)
2. `<!-- prettier-ignore -->` on STATUS.md (3.1)
3. Add `pull_request` to CI triggers (3.2)
4. Tests for `initContentSource`'s boot branches (3.3) — covers 1.1 properly

**Next — mechanical, low risk:** 5. `App.tsx` phase 1: session wrappers out (2.1) 6. `fields.tsx` → `components/`, fixing the inverted dependency (2.2) 7. Dedupe `rawDomainId` and `obj`/`arr` into a schema leaf module (2.3)

**Then — real refactors, worth doing but sequence behind the above:** 8. `<EntityCard>`, `<PayloadField>`, `<ScreenHeader>`/`<Glyph>` (2.2) 9. `noteBlockOps.ts` into engine (2.2) 10. Split `checkReferences` (2.3) 11. Draft `baseVersion` guard (1.2) 12. `App.tsx` phases 2–3 (2.1)

Deliberately not recommended: replacing the validator with zod, merging `srs`,
converting the exercise switch to a registry, refactoring `SessionScreen`, or adopting
a router.
