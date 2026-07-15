# Plan 0006: Domain lexicon — central vocabulary, tap-to-lookup, own words

Status: approved after 2 adversarial review rounds (16 + 6 findings addressed; round-3 verdict: APPROVE) · Owner: Moe · Date: 2026-07-15 · Prerequisite: plans 0004 and 0005 complete (they are) · Direction pinned by grilling session 2026-07-15: per-domain lexicon canonical via migration, typed one-side-authored symmetric links, families as shipped lists, best-effort tap lookup, per-domain review

## Amendments to prior plans

- **Plan 0004 non-goals superseded.** "No learner-authored items" and "no cross-topic lists" are lifted: this plan adds user-created lexicon entries and re-scopes lists from topic to domain. The scheduling-entry rule ("first graded result schedules") is unchanged.
- **Plan 0004 synonyms feature re-based.** The free-text `synonyms: string[]` field is deleted; the "also: …" recall-reveal line and the vocabulary-row synonym chips now derive from `synonym`-type links (the linked entries' scripts). Same learner-visible feature, link-backed. Link targets are resolved by the **caller** against `loadDomain`'s merged pool (a linked entry may be referenced by no unit, so `Content.items` cannot resolve it); the engine consumes pre-resolved scripts.
- **Plan 0001 storage layout amended.** Lexeme items move out of topic directories into a per-domain lexicon; unit/task `itemIds` may reference lexicon entries. Item **ids do not change**, so all existing SRS state (`bb.item.<id>`) carries over untouched. Ownership class (d) is narrowed to topic-owned items (see Design).
- **Plan 0001 id-prefix class (c) extended.** Domains get a `code`; entry ids must be prefixed `<domain.code>-` (existing `ky-`/`dx-` ids already conform, so no id changes).
- **Plan 0004 `readAloudLang` moves** from `Topic` to the domain metadata (it describes the language, not the topic).

## Purpose

Make vocabulary a first-class, cross-topic concept. Today a word exists only inside one topic; the same word in two topics is two items with two SRS states, learners cannot add words the content doesn't ship, and exercise text is dead text. After this plan: every domain (a language like Kyrgyz, or later a general subject like botany) has one canonical lexicon; topics draw their vocabulary from it; learners tap any word in an exercise to see its dictionary entry and save it; learners create their own entries; entries link to synonyms/antonyms; shipped "word families" (greetings, animals, …) group entries thematically.

Sequenced as five independently shippable feature steps plus a final verification pass — the app is fully working after each step.

## Context

- A "word" today is a per-topic item (`content/<topicId>/items/*.json`), validated at startup by `validateContent`. Tasks, SRS state, and vocab lists all key on item ids.
- `buildAdhocSession(mode, items, rng)` already takes a plain `Item[]` and re-checks all mode floors at runtime — it does not care where items come from. The engine is largely ready; the content model is not.
- Kyrgyz is agglutinative and suffixing: surface forms in sentences are inflected, but the lemma is usually a prefix of the surface form, and Cyrillic is near-phonemic. This makes best-effort prefix matching viable and hand-annotation avoidable.
- BetterBeaver ships to real users (not a single-user tool): multi-language seams must exist from the start (English glosses first), and learner-created data needs durability insurance before it accumulates.
- This migration's cost is at its all-time low (~2 real Kyrgyz units + demo). `/ingest` (milestone 2) will later target lexicon entries as its primary output; this plan defines the shape it fills.

## Goals

The learner can: tap any target-language word in an exercise (post-answer) or vocabulary view and see its entry (script, transliteration, gloss, example, links) in a popup; save it one-tap to a per-domain "Saved words" inbox; add a word the app doesn't know (from the popup's not-found fallback or the Vocabulary screen); organize saved and shipped words into per-domain lists; browse shipped word families; navigate synonym/antonym links; review everything due in one per-domain review queue; export and import all learner data as JSON.

## Non-goals

- **No link-based exercise generation** — links are display + navigation only this plan (smart distractors/"match the opposite" come when the graph is dense enough to beat random sampling).
- **No IPA field** — `transliteration` is the phonetic aid; an optional field can be added additively later.
- **No multi-language glosses** — one `gloss: string` per entry; the domain declares `glossLanguage: "en"`. German glosses later = an additive overlay file, never a re-authoring.
- **No guaranteed tap resolution** — lookup is best-effort (exact, then prefix); a miss offers "add this word", not silence.
- **No mid-question tapping** — tap targets exist only on non-graded surfaces (see Design); making a question's own answer inspectable would leak it.
- **No sync** — export/import JSON is the durability floor; real sync is a later milestone.
- **No new exercise types for general domains** — this plan makes botany-like domains *possible* (lexicon of concepts), not *good* (image-ID tasks etc. are their own plans).

## Design

### Domains and lexicons

New content layout (topic dirs unchanged except items):

```
content/
  lexicon/<domainId>/
    domain.json          { id, code, kind: "language" | "general", title,
                           glossLanguage, readAloudLang? }
    entries/*.json       entries: lexeme (language kind) or concept (general kind)
    families/*.json      { id, name, entryIds }
    assets/audio/*       assets referenced by entries
    assets/img/*
  <topicId>/             topic.json (+ new domainId), units, tasks,
                         items (non-entry kinds; see below), notes, assets
```

Domain metadata: `code` prefixes entry ids (class (c) extension); `glossLanguage` is **required for both kinds** — it declares the language glosses *and* definitions are written in; `readAloudLang` is optional for any kind (plan 0004's rules unchanged).

**Entry kind matches domain kind.** A `language` domain's lexicon holds `lexeme` entries; a `general` domain's holds `concept` entries. Items of other kinds stay **topic-owned**: sentences and pairs always (exercise material, not dictionary words), and concepts inside a language topic too — the Kyrgyz alphabet-letter concepts are pedagogy, not dictionary words, and must not flood the vocabulary view or match single-character taps. Consequence: links always join entries of the same kind, so no mixed-kind link semantics exist.

`Topic` gains required `domainId`; `readAloudLang` moves to `domain.json`. The kyrgyz topic gets domain `ky` (code `ky`, kind `language`, glossLanguage `en`, readAloudLang `ky`); the demo topic gets domain `demo` (code `dx`, kind `language`, glossLanguage `en`, readAloudLang `en`).

**What `Content.items` means after extraction (pinned):** `loadTopic(id)` returns topic-owned items **plus the entries referenced by that topic's units** — so per-topic sessions, review, and distractor sampling behave exactly as before the migration. Ownership/orphan class (d) applies to **topic-owned items only**; class (f) stays **universal** — every task item, entry or not, must appear in its owning unit's `itemIds` (unit browsing, distractor pools, and classes (g)/(h)/(p) all assume it, and units may freely list entries, so keeping (f) costs nothing). An entry may be referenced by any number of units across any number of the domain's topics (including several units of one topic — that's the point of a shared lexicon).

**Asset resolution (pinned).** Lexicon entries' `audioRef`/`imageRef` resolve against the *lexicon's* asset dirs. `getAssetUrl(topicId, kind, stem)` becomes domain-aware: try the topic dir, then the topic's domain lexicon dir. Domain-level screens (Vocabulary, popup, domain review) resolve via a new `getLexiconAssetUrl(domainId, kind, stem)` directly — they have no topic in hand. Migration moves each entry's referenced assets (e.g. demo's `dx-audio-sun.wav`, `dx-img-sun.svg`, `dx-img-house.svg`) into `lexicon/demo/assets/`; pair/sentence assets stay in the topic.

### Entry shape

Existing payloads plus two additions, minus one deletion:

- lexeme: `{ script, transliteration, gloss, example?: { text, translation }, usageNote?, audioRef?, imageRef? }` — the free-text `synonyms: string[]` **is deleted** (see the plan-0004 amendment above). Migration: each current Kyrgyz synonym string becomes a linked entry or moves into `usageNote` — orchestrator decides per word.
- concept: unchanged (`term`, `definition`, `example?`, …) — `definition` is the general-domain analogue of a translation, written in the domain's `glossLanguage`.
- both: `links?: [{ type, entryId }]` — type ∈ `synonym | antonym` (language domains) / `related | contrast` (general domains). **Authored on one side only**; the engine derives the symmetric closure at load. Validator rejects self-links, dangling targets, both-directions-authored duplicates, and types illegal for the domain kind.

### User-created entries and saved words

- User entries live in `localStorage` (`bb.userwords.<domainId>`), ids `user-<crypto.randomUUID()>` (lowercase hex + hyphens, satisfies the slug pattern; the validator reserves the `user-` prefix so shipped content can never collide). At load they merge into the domain's entry pool; everything downstream (lists, ad-hoc study, SRS keyed on `bb.item.user-…`, TTS fallback, links from user entries to shipped ones) works unchanged because it only sees `Item[]` and ids. User entries are not validator-checked; the existing runtime mode floors already guard study, and a user link whose target no longer exists is **hidden in the UI but retained in storage** (it revives if the entry returns).
- **Lifecycle (pinned):** editing a user entry keeps its id (SRS state follows). Deleting one removes the entry and its `bb.item.user-…` key; list memberships and inbound user links disappear via the pruning/hiding rules above.
- "Saved words" is a built-in per-domain list with reserved id `saved`, auto-created, undeletable; one-tap save from the popup appends to it, **idempotently** (saving an already-saved word is a no-op).
- Saving **does not create SRS state** (saving ≠ learning); an entry enters the review queue on its first graded result, per the plan-0004 rule.

### Tap-to-lookup

One shared web component renders target-language script as tappable. **Where tap is active (pinned):** non-graded surfaces only — vocabulary rows, popup link chips, note views, and session screens **after the answer is submitted** (reveal/feedback state: the sentence just built, the cloze sentence revealed, the matched cards, a recognize/listen prompt post-answer). Never on an unanswered question — a tap would show the gloss and leak the answer.

Resolution against the domain's merged entry pool, with **one normalization applied to both sides** (`normalizeToken`: trim surrounding punctuation, case-fold — so entry `"Салам!"` and tapped `"Салам"` both normalize to `"салам"`):

1. exact match on normalized `script`/`term` → entry popup;
2. else the longest normalized entry script (≥3 chars) that is a **prefix** of the normalized token → popup, with the matched lemma shown so a wrong stem is self-evident;
3. ties at either stage (homographs, user entry duplicating a shipped script): shipped before `user-`, then lowest id lexicographically — deterministic, and the popup's link chips make the neighbor reachable;
4. else "no entry — add ‘<token>' as a new word?" → prefilled add-word form.

Popup contents: script (+ speaker button per plan-0004 TTS rules), transliteration, gloss/definition, example, family names, link chips (tappable → that entry's popup), and one action: "★ Save". Read-only otherwise — editing and studying live in the Vocabulary screen. Pinned floor: lookup is best-effort; precision complaints route to an optional authored override later (cloze-style `{{ref:...}}` markup), **not** built now.

### Lists, families, review — re-scoped to domains

- `VocabListStore` keys change `topicId → domainId` (`bb.vocablists.<domainId>`). Lists may reference any entry of the domain, shipped or user-created; dangling-id pruning stays and **runs against the merged (shipped + user) pool only** — never against shipped entries alone, or every saved user word would be eaten at load.
- Families are shipped read-only lists rendered by the same UI, with "copy to my lists" instead of edit/delete. Reverse lookup (entry → its families) is one derived map at load, same trick as link symmetry.
- The review queue, streak, and due count become per-domain. The queue is built from **scheduling units, not items** (cloze blanks are scheduled per `<itemId>::c<n>`, derived from tasks): domain queue = the union of `schedulingUnits(loadTopic(t))` over the domain's topics, plus one scheduling unit per lexicon entry (shipped + user) referenced by no topic, **deduplicated by scheduling-unit id** — so an entry referenced by three topics is one review item, and due cloze blanks keep appearing exactly as in today's per-topic review. Streak storage becomes `bb.streak.<domainId>`. Navigation: the home screen groups topics by domain and adds domain-level "Vocabulary" and "Review" entries.
- **localStorage migrations (pinned rule):** presence-based and self-erasing — if the legacy key exists: transform, write the new key(s), delete the legacy key; if absent, do nothing. So they run once, survive partial failure (re-run resumes), and can never clobber post-migration or imported data. **If the legacy key equals the new key, the migration is a no-op** (the demo topic and demo domain share the id `demo` — transform-then-delete would otherwise destroy the key it just wrote). Concretely: `bb.vocablists.<topicId>` → `bb.vocablists.<topic's domainId>` (no-op when identical; merge if a distinct target exists); `bb.streak` → copied to **every** bundled domain, then deleted (the streak records "you showed up"; both domains inheriting it is harmless, losing it is not).

### Export / import

A "Backup" section in the Vocabulary (or home) screen: export serializes every `bb.*` key to a downloadable JSON file; import restores from such a file — **it first deletes all existing `bb.*` keys**, then writes the file's keys (a true restore, no stale leftovers), behind a confirm dialog. ~50 lines total; ships in the same step as user words because that's when irreplaceable data starts existing.

## Schema changes (`packages/schema`)

- `domainSchema` (`id`, `code`, `kind`, `title`, `glossLanguage`, `readAloudLang?`); `familySchema` (`id`, `name`, `entryIds`).
- `topicSchema`: required `domainId`; `readAloudLang` removed. Lexeme payload: `example?` added, `synonyms` removed. Lexeme + concept payloads: `links?`.
- `validateContent` grows a domain side (`domain`, `entries`, `families`, lexicon asset stems); new validator classes: entry ids prefixed `<domain.code>-` (class (c) extension); id uniqueness over the **merged pool** (topic-owned ∪ domain lexicon — the demo topic and domain share the `dx` prefix, so entry-only uniqueness would miss a topic-item collision that silently shares `bb.item.<id>` SRS state); entry kind matches domain kind; `links` rejected on topic-owned items (no validator or UI exists for them there); `user-` prefix reserved (no shipped id may use it); link targets exist / no self-links / no double-authored symmetry / link types legal for the domain kind; family entryIds resolve; unit/task itemIds resolve in the merged pool; ownership class (d) scoped to topic-owned items, class (f) universal; topic.domainId exists; lexicon audioRef/imageRef stems exist in the lexicon's asset dirs.
- Cross-domain: `bundled.ts` (below) errors at startup on duplicate domain codes or on any item id (topic-owned or entry) appearing twice across the whole bundle — `bb.item.<id>` keys must be globally unambiguous.

## Engine changes (`packages/engine`)

- `ContentSource` grows domain awareness: `listDomains()`, `loadDomain(id)` (metadata + merged entries + families + symmetric-link closure). `loadTopic` keeps its signature but its `Content.items` now means topic-owned ∪ referenced entries (pinned above).
- Lookup helper `resolveToken(token, entries)` implementing the pinned normalize/exact/prefix/tie-break rules (pure, tested with inflected and punctuated fixtures).
- `buildAdhocSession`'s recall-reveal "also:" line re-based from `payload.synonyms` onto `synonym`-type links (step 1 — the field deletion breaks the build otherwise): the builder gains an optional `resolvedLinks?: Map<itemId, {type, script}[]>` parameter the web layer fills from the domain's merged pool; the engine never resolves entryIds itself. Grading and SM-2 untouched.
- `UserEntryStore` interface (same pattern as `VocabListStore`); `VocabListStore` re-keyed to `domainId`; domain review-queue construction per the pinned scheduling-unit rule (union of `schedulingUnits` over topics + unreferenced entries, deduplicated by scheduling-unit id).

## Web changes (`apps/web`)

- `bundled.ts`: lexicon globs (entries, families, domain.json, lexicon assets) + domain validation + cross-domain id/code uniqueness check; domain-aware `getAssetUrl` fallback + `getLexiconAssetUrl`; merged-entry pool per domain (shipped + user store).
- Tappable-script component (active per the pinned surface rules) + entry popup; add-word form; Saved-words inbox wiring; Vocabulary screen re-pointed to domain (families section, user entries editable/deletable per the lifecycle rules, backup export/import); home screen grouped by domain with domain-level Review/Vocabulary; startup migrations per the pinned presence-based rule.

## Implementation order (each step delegable; `pnpm check` green and app fully usable after every step)

1. **Lexicon extraction (invisible refactor).** Schema: domain/family/entry changes + validator classes. Content: move kyrgyz + demo **lexemes** into `content/lexicon/<domain>/` (alphabet-letter concepts stay topic-owned), create domain.json files, migrate synonym strings to links/usageNotes, move entry-referenced audio **and images** into lexicon asset dirs. Engine: `loadDomain`, `Content.items` semantics, adhoc "also:"-line re-basing. Web: lexicon globs, domain-aware asset resolution, caller-side `resolvedLinks` wiring + synonym-chip re-pointing. App behavior identical; all ids stable.
2. **Domain re-scoping.** Per-domain lists (key migration), per-domain review queue + streak (key migrations, presence-based rule), home screen grouped by domain. No new features — existing ones re-scoped.
3. **Own words + inbox + backup.** `UserEntryStore`, add-word form, merged entry pool (incl. pruning against merged pool), Saved-words built-in list with idempotent save, JSON export/import (delete-then-write restore).
4. **Tap-to-lookup.** `resolveToken` in engine (normalization both sides, tie-breaks, inflected Kyrgyz fixtures incl. `"Салам!"`), tappable-script component on the pinned surfaces only, entry popup with save + add-word fallback.
5. **Links + families in the UI.** Link chips in popup and vocabulary rows (navigable, dangling user links hidden), families section with copy-to-my-lists. (Data model shipped in step 1; this step is pure presentation.)

Final: **browser verification pass** (not a feature step) — tap an inflected word post-answer in a sentence exercise → popup shows the lemma → save → appears in Saved words → study it → appears in domain review; a due **cloze blank** appears in domain review (scheduling-unit construction, not item-based); add an unknown word → study → review; export, wipe storage, import, state restored; demo topic's picture/listen tasks still play their moved assets; demo vocab lists survive the key migration (identity-key no-op).

## Done-criteria

- App behavior after step 1 is indistinguishable from before it (same screens, same sessions, same SRS state, demo audio/images still resolve — verified against a pre-migration localStorage snapshot).
- A word tapped **post-answer** in a sentence-building or cloze exercise resolves to its lemma entry (exact or prefix, `"Салам!"`-style punctuation handled) or offers add-word; the popup never dead-ends; no tap target exists on an unanswered question.
- A user-created word is studyable in every ad-hoc mode whose plan-0004 floors are met (listen verified on the demo domain, where a TTS voice reliably exists), schedulable, listable, linkable to a shipped entry — and survives export → wipe → import. Deleting it removes its SRS state and it vanishes from lists.
- Shipped families browsable and studyable; links navigate both directions while authored once; validator catches: dangling link, self-link, double-authored link, illegal link type for domain kind, `links` on a topic-owned item, entry kind ≠ domain kind, dangling family member, `user-`-prefixed shipped id, un-prefixed entry id, entry id colliding with a topic-owned item id, any id duplicated across the bundle (startup check).
- Saving the same word twice yields one list entry; saving alone never creates SRS state.
- `pnpm check` green after every step.

## Open questions

- **Lexicon bootstrapping**: hand-authoring entries is the bottleneck; `/ingest` (milestone 2) should emit lexicon entries + families from open datasets (Wiktionary dumps, Apertium ky). Decide dataset + license there. Owner: Moe.
- **Authored tap-override markup** (`{{ref:...}}`): only if prefix matching embarrasses itself in practice; revisit after step 4 is used with real content. Owner: Moe.
- **Entry-level audio for user words**: TTS-only for now; ties into the audio-production pipeline question (plan 0002). Owner: Moe.
- **Settings screen**: still doesn't exist; first real setting may be gloss language once a second overlay exists. Out of scope here. Owner: Moe.
